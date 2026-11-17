import { db } from "../db.js";
import { auditUnderstandingTask, type QualityReport } from "./understandingQuality.js";

export type LearningStats = {
  tasks: { total: number; lowQuality: number; byKind: Record<string, number> };
  attempts: { total: number; correct: number; rate: number; avgExplanationScore: number };
  cards: { nodeOpen: number; relationOpen: number };
  directions: number;
  dungeons: { cleared: number; playable: number; total: number };
  lowQualityTasks: { id: string; score: number; flags: string[] }[];
};

/** 单世界学习指标：任务质量、作答、卡片、方向、副本。 */
export function learningStats(worldId: string): LearningStats {
  const tasks = db
    .prepare("SELECT id, task_kind FROM understanding_tasks WHERE world_id=?")
    .all(worldId) as { id: string; task_kind: string }[];
  const byKind: Record<string, number> = {};
  const lowQualityTasks: { id: string; score: number; flags: string[] }[] = [];
  for (const t of tasks) {
    byKind[t.task_kind] = (byKind[t.task_kind] ?? 0) + 1;
    const report: QualityReport | null = auditUnderstandingTask(t.id);
    if (report && report.score < 60) {
      lowQualityTasks.push({ id: t.id, score: report.score, flags: report.flags });
    }
  }
  const attempts = db
    .prepare(
      `SELECT COUNT(*) total, COALESCE(SUM(a.correct),0) correct, COALESCE(AVG(a.rubric_score),0) avg_score
       FROM understanding_attempts a JOIN understanding_tasks t ON t.id=a.task_id
       WHERE t.world_id=?`,
    )
    .get(worldId) as { total: number; correct: number; avg_score: number };
  const eventCount = (type: string) =>
    (db
      .prepare("SELECT COUNT(*) c FROM events WHERE world_id=? AND type=?")
      .get(worldId, type) as { c: number }).c;
  const dungeons = db
    .prepare("SELECT status, COUNT(*) c FROM buildings WHERE world_id=? GROUP BY status")
    .all(worldId) as { status: string; c: number }[];
  const statusCount = (s: string) => dungeons.find((d) => d.status === s)?.c ?? 0;
  return {
    tasks: { total: tasks.length, lowQuality: lowQualityTasks.length, byKind },
    attempts: {
      total: attempts.total,
      correct: attempts.correct,
      rate: attempts.total ? Number((attempts.correct / attempts.total).toFixed(3)) : 0,
      avgExplanationScore: Math.round(attempts.avg_score ?? 0),
    },
    cards: { nodeOpen: eventCount("node_card_open"), relationOpen: eventCount("relation_card_open") },
    directions: eventCount("direction_explore"),
    dungeons: {
      cleared: statusCount("cleared"),
      playable: statusCount("playable"),
      total: dungeons.reduce((n, d) => n + d.c, 0),
    },
    lowQualityTasks: lowQualityTasks.slice(0, 20),
  };
}
