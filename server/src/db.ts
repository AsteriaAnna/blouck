import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "./env.js";

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
  created_at: number;
};

export type EdgeKind = "formal" | "source" | "suggest" | "direction";

export type EdgeRow = {
  id: string;
  world_id: string;
  src: string;
  dst: string;
  kind: EdgeKind;
  label: string;
  md: string;
  question: string | null;
  created_at: number;
};

export type BuildingRow = {
  id: string;
  world_id: string;
  kind: "domain" | "flow";
  anchor: string;
  title: string;
  sub: string;
  md: string;
  steps: string;
  status: "locked" | "playable" | "cleared";
  created_at: number;
};

export type QuizRow = {
  id: string;
  node_id: string;
  kind: "short" | "judge";
  prompt: string;
  answer: string;
  ai_generated: number;
  created_at: number;
};

mkdirSync(dirname(env.dbPath), { recursive: true });
export const db = new DatabaseSync(env.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS worlds(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, root_node_id TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes(
  id TEXT PRIMARY KEY, world_id TEXT NOT NULL, name TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL, free_md TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0, tier INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS edges(
  id TEXT PRIMARY KEY, world_id TEXT NOT NULL, src TEXT NOT NULL, dst TEXT NOT NULL,
  kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', md TEXT NOT NULL DEFAULT '',
  question TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS buildings(
  id TEXT PRIMARY KEY, world_id TEXT NOT NULL, kind TEXT NOT NULL,
  anchor TEXT NOT NULL, title TEXT NOT NULL, sub TEXT NOT NULL DEFAULT '',
  md TEXT NOT NULL DEFAULT '', steps TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'playable', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS quizzes(
  id TEXT PRIMARY KEY, node_id TEXT NOT NULL, kind TEXT NOT NULL,
  prompt TEXT NOT NULL, answer TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts(
  id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL, correct INTEGER NOT NULL, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_world ON nodes(world_id);
CREATE INDEX IF NOT EXISTS idx_edges_world ON edges(world_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_node ON quizzes(node_id);
`);

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
  for (const t of ["edges", "buildings", "nodes"]) {
    db.prepare(`DELETE FROM ${t} WHERE world_id=?`).run(id);
  }
  const nodeIds = db
    .prepare("SELECT id FROM nodes WHERE world_id=?")
    .all(id) as { id: string }[];
  for (const n of nodeIds) db.prepare("DELETE FROM quizzes WHERE node_id=?").run(n.id);
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
): NodeRow {
  const id = uid();
  db.prepare(
    "INSERT INTO nodes(id,world_id,name,x,y,free_md,hidden,tier,created_at) VALUES(?,?,?,?,?,?,0,0,?)",
  ).run(id, worldId, name, x, y, freeMd, now());
  return getNode(id)!;
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
): EdgeRow {
  const id = uid();
  db.prepare(
    "INSERT INTO edges(id,world_id,src,dst,kind,label,md,question,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(id, worldId, src, dst, kind, label, md, question, now());
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

export function createBuilding(
  worldId: string,
  kind: "domain" | "flow",
  anchor: string,
  title: string,
  sub: string,
  md: string,
  steps: string[],
): BuildingRow {
  const id = uid();
  db.prepare(
    "INSERT INTO buildings(id,world_id,kind,anchor,title,sub,md,steps,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
  ).run(id, worldId, kind, anchor, title, sub, md, JSON.stringify(steps), "locked", now());
  return getBuilding(id)!;
}

export function setBuildingStatus(id: string, status: BuildingRow["status"]) {
  db.prepare("UPDATE buildings SET status=? WHERE id=?").run(status, id);
}

export function updateBuildingMd(id: string, md: string, steps?: string[]) {
  if (steps) {
    db.prepare("UPDATE buildings SET md=?, steps=? WHERE id=?").run(
      md,
      JSON.stringify(steps),
      id,
    );
  } else {
    db.prepare("UPDATE buildings SET md=? WHERE id=?").run(md, id);
  }
}

/** 节点达到可挑战条件后刷新建筑状态（MVP 简化：相关节点至少 2 个首档） */
export function refreshBuildingStatus(nodeId: string) {
  const node = getNode(nodeId);
  if (!node) return;
  const bs = listBuildings(node.world_id);
  for (const b of bs) {
    if (b.status === "cleared" || b.status === "playable") continue;
    const related = db
      .prepare("SELECT * FROM nodes WHERE world_id=?")
      .all(node.world_id) as NodeRow[];
    const ready = related.filter((n) => n.tier >= 1).length >= 2;
    if (ready) setBuildingStatus(b.id, "playable");
  }
}

/** 示例世界（明确标记 is_demo=1，便于演示，不代表空世界发现率） */
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
}
