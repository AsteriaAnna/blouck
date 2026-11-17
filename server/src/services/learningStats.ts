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

export type TrendPoint = {
  day: string;
  attempts: number;
  correct: number;
  avgExplanation: number;
  tasks: number;
  nodeCards: number;
  directions: number;
};

function localDay(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 近 N 天趋势（本地时区），没有数据的日期补 0。 */
export function learningTrend(worldId: string, days = 7): TrendPoint[] {
  const n = Math.max(1, Math.min(30, days));
  const keys = Array.from({ length: n }, (_, i) =>
    localDay(new Date(Date.now() - (n - 1 - i) * 86400000)),
  );
  const base = new Map<string, TrendPoint>(
    keys.map((day) => [
      day,
      { day, attempts: 0, correct: 0, avgExplanation: 0, tasks: 0, nodeCards: 0, directions: 0 },
    ]),
  );
  const attempts = db
    .prepare(
      `SELECT date(a.at/1000,'unixepoch','localtime') day, COUNT(*) total,
              COALESCE(SUM(a.correct),0) correct, COALESCE(AVG(a.rubric_score),0) avg
       FROM understanding_attempts a JOIN understanding_tasks t ON t.id=a.task_id
       WHERE t.world_id=? GROUP BY day`,
    )
    .all(worldId) as { day: string; total: number; correct: number; avg: number }[];
  for (const a of attempts) {
    const p = base.get(a.day);
    if (p) {
      p.attempts = a.total;
      p.correct = a.correct;
      p.avgExplanation = Math.round(a.avg);
    }
  }
  const tasks = db
    .prepare(
      "SELECT date(created_at/1000,'unixepoch','localtime') day, COUNT(*) c FROM understanding_tasks WHERE world_id=? GROUP BY day",
    )
    .all(worldId) as { day: string; c: number }[];
  for (const t of tasks) {
    const p = base.get(t.day);
    if (p) p.tasks = t.c;
  }
  const events = db
    .prepare(
      `SELECT date(created_at/1000,'unixepoch','localtime') day, type, COUNT(*) c
       FROM events WHERE world_id=? AND type IN ('node_card_open','direction_explore') GROUP BY day,type`,
    )
    .all(worldId) as { day: string; type: string; c: number }[];
  for (const e of events) {
    const p = base.get(e.day);
    if (!p) continue;
    if (e.type === "node_card_open") p.nodeCards = e.c;
    else p.directions = e.c;
  }
  return keys.map((k) => base.get(k)!);
}

/** CSV 导出：近 N 天趋势，可直接给表格工具。 */
export function learningCsv(worldId: string, days = 30): string {
  const rows = learningTrend(worldId, days);
  const head = "day,attempts,correct,avgExplanation,tasks,nodeCards,directions";
  const body = rows.map((r) =>
    [r.day, r.attempts, r.correct, r.avgExplanation, r.tasks, r.nodeCards, r.directions].join(","),
  );
  return [head, ...body].join("\n") + "\n";
}

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
