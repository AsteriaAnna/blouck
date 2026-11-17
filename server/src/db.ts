import { randomUUID } from "node:crypto";
import type { EdgeKind as SharedEdgeKind } from "@blouck/shared";
import { db } from "./db/connection.js";
import "./db/schema.js";
export { createSourceSpan, getFocusStack, setFocusStack } from "./db/sources.js";
export type { SourceSpanRow } from "./db/sources.js";
export { createDomainQuestions, listDomainQuestions } from "./db/domain.js";
export type { DomainQuestionRow } from "./db/domain.js";
export { addDirection, consumeDirection, listDirections } from "./db/directions.js";
export type { DirectionRow, DirectionTargetPlan } from "./db/directions.js";
export { createBuilding, setBuildingStatus, updateBuildingMd } from "./db/buildings.js";
export type { BuildingRow } from "./db/buildings.js";
import { createBuilding, setBuildingStatus } from "./db/buildings.js";
import type { BuildingRow } from "./db/buildings.js";

export { db } from "./db/connection.js";

export type World = {
  id: string;
  name: string;
  root_node_id: string;
  is_demo: number;
  created_at: number;
};

export type NodeRow = {
  id: string;
  world_id: string;
  name: string;
  x: number;
  y: number;
  free_md: string;
  hidden: number;
  tier: number;
  type: string;
  definition: string;
  aliases: string;
  source_span_id: string | null;
  frontier: number;
  status: "provisional" | "committed";
  created_at: number;
};

export type EdgeKind = SharedEdgeKind;

export type EdgeRow = {
  id: string;
  world_id: string;
  src: string;
  dst: string;
  kind: EdgeKind;
  label: string;
  md: string;
  question: string | null;
  frontier_x: number | null;
  frontier_y: number | null;
  consumed: number;
  predicate: string | null;
  evidence: string;
  confidence: number;
  origin: string;
  claim_status: string;
  revision: number;
  /** 方向线在生成时预先计划好的“延伸节点” */
  target_name: string | null;
  target_type: string | null;
  target_definition: string | null;
  target_aliases: string | null;
  target_predicate: string | null;
  target_label: string | null;
  created_at: number;
};

/** 方向的延伸计划：探索时直接落这个节点，而不是拿问题去抽取 */
export type QuizRow = {
  id: string;
  node_id: string;
  kind: "short" | "judge";
  prompt: string;
  answer: string;
  ai_generated: number;
  created_at: number;
};

const now = () => Date.now();
const uid = () => randomUUID();

export function listWorlds(): World[] {
  return db.prepare("SELECT * FROM worlds ORDER BY created_at DESC").all() as World[];
}

export function getWorld(id: string): World | undefined {
  return db.prepare("SELECT * FROM worlds WHERE id=?").get(id) as World | undefined;
}

export function createWorld(name: string, rootName: string): World {
  const wid = uid();
  const nid = uid();
  db.prepare(
    "INSERT INTO worlds(id,name,root_node_id,is_demo,created_at) VALUES(?,?,?,0,?)",
  ).run(wid, name, nid, now());
  db.prepare(
    "INSERT INTO nodes(id,world_id,name,x,y,free_md,hidden,tier,created_at) VALUES(?,?,?,?,?,?,0,0,?)",
  ).run(nid, wid, rootName, 0, 0, "", now());
  return getWorld(wid)!;
}

export function deleteWorld(id: string) {
  // 先取节点与题目，再删数据：quizzes/attempts 没有 world_id，只能经 node 关联清理
  const nodeIds = db
    .prepare("SELECT id FROM nodes WHERE world_id=?")
    .all(id) as { id: string }[];
  const quizIds = nodeIds.length
    ? (db
        .prepare(
          `SELECT id FROM quizzes WHERE node_id IN (${nodeIds.map(() => "?").join(",")})`,
        )
        .all(...nodeIds.map((n) => n.id)) as { id: string }[])
    : [];
  if (quizIds.length) {
    db.prepare(
      `DELETE FROM attempts WHERE quiz_id IN (${quizIds.map(() => "?").join(",")})`,
    ).run(...quizIds.map((q) => q.id));
    db.prepare(
      `DELETE FROM quizzes WHERE id IN (${quizIds.map(() => "?").join(",")})`,
    ).run(...quizIds.map((q) => q.id));
  }
  for (const t of [
    "edges",
    "nodes",
    "source_spans",
    "directions",
    "hide_batches",
    "daily_domain",
  ]) {
    db.prepare(`DELETE FROM ${t} WHERE world_id=?`).run(id);
  }
  // domain_questions 只有 building_id，没有 world_id：先按本世界建筑清掉，再删建筑
  const buildingIds = db
    .prepare("SELECT id FROM buildings WHERE world_id=?")
    .all(id) as { id: string }[];
  if (buildingIds.length) {
    db.prepare(
      `DELETE FROM domain_questions WHERE building_id IN (${buildingIds.map(() => "?").join(",")})`,
    ).run(...buildingIds.map((b) => b.id));
  }
  db.prepare("DELETE FROM buildings WHERE world_id=?").run(id);
  db.prepare("DELETE FROM focus_stack WHERE world_id=?").run(id);
  db.prepare("DELETE FROM worlds WHERE id=?").run(id);
}

