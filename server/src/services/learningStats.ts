import { db } from "../db.js";
import { auditUnderstandingTask, type QualityReport } from "./understandingQuality.js";
import { countTaskReviews } from "../db/taskReviews.js";

export type LearningStats = {
  tasks: { total: number; lowQuality: number; byKind: Record<string, number> };
  attempts: { total: number; correct: number; rate: number; avgExplanationScore: number };
  cards: { nodeOpen: number; relationOpen: number };
  directions: number;
  dungeons: { cleared: number; playable: number; total: number };
  reviews: { good: number; bad: number };
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

export type WorldOverview = {
  id: string;
  name: string;
  is_demo: number;
  createdAt: number;
  tasks: number;
  lowQuality: number;
  attempts: number;
  correctRate: number;
  avgExplanationScore: number;
  cleared: number;
  dungeons: number;
  nodeCards: number;
  directions: number;
};

export type CalibrationExample = {
  taskId: string;
  verdict: "good" | "bad";
  score: number;
  flags: string[];
  stem: string;
};

export type LabeledScore = { verdict: "good" | "bad"; score: number };

/** 用人工标签找“好题分≥t、差题分<t”准确率最高的阈值；默认 60。 */
export function suggestThreshold(examples: LabeledScore[]): number {
  if (examples.length < 4) return 60;
  let best = 60;
  let bestScore = -1;
  for (let t = 20; t <= 95; t += 5) {
    let ok = 0;
    for (const e of examples) {
      if (e.verdict === "good" ? e.score >= t : e.score < t) ok++;
    }
    if (ok > bestScore) {
      bestScore = ok;
      best = t;
    }
  }
  return best;
}

/** 校准报告；suggestedThreshold 只有在样本 ≥4 时才脱离默认 60。 */
export type CalibrationReport = {
  good: number;
  bad: number;
  avgGood: number;
  avgBad: number;
  mismatchGoodLow: number;
  mismatchBadHigh: number;
  suggestedThreshold: number;
  flagCounts: Record<string, number>;
  examples: CalibrationExample[];
};

/** 世界当前生效的质量阈值：人工标签足够时用校准建议。 */
export function qualityThresholdForWorld(worldId: string): number {
  const rows = db
    .prepare(
      `SELECT r.verdict, r.task_id taskId
       FROM understanding_task_reviews r JOIN understanding_tasks t ON t.id=r.task_id
       WHERE t.world_id=?`,
    )
    .all(worldId) as { verdict: "good" | "bad"; taskId: string }[];
  const labeled: LabeledScore[] = [];
  for (const r of rows) {
    const a = auditUnderstandingTask(r.taskId);
    if (a) labeled.push({ verdict: r.verdict, score: a.score });
  }
  return suggestThreshold(labeled);
}

/** 人工标签 vs 启发式质量分的校准报告。 */
export function calibrationReport(worldId: string): CalibrationReport {
  const rows = db
    .prepare(
      `SELECT r.task_id taskId, r.verdict, t.stem
       FROM understanding_task_reviews r JOIN understanding_tasks t ON t.id=r.task_id
       WHERE t.world_id=? ORDER BY r.created_at DESC`,
    )
    .all(worldId) as { taskId: string; verdict: "good" | "bad"; stem: string }[];
  const goodScores: number[] = [];
  const badScores: number[] = [];
  const flagCounts: Record<string, number> = {};
  const examples: CalibrationExample[] = [];
  let mismatchGoodLow = 0;
  let mismatchBadHigh = 0;
  for (const r of rows) {
    const audit = auditUnderstandingTask(r.taskId);
    if (!audit) continue;
    if (r.verdict === "good") {
      goodScores.push(audit.score);
      if (audit.score < 60) mismatchGoodLow++;
    } else {
      badScores.push(audit.score);
      if (audit.score >= 80) mismatchBadHigh++;
    }
    for (const f of audit.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
    examples.push({
      taskId: r.taskId,
      verdict: r.verdict,
      score: audit.score,
      flags: audit.flags,
      stem: r.stem.slice(0, 120),
    });
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const labeled: LabeledScore[] = [
    ...goodScores.map((score) => ({ verdict: "good" as const, score })),
    ...badScores.map((score) => ({ verdict: "bad" as const, score })),
  ];
  return {
    good: goodScores.length,
    bad: badScores.length,
    avgGood: avg(goodScores),
    avgBad: avg(badScores),
    mismatchGoodLow,
    mismatchBadHigh,
    suggestedThreshold: suggestThreshold(labeled),
    flagCounts,
    examples: examples.slice(0, 20),
  };
}

/** 跨世界总览：首页/总览用；支持 recent/tasks/accuracy 排序与名称过滤。 */
export function learningOverview(opts: { sort?: "recent" | "tasks" | "accuracy"; q?: string } = {}): WorldOverview[] {
  const worlds = db
    .prepare("SELECT id,name,is_demo,created_at FROM worlds ORDER BY created_at DESC")
    .all() as { id: string; name: string; is_demo: number; created_at: number }[];
  const q = (opts.q ?? "").trim().toLowerCase();
  const filtered = q ? worlds.filter((w) => w.name.toLowerCase().includes(q)) : worlds;
  const rows = filtered.map((w) => {
    const s = learningStats(w.id);
    return {
      id: w.id,
      name: w.name,
      is_demo: w.is_demo,
      createdAt: w.created_at,
      tasks: s.tasks.total,
      lowQuality: s.tasks.lowQuality,
      attempts: s.attempts.total,
      correctRate: s.attempts.rate,
      avgExplanationScore: s.attempts.avgExplanationScore,
      cleared: s.dungeons.cleared,
      dungeons: s.dungeons.total,
      nodeCards: s.cards.nodeOpen,
      directions: s.directions,
    };
  });
  const sort = opts.sort ?? "recent";
  rows.sort((a, b) => {
    if (sort === "tasks") return b.tasks - a.tasks || b.createdAt - a.createdAt;
    if (sort === "accuracy") {
      const aa = a.attempts ? a.correctRate : -1;
      const bb = b.attempts ? b.correctRate : -1;
      return bb - aa || b.attempts - a.attempts || b.createdAt - a.createdAt;
    }
    return b.createdAt - a.createdAt;
  });
  return rows;
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
    reviews: countTaskReviews(worldId),
    lowQualityTasks: lowQualityTasks.slice(0, 20),
  };
}
