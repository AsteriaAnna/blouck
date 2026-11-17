import { db, getBuilding, setBuildingStatus } from "../db.js";
import type { LLMProvider } from "../providers/types.js";
import { ensureUnderstandingTask, getUnderstandingTaskForClient } from "./understanding.js";

const STAGES = ["boundary", "counterexample", "transfer"] as const;

/** 选一条 relation（两节点都在副本 steps 里），生成“边界→反例→迁移”误解纠正序列。 */
export async function ensureDungeonSequence(buildingId: string, llm: LLMProvider) {
  const building = getBuilding(buildingId);
  if (!building) return { status: "not_found" as const, stages: [], progress: { done: 0, total: 3 } };
  let steps: string[] = [];
  try {
    steps = JSON.parse(building.steps || "[]");
  } catch {}
  const edges = db
    .prepare("SELECT * FROM edges WHERE world_id=? AND kind='formal'")
    .all(building.world_id) as any[];
  const edge = edges.find((e) => steps.includes(e.src) && steps.includes(e.dst) && e.evidence);
  if (!edge) {
    return {
      status: "source_required" as const,
      buildingId,
      stages: [],
      progress: { done: 0, total: 3 },
      message: "这个副本还没有带原文证据的关系；辨析副本需要先有来源。",
    };
  }
  const tasks: any[] = [];
  for (const variant of STAGES) {
    const p = await ensureUnderstandingTask(edge.id, llm, variant);
    if (p.status !== "ready" || !p.task) continue;
    tasks.push({ stage: tasks.length + 1, variant, task: p.task });
  }
  if (tasks.length < 3) {
    return {
      status: "source_required" as const,
      buildingId,
      edgeId: edge.id,
      stages: tasks,
      progress: { done: 0, total: 3 },
      message: "关系证据不足以生成三关辨析。",
    };
  }
  return {
    status: "ready" as const,
    buildingId,
    edgeId: edge.id,
    stages: tasks,
    progress: { done: 0, total: 3 },
  };
}

export function completeDungeonSequence(buildingId: string, edgeId?: string) {
  const building = getBuilding(buildingId);
  if (!building) return { status: "not_found" as const };
  let steps: string[] = [];
  try {
    steps = JSON.parse(building.steps || "[]");
  } catch {}
  const edges = db
    .prepare("SELECT * FROM edges WHERE world_id=? AND kind='formal'")
    .all(building.world_id) as any[];
  const edge =
    (edgeId ? edges.find((e) => e.id === edgeId) : undefined) ??
    edges.find((e) => steps.includes(e.src) && steps.includes(e.dst) && e.evidence);
  const ids = edge
    ? (
        db
          .prepare("SELECT id FROM understanding_tasks WHERE edge_id=?")
          .all(edge.id) as { id: string }[]
      ).map((x) => x.id)
    : [];
  const correct = ids.filter(
    (id) =>
      (db
        .prepare("SELECT 1 FROM understanding_attempts WHERE task_id=? AND correct=1 LIMIT 1")
        .get(id) as any) !== undefined,
  ).length;
  const cleared = ids.length >= 3 && correct >= 3;
  if (cleared) setBuildingStatus(building.id, "cleared");
  return {
    status: "ok" as const,
    edgeId: edge?.id ?? null,
    cleared,
    progress: { done: correct, total: Math.max(3, ids.length) },
  };
}