export function getGraph(worldId: string) {
  const nodes = db
    .prepare("SELECT * FROM nodes WHERE world_id=? ORDER BY created_at")
    .all(worldId) as NodeRow[];
  const edges = db
    .prepare("SELECT * FROM edges WHERE world_id=? ORDER BY created_at")
    .all(worldId) as EdgeRow[];
  return { nodes, edges };
}

export function getNode(id: string): NodeRow | undefined {
  return db.prepare("SELECT * FROM nodes WHERE id=?").get(id) as NodeRow | undefined;
}

export function listBuildings(worldId: string): BuildingRow[] {
  return db
    .prepare("SELECT * FROM buildings WHERE world_id=? ORDER BY created_at")
    .all(worldId) as BuildingRow[];
}

export function getBuilding(id: string): BuildingRow | undefined {
  return db.prepare("SELECT * FROM buildings WHERE id=?").get(id) as
    | BuildingRow
    | undefined;
}

export function addNode(
  worldId: string,
  name: string,
  x: number,
  y: number,
  freeMd = "",
  meta: {
    type?: string;
    definition?: string;
    aliases?: string[];
    sourceSpanId?: string | null;
    status?: "provisional" | "committed";
  } = {},
): NodeRow {
  const id = uid();
  db.prepare(
    "INSERT INTO nodes(id,world_id,name,x,y,free_md,hidden,tier,type,definition,aliases,source_span_id,frontier,status,created_at) VALUES(?,?,?,?,?,?,0,0,?,?,?,?,0,?,?)",
  ).run(
    id,
    worldId,
    name,
    x,
    y,
    freeMd,
    meta.type ?? "概念",
    meta.definition ?? "",
    JSON.stringify(meta.aliases ?? []),
    meta.sourceSpanId ?? null,
    meta.status ?? "committed",
    now(),
  );
  return getNode(id)!;
}

export function setNodeStatus(id: string, status: "provisional" | "committed") {
  db.prepare("UPDATE nodes SET status=? WHERE id=?").run(status, id);
}

export function setNodesStatus(ids: string[], status: "provisional" | "committed") {
  for (const id of ids) setNodeStatus(id, status);
}

export function commitStreamEdges(worldId: string) {
  db.prepare(
    "UPDATE edges SET kind='formal' WHERE world_id=? AND origin='stream' AND kind='suggest' AND evidence<>''",
  ).run(worldId);
}

export function updateNodeMeta(
  id: string,
  patch: { type?: string; definition?: string; aliases?: string[]; sourceSpanId?: string | null },
) {
  const cur = getNode(id);
  if (!cur) return;
  db.prepare("UPDATE nodes SET type=?, definition=?, aliases=?, source_span_id=? WHERE id=?").run(
    patch.type ?? cur.type,
    patch.definition || cur.definition,
    JSON.stringify(patch.aliases ?? (JSON.parse(cur.aliases || "[]") as string[])),
    patch.sourceSpanId ?? cur.source_span_id,
    id,
  );
}

/** 重新计算前沿节点：没有向外知识关系的节点（隐藏节点不算） */
export function computeFrontier(worldId: string) {
  const nodes = db.prepare("SELECT id FROM nodes WHERE world_id=? AND hidden=0").all(worldId) as {
    id: string;
  }[];
  const hasOut = new Set(
    (
      db
        .prepare(
          "SELECT DISTINCT src FROM edges WHERE world_id=? AND kind='formal' AND src<>dst",
        )
        .all(worldId) as { src: string }[]
    ).map((r) => r.src),
  );
  const update = db.prepare("UPDATE nodes SET frontier=? WHERE id=?");
  for (const n of nodes) update.run(hasOut.has(n.id) ? 0 : 1, n.id);
}

