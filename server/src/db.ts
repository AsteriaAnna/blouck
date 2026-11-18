import { randomUUID } from "node:crypto";
import type { EdgeKind as SharedEdgeKind } from "@blouck/shared";
import { db } from "./db/connection.js";
import "./db/schema.js";
export { createSourceSpan, getFocusStack, setFocusStack } from "./db/sources.js";
import { createSourceSpan } from "./db/sources.js";
export type { SourceSpanRow } from "./db/sources.js";
export { createDomainQuestions, listDomainQuestions } from "./db/domain.js";
export type { DomainQuestionRow } from "./db/domain.js";
export { addDirection, consumeDirection, listDirections } from "./db/directions.js";
import { addDirection } from "./db/directions.js";
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
  const rows = db
    .prepare("SELECT * FROM edges_canonical WHERE world_id=? ORDER BY created_at")
    .all(worldId) as EdgeRow[];
  return { nodes, edges: rows };
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

const DEMO_SOURCE = [
  "RAG（检索增强生成）由检索与生成组成。",
  "检索负责从向量数据库召回候选，生成负责基于上下文窗口产出回答。",
  "检索之前需要先做文档解析和 Chunking，再用 Embedding 建立索引。",
  "生成可能产生幻觉，需要用评测验证 RAG 的效果。",
  "Prompt 控制生成时注入的检索结果，Agent 可以调用 RAG。",
].join("");

/** 干净 demo：所有 demo 节点都挂在同一份原文上，正式关系必须有 canonical predicate + 原文证据。 */
export function seedDemoWorld(): World {
  const wid = uid();
  const span = createSourceSpan(wid, DEMO_SOURCE);
  const mk = (name: string, x: number, y: number, definition: string) =>
    addNode(wid, name, x, y, "", { definition, sourceSpanId: span.id }).id;

  const rag = mk("RAG", 520, 300, "检索增强生成：先检索外部信息，再让模型基于检索结果生成回答。");
  const retrieval = mk("检索", 320, 210, "从外部知识源召回候选信息的过程。");
  const embedding = mk("Embedding", 180, 330, "把文本映射成向量表示的方法。");
  const chunking = mk("Chunking", 250, 470, "把长文档切分成可检索片段的步骤。");
  const vectordb = mk("向量数据库", 300, 100, "存储和检索向量表示的数据库。");
  const generation = mk("生成", 760, 220, "基于上下文产出回答的步骤。");
  const hallu = mk("幻觉", 880, 360, "生成模型产出不符合事实或来源的内容。");
  const ctx = mk("上下文窗口", 780, 470, "模型一次能看到的上下文长度上限。");
  const evaln = mk("评测", 600, 520, "用指标和样本验证系统效果的环节。");
  const prompt = mk("Prompt", 620, 640, "控制模型输入与生成行为的提示词。");
  const agent = mk("Agent", 980, 200, "能调用工具、规划步骤并完成任务的智能体。");
  const docparse = mk("文档解析", 120, 180, "把原始文档转成可处理文本的步骤。");

  db.prepare(
    "INSERT INTO worlds(id,name,root_node_id,is_demo,created_at) VALUES(?,?,?,1,?)",
  ).run(wid, "AI 产品学习（示例）", rag, now());

  const E = (
    a: string,
    b: string,
    predicate: string,
    label: string,
    evidence: string,
  ) => addEdge(wid, a, b, "formal", label, null, "", { predicate, evidence, confidence: 1, origin: "auto" });

  E(retrieval, rag, "partOf", "组成", "RAG（检索增强生成）由检索与生成组成。");
  E(generation, rag, "partOf", "组成", "RAG（检索增强生成）由检索与生成组成。");
  E(vectordb, retrieval, "prerequisite", "前置", "检索负责从向量数据库召回候选");
  E(docparse, chunking, "prerequisite", "前置", "检索之前需要先做文档解析和 Chunking");
  E(chunking, retrieval, "prerequisite", "前置", "检索之前需要先做文档解析和 Chunking");
  E(embedding, retrieval, "prerequisite", "前置", "再用 Embedding 建立索引");
  E(generation, hallu, "related", "可能产生", "生成可能产生幻觉");
  E(evaln, rag, "related", "验证", "需要用评测验证 RAG 的效果");
  E(prompt, generation, "related", "控制", "Prompt 控制生成时注入的检索结果");
  E(agent, rag, "related", "调用", "Agent 可以调用 RAG");

  addDirection(wid, hallu, "为什么会产生幻觉？", "示例方向");
  addDirection(wid, evaln, "怎么建立可信评测？", "示例方向");

  createBuilding(
    wid,
    "domain",
    retrieval,
    "检索技术 · 领域副本",
    "领域每日练习 · 10 题 · 4 个概念",
    "## 领域副本\n\n领域：**检索技术**\n\n成员：检索、向量数据库、Chunking、Embedding\n\n依据：原文明确描述检索与这些组件的关系。",
    [retrieval, vectordb, chunking, embedding],
  );
  createBuilding(
    wid,
    "flow",
    rag,
    "RAG 全流程 · 流程副本",
    "流程排序 · 5 步",
    "## 流程副本\n\n过程：**RAG 全流程**\n\n顺序：文档解析 → Chunking → Embedding → 检索 → 生成\n\n依据：原文明确描述这些步骤的先后关系。",
    [docparse, chunking, embedding, retrieval, generation],
  );
  computeFrontier(wid);
  return getWorld(wid)!;
}

export function seedDemoIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) c FROM worlds").get() as { c: number };
  if (count.c > 0) return;
  seedDemoWorld();
}

/** 重建 demo：只删 demo 世界，不影响其他用户世界。 */
export function repairDemoWorld(): World | null {
  const demo = db.prepare("SELECT id FROM worlds WHERE is_demo=1").get() as { id: string } | undefined;
  if (demo) deleteWorld(demo.id);
  return seedDemoWorld();
}
