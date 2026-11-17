import { randomUUID } from "node:crypto";
import { db, getBuilding, setBuildingStatus } from "../db.js";
import type { LLMProvider } from "../providers/types.js";
import {
  ensureUnderstandingTask,
  getUnderstandingTaskForClient,
} from "./understanding.js";

const VARIANTS_ONE = ["boundary", "counterexample", "transfer"] as const;
const VARIANTS_MANY = ["boundary", "counterexample"] as const;

const TYPE_WEIGHT: Record<string, number> = {
  kindOf: 18,
  partOf: 18,
  prerequisite: 12,
  contrast: 14,
  related: 4,
};

/** 选关系：类型/证据强度/局部易混度/置信度排序，越该辨析越靠前。 */
export function rankDungeonEdges<T extends { src: string; dst: string; predicate?: string | null; evidence?: string; confidence?: number }>(
  edges: T[],
): T[] {
  const score = (e: T) => {
    const type = TYPE_WEIGHT[e.predicate ?? ""] ?? 6;
    const evidence = Math.min(12, Math.round((e.evidence ?? "").length / 4));
    const degree = edges.filter((x) => x.src === e.src || x.dst === e.dst).length;
    const local = Math.min(10, degree * 2);
    const confidence = Math.round((e.confidence ?? 0) * 6);
    return type + evidence + local + confidence;
  };
  return edges
    .map((e, i) => ({ e, i, s: score(e) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.e);
}

type StageRow = {
  id: string;
  building_id: string;
  stage: number;
  task_id: string;
  variant: string;
  edge_id: string;
  created_at: number;
};

/** 最近 5 次作答正确率；样本不足或 <75% 时用基础难度。 */
function recentAccuracy(worldId: string): { attempts: number; rate: number } {
  const rows = db
    .prepare(
      `SELECT a.correct FROM understanding_attempts a
       JOIN understanding_tasks t ON t.id=a.task_id
       WHERE t.world_id=? ORDER BY a.at DESC LIMIT 5`,
    )
    .all(worldId) as { correct: number }[];
  if (!rows.length) return { attempts: 0, rate: 0 };
  return {
    attempts: rows.length,
    rate: rows.reduce((n, r) => n + r.correct, 0) / rows.length,
  };
}

function stagePayload(rows: StageRow[]) {
  return rows
    .map((r) => ({
      stage: r.stage,
      variant: r.variant,
      edgeId: r.edge_id,
      task: getUnderstandingTaskForClient(r.task_id),
    }))
    .filter((s) => s.task);
}

function correctCount(taskIds: string[]) {
  return taskIds.filter(
    (id) =>
      (db
        .prepare("SELECT 1 FROM understanding_attempts WHERE task_id=? AND correct=1 LIMIT 1")
        .get(id) as any) !== undefined,
  ).length;
}

/**
 * 辨析副本：
 * - 一个副本里最多选 2 条带原文证据的 formal 关系；
 * - 单一误解 → 边界/反例/迁移 3 关；
 * - 多个误解 → 每条关系 边界/反例 2 关（最多 4 关）。
 */
export async function ensureDungeonSequence(
  buildingId: string,
  llm: LLMProvider,
  opts: { forceMode?: "gentle" | "hard" } = {},
) {
  const building = getBuilding(buildingId);
  if (!building) return { status: "not_found" as const, stages: [], progress: { done: 0, total: 3 } };
  const existing = db
    .prepare("SELECT * FROM dungeon_stages WHERE building_id=? ORDER BY stage")
    .all(buildingId) as StageRow[];
  if (existing.length > 0) {
    const stages = stagePayload(existing);
    const done = correctCount(stages.map((s) => s.task!.id));
    const mode = stages.length >= 4 ? "hard" : "gentle";
    return {
      status: "ready" as const,
      buildingId,
      edgeId: stages[0]?.edgeId,
      mode,
      stages,
      progress: { done, total: stages.length },
    };
  }

  let steps: string[] = [];
  try {
    steps = JSON.parse(building.steps || "[]");
  } catch {}
  const edges = db
    .prepare("SELECT * FROM edges WHERE world_id=? AND kind='formal'")
    .all(building.world_id) as any[];
  const candidates = edges.filter(
    (e) => steps.includes(e.src) && steps.includes(e.dst) && e.evidence,
  );
  if (candidates.length === 0) {
    return {
      status: "source_required" as const,
      buildingId,
      stages: [],
      progress: { done: 0, total: 3 },
      message: "这个副本还没有带原文证据的关系；辨析副本需要先有来源。",
    };
  }
  const recent = recentAccuracy(building.world_id);
  const autoHard =
    !opts.forceMode && candidates.length >= 2 && recent.attempts >= 3 && recent.rate >= 0.75;
  const mode: "gentle" | "hard" = opts.forceMode ?? (autoHard ? "hard" : "gentle");
  const selected = rankDungeonEdges(candidates).slice(0, mode === "hard" ? 2 : 1);
  const variants = selected.length >= 2 ? VARIANTS_MANY : VARIANTS_ONE;
  const collected: { edgeId: string; variant: string; taskId: string }[] = [];
  for (const edge of selected) {
    for (const variant of variants) {
      const p = await ensureUnderstandingTask(edge.id, llm, variant);
      if (p.status === "ready" && p.task) {
        collected.push({ edgeId: edge.id, variant, taskId: p.task.id });
      }
    }
  }
  if (collected.length < 2) {
    return {
      status: "source_required" as const,
      buildingId,
      stages: [],
      progress: { done: 0, total: 3 },
      message: "关系证据不足以生成辨析关卡。",
    };
  }
  const insert = db.prepare(
    "INSERT INTO dungeon_stages(id,building_id,stage,task_id,variant,edge_id,created_at) VALUES(?,?,?,?,?,?,?)",
  );
  const now = Date.now();
  collected.forEach((s, i) => insert.run(randomUUID(), buildingId, i + 1, s.taskId, s.variant, s.edgeId, now));
  const rows = db
    .prepare("SELECT * FROM dungeon_stages WHERE building_id=? ORDER BY stage")
    .all(buildingId) as StageRow[];
  const stages = stagePayload(rows);
  return {
    status: "ready" as const,
    buildingId,
    edgeId: stages[0]?.edgeId,
    mode,
    stages,
    progress: { done: 0, total: stages.length },
  };
}

export function completeDungeonSequence(buildingId: string) {
  const building = getBuilding(buildingId);
  if (!building) return { status: "not_found" as const };
  const stages = db
    .prepare("SELECT * FROM dungeon_stages WHERE building_id=? ORDER BY stage")
    .all(buildingId) as StageRow[];
  const ids = stages.map((s) => s.task_id);
  const done = correctCount(ids);
  const cleared = ids.length > 0 && done === ids.length;
  if (cleared) setBuildingStatus(building.id, "cleared");
  return {
    status: "ok" as const,
    edgeId: stages[0]?.edge_id ?? null,
    cleared,
    progress: { done, total: Math.max(1, ids.length) },
  };
}