export function updateNodeMd(id: string, freeMd: string) {
  db.prepare("UPDATE nodes SET free_md=? WHERE id=?").run(freeMd, id);
}

export function setNodePosition(id: string, x: number, y: number) {
  db.prepare("UPDATE nodes SET x=?, y=? WHERE id=?").run(x, y, id);
}

export function updateEdgeMd(id: string, md: string, label?: string) {
  if (typeof label === "string") {
    db.prepare("UPDATE edges SET md=?, label=? WHERE id=?").run(md, label, id);
  } else {
    db.prepare("UPDATE edges SET md=? WHERE id=?").run(md, id);
  }
}

export function setNodeHidden(id: string, hidden: number) {
  db.prepare("UPDATE nodes SET hidden=? WHERE id=?").run(hidden, id);
}

export function setNodeTier(id: string, tier: number) {
  db.prepare("UPDATE nodes SET tier=? WHERE id=?").run(tier, id);
}

export function addEdge(
  worldId: string,
  src: string,
  dst: string,
  kind: EdgeKind,
  label = "",
  question: string | null = null,
  md = "",
  meta: {
    predicate?: string | null;
    evidence?: string;
    confidence?: number;
    origin?: string;
    /** 方向线：预先计划好的延伸节点 */
    target_name?: string | null;
    target_type?: string | null;
    target_definition?: string | null;
    target_aliases?: string | null;
    target_predicate?: string | null;
    target_label?: string | null;
  } = {},
): EdgeRow {
  const id = uid();
  db.prepare(
    "INSERT INTO edges(id,world_id,src,dst,kind,label,md,question,predicate,evidence,confidence,origin,target_name,target_type,target_definition,target_aliases,target_predicate,target_label,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    worldId,
    src,
    dst,
    kind,
    label,
    md,
    question,
    meta.predicate ?? null,
    meta.evidence ?? "",
    meta.confidence ?? 1,
    meta.origin ?? "auto",
    meta.target_name ?? null,
    meta.target_type ?? null,
    meta.target_definition ?? null,
    meta.target_aliases ?? null,
    meta.target_predicate ?? null,
    meta.target_label ?? null,
    now(),
  );
  return db.prepare("SELECT * FROM edges WHERE id=?").get(id) as EdgeRow;
}

export function updateEdgeKind(id: string, kind: EdgeKind) {
  db.prepare("UPDATE edges SET kind=? WHERE id=?").run(kind, id);
}

export function listQuizzes(nodeId: string): QuizRow[] {
  return db
    .prepare("SELECT * FROM quizzes WHERE node_id=? ORDER BY kind, created_at")
    .all(nodeId) as QuizRow[];
}

export function createQuizzes(
  nodeId: string,
  items: { kind: "short" | "judge"; prompt: string; answer: string }[],
) {
  const stmt = db.prepare(
    "INSERT INTO quizzes(id,node_id,kind,prompt,answer,ai_generated,created_at) VALUES(?,?,?,?,?,1,?)",
  );
  for (const it of items) stmt.run(uid(), nodeId, it.kind, it.prompt, it.answer, now());
}

export function countPassed(nodeId: string) {
  const rows = db
    .prepare(
      `SELECT q.kind AS kind, COUNT(DISTINCT a.quiz_id) AS c
       FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
       WHERE q.node_id=? AND a.correct=1 GROUP BY q.kind`,
    )
    .all(nodeId) as { kind: string; c: number }[];
  const short = rows.find((r) => r.kind === "short")?.c ?? 0;
  const judge = rows.find((r) => r.kind === "judge")?.c ?? 0;
  return { short, judge };
}

/** 三档：1/1、3/5、5/10 同时满足 */
export function computeTier(nodeId: string): number {
  const { short, judge } = countPassed(nodeId);
  if (short >= 5 && judge >= 10) return 3;
  if (short >= 3 && judge >= 5) return 2;
  if (short >= 1 && judge >= 1) return 1;
  return 0;
}

export function recordAttempt(quizId: string, correct: boolean) {
  db.prepare("INSERT INTO attempts(id,quiz_id,correct,at) VALUES(?,?,?,?)").run(
    uid(),
    quizId,
    correct ? 1 : 0,
    now(),
  );
  const quiz = db.prepare("SELECT * FROM quizzes WHERE id=?").get(quizId) as
    | QuizRow
    | undefined;
  if (quiz) {
    const tier = computeTier(quiz.node_id);
    setNodeTier(quiz.node_id, tier);
    refreshBuildingStatus(quiz.node_id);
    return { tier, nodeId: quiz.node_id };
  }
  return null;
}

