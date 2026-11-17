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
export { addNode, getNode, setNodeHidden, setNodePosition, setNodesStatus, setNodeStatus, setNodeTier, updateNodeMd, updateNodeMeta } from "./db/nodes.js";
export type { NodeRow } from "./db/nodes.js";
import { addNode, getNode, setNodeTier } from "./db/nodes.js";
import type { NodeRow } from "./db/nodes.js";
export { addEdge, commitStreamEdges, computeFrontier, updateEdgeKind, updateEdgeMd } from "./db/edges.js";
export type { EdgeKind, EdgeRow } from "./db/edges.js";
import { addEdge, computeFrontier } from "./db/edges.js";
import type { EdgeKind } from "./db/edges.js";
import type { EdgeRow } from "./db/edges.js";
export { computeTier, countPassed, createQuizzes, listQuizzes } from "./db/quizzes.js";
export type { QuizRow } from "./db/quizzes.js";
import { computeTier } from "./db/quizzes.js";
import type { QuizRow } from "./db/quizzes.js";

export { db } from "./db/connection.js";

const now = () => Date.now();
const uid = () => randomUUID();

export type World = {
  id: string;
  name: string;
  root_node_id: string;
  is_demo: number;
  created_at: number;
};

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