export function refreshBuildingStatus(nodeId: string) {
  const node = getNode(nodeId);
  if (!node) return;
  const bs = listBuildings(node.world_id);
  for (const b of bs) {
    if (b.status === "cleared") continue;
    const stepIds = (() => {
      try {
        return JSON.parse(b.steps || "[]") as string[];
      } catch {
        return [];
      }
    })();
    let ready = false;
    if (b.kind === "flow") {
      const asNodes = stepIds.map((x) => getNode(x)).filter(Boolean);
      ready =
        asNodes.length === stepIds.length
          ? stepIds.length > 0 && asNodes.every((n) => (n?.tier ?? 0) >= 1)
          : (getNode(b.anchor)?.tier ?? 0) >= 1;
    } else if (stepIds.length) {
      ready = stepIds.filter((id) => (getNode(id)?.tier ?? 0) >= 1).length >= 2;
    } else {
      const anchor = getNode(b.anchor);
      if (anchor) {
        const related = db
          .prepare("SELECT * FROM nodes WHERE world_id=?")
          .all(node.world_id) as NodeRow[];
        ready = related.filter((n) => n.tier >= 1).length >= 2;
      }
    }
    setBuildingStatus(b.id, ready ? "playable" : "detected");
  }
}

export function seedDemoIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) c FROM worlds").get() as { c: number };
  if (count.c > 0) return;
  const wid = uid();
  const mk = (name: string, x: number, y: number) => {
    const id = uid();
    db.prepare(
      "INSERT INTO nodes(id,world_id,name,x,y,free_md,hidden,tier,created_at) VALUES(?,?,?,?,?,?,0,0,?)",
    ).run(id, wid, name, x, y, "", now());
    return id;
  };
  const rag = mk("RAG", 520, 300);
  const retrieval = mk("检索", 320, 210);
  const embedding = mk("Embedding", 180, 330);
  const chunking = mk("Chunking", 250, 470);
  const vectordb = mk("向量数据库", 300, 100);
  const generation = mk("生成", 760, 220);
  const hallu = mk("幻觉", 880, 360);
  const ctx = mk("上下文窗口", 780, 470);
  const evaln = mk("评测", 600, 520);
  const prompt = mk("Prompt", 620, 640);
  const agent = mk("Agent", 980, 200);
  const docparse = mk("文档解析", 120, 180);
  db.prepare(
    "INSERT INTO worlds(id,name,root_node_id,is_demo,created_at) VALUES(?,?,?,1,?)",
  ).run(wid, "AI 产品学习（示例）", rag, now());
  const E = (
    a: string,
    b: string,
    kind: EdgeKind,
    label = "",
    question: string | null = null,
  ) => addEdge(wid, a, b, kind, label, question);
  E(rag, retrieval, "formal", "依赖");
  E(rag, generation, "formal", "组合");
  E(retrieval, embedding, "formal", "依赖");
  E(retrieval, chunking, "formal", "前置");
  E(retrieval, vectordb, "formal", "使用");
  E(chunking, docparse, "source", "本轮探索来源");
  E(generation, hallu, "formal", "导致");
  E(rag, ctx, "formal", "受限于");
  E(evaln, rag, "formal", "验证");
  E(prompt, rag, "formal", "控制");
  E(agent, rag, "formal", "调用");
  E(chunking, evaln, "suggest", "影响评测？");
  E(vectordb, ctx, "suggest", "可能相关？");
  E(hallu, ctx, "direction", "", "为什么会产生幻觉？");
  E(evaln, prompt, "direction", "", "怎么建立可信评测？");
  createBuilding(
    wid,
    "domain",
    retrieval,
    "领域副本",
    "检索技术 · 每日 10 题",
    "## 领域副本\n\n覆盖检索、向量、分块、重排。每天最多 10 道新题，跨天保留。",
    [],
  );
  createBuilding(
    wid,
    "flow",
    rag,
    "流程副本",
    "RAG 全链路 · 连线题",
    "## 流程副本\n\n把打乱的步骤按正确顺序连接。",
    ["文档解析", "Chunking", "Embedding", "向量数据库", "检索", "生成"],
  );
  computeFrontier(wid);
}
