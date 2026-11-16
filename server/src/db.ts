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
  type: string;
  definition: string;
  aliases: string;
  source_span_id: string | null;
  frontier: number;
  status: "provisional" | "committed";
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
  frontier_x: number | null;
  frontier_y: number | null;
  consumed: number;
  predicate: string | null;
  evidence: string;
  confidence: number;
  origin: string;
  claim_status: string;
  revision: number;
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
  status: "detected" | "locked" | "playable" | "cleared" | "stale";
  version: number;
  basis: string;
  fingerprint: string;
  x: number;
  y: number;
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
  type TEXT NOT NULL DEFAULT '概念', definition TEXT NOT NULL DEFAULT '',
  aliases TEXT NOT NULL DEFAULT '[]', source_span_id TEXT,
  frontier INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS edges(
  id TEXT PRIMARY KEY, world_id TEXT NOT NULL, src TEXT NOT NULL, dst TEXT NOT NULL,
  kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', md TEXT NOT NULL DEFAULT '',
  question TEXT, predicate TEXT, evidence TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 1, origin TEXT NOT NULL DEFAULT 'auto',
  claim_status TEXT NOT NULL DEFAULT 'normal', revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
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

/* ---------- 轻量迁移：老库补齐新列 / 新表 ---------- */
function columnNames(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}
if (!columnNames("edges").includes("frontier_x")) {
  db.exec("ALTER TABLE edges ADD COLUMN frontier_x REAL");
}
if (!columnNames("edges").includes("frontier_y")) {
  db.exec("ALTER TABLE edges ADD COLUMN frontier_y REAL");
}
if (!columnNames("edges").includes("consumed")) {
  db.exec("ALTER TABLE edges ADD COLUMN consumed INTEGER NOT NULL DEFAULT 0");
}
if (!columnNames("buildings").includes("x")) {
  db.exec("ALTER TABLE buildings ADD COLUMN x REAL NOT NULL DEFAULT 0");
}
if (!columnNames("buildings").includes("y")) {
  db.exec("ALTER TABLE buildings ADD COLUMN y REAL NOT NULL DEFAULT 0");
}

// 节点 v2：类型/定义/别名/来源/前沿标记
for (const [col, ddl] of [
  ["type", "TEXT NOT NULL DEFAULT '概念'"],
  ["definition", "TEXT NOT NULL DEFAULT ''"],
  ["aliases", "TEXT NOT NULL DEFAULT '[]'"],
  ["source_span_id", "TEXT"],
  ["frontier", "INTEGER NOT NULL DEFAULT 0"],
  ["status", "TEXT NOT NULL DEFAULT 'committed'"],
] as const) {
  if (!columnNames("nodes").includes(col)) db.exec(`ALTER TABLE nodes ADD COLUMN ${col} ${ddl}`);
}
// 关系 v2：谓词/证据/置信度/来源/争议/版本
for (const [col, ddl] of [
  ["predicate", "TEXT"],
  ["evidence", "TEXT NOT NULL DEFAULT ''"],
  ["confidence", "REAL NOT NULL DEFAULT 1"],
  ["origin", "TEXT NOT NULL DEFAULT 'auto'"],
  ["claim_status", "TEXT NOT NULL DEFAULT 'normal'"],
  ["revision", "INTEGER NOT NULL DEFAULT 1"],
] as const) {
  if (!columnNames("edges").includes(col)) db.exec(`ALTER TABLE edges ADD COLUMN ${col} ${ddl}`);
}
// 副本 v2：版本/依据/指纹
for (const [col, ddl] of [
  ["version", "INTEGER NOT NULL DEFAULT 1"],
  ["basis", "TEXT NOT NULL DEFAULT '{}'"],
  ["fingerprint", "TEXT NOT NULL DEFAULT ''"],
] as const) {
  if (!columnNames("buildings").includes(col)) db.exec(`ALTER TABLE buildings ADD COLUMN ${col} ${ddl}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);`);
const metaGet = (k: string) =>
  (db.prepare("SELECT v FROM meta WHERE k=?").get(k) as { v: string } | undefined)?.v;
if (!metaGet("mig_direction_v2")) {
  // 旧版方向边是 target→focus，v2 统一为 focus→target（渲染只看 src/frontier）
  db.exec("UPDATE edges SET src=dst, dst=src WHERE kind='direction' AND src<>dst");
  db.prepare("INSERT INTO meta(k,v) VALUES('mig_direction_v2','1')").run();
}

db.exec(`
CREATE TABLE IF NOT EXISTS source_spans(
  id TEXT PRIMARY KEY, world_id TEXT NOT NULL, text TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS focus_stack(
  world_id TEXT PRIMARY KEY,
  stack TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS directions(
  id TEXT PRIMARY KEY, world_id TEXT NOT NULL, node_id TEXT NOT NULL,
  question TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
  target_hint TEXT, status TEXT NOT NULL DEFAULT 'open',
  consumed_span_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_directions_world ON directions(world_id);
CREATE TABLE IF NOT EXISTS domain_questions(
  id TEXT PRIMARY KEY, building_id TEXT NOT NULL, kind TEXT NOT NULL,
  prompt TEXT NOT NULL, answer TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]',
  day TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_domain_q ON domain_questions(building_id, day);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS hide_batches(
  id TEXT PRIMARY KEY, world_id TEXT NOT NULL, node_ids TEXT NOT NULL,
  created_at INTEGER NOT NULL, undone INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_domain(
  world_id TEXT NOT NULL, building_id TEXT NOT NULL, date TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(world_id, building_id, date)
);
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

export function getFocusStack(worldId: string): string[] {
  const row = db.prepare("SELECT stack FROM focus_stack WHERE world_id=?").get(worldId) as
    | { stack: string }
    | undefined;
  if (!row) return [];
  try {
    const arr = JSON.parse(row.stack);
    return Array.isArray(arr) ? arr.map(String).slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function setFocusStack(worldId: string, stack: string[]) {
  const clean = [...new Set(stack.filter(Boolean))].slice(0, 12);
  db.prepare(
    "INSERT INTO focus_stack(world_id,stack,updated_at) VALUES(?,?,?) ON CONFLICT(world_id) DO UPDATE SET stack=excluded.stack, updated_at=excluded.updated_at",
  ).run(worldId, JSON.stringify(clean), now());
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
  } = {},
): EdgeRow {
  const id = uid();
  db.prepare(
    "INSERT INTO edges(id,world_id,src,dst,kind,label,md,question,predicate,evidence,confidence,origin,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
    now(),
  );
  return db.prepare("SELECT * FROM edges WHERE id=?").get(id) as EdgeRow;
}

export type SourceSpanRow = {
  id: string;
  world_id: string;
  text: string;
  revision: number;
  created_at: number;
};

export function createSourceSpan(worldId: string, text: string, revision = 1): SourceSpanRow {
  const id = uid();
  db.prepare("INSERT INTO source_spans(id,world_id,text,revision,created_at) VALUES(?,?,?,?,?)").run(
    id,
    worldId,
    text,
    revision,
    now(),
  );
  return db.prepare("SELECT * FROM source_spans WHERE id=?").get(id) as SourceSpanRow;
}

export type DirectionRow = {
  id: string;
  world_id: string;
  node_id: string;
  question: string;
  reason: string;
  target_hint: string | null;
  status: "open" | "consumed" | "archived";
  consumed_span_id: string | null;
  created_at: number;
};

export function addDirection(
  worldId: string,
  nodeId: string,
  question: string,
  reason = "",
  targetHint: string | null = null,
): DirectionRow {
  const id = uid();
  db.prepare(
    "INSERT INTO directions(id,world_id,node_id,question,reason,target_hint,status,created_at) VALUES(?,?,?,?,?,?,'open',?)",
  ).run(id, worldId, nodeId, question, reason, targetHint, now());
  return db.prepare("SELECT * FROM directions WHERE id=?").get(id) as DirectionRow;
}

export type DomainQuestionRow = {
  id: string;
  building_id: string;
  kind: "fill" | "judge" | "answer";
  prompt: string;
  answer: string;
  aliases: string;
  day: string;
  created_at: number;
};

export function listDomainQuestions(buildingId: string, day: string): DomainQuestionRow[] {
  return db
    .prepare("SELECT * FROM domain_questions WHERE building_id=? AND day=? ORDER BY created_at")
    .all(buildingId, day) as DomainQuestionRow[];
}

export function createDomainQuestions(
  buildingId: string,
  day: string,
  items: { kind: "fill" | "judge" | "answer"; prompt: string; answer: string; aliases?: string[] }[],
) {
  const stmt = db.prepare(
    "INSERT INTO domain_questions(id,building_id,kind,prompt,answer,aliases,day,created_at) VALUES(?,?,?,?,?,?,?,?)",
  );
  for (const it of items)
    stmt.run(uid(), buildingId, it.kind, it.prompt, it.answer, JSON.stringify(it.aliases ?? []), day, now());
}

export function listDirections(worldId: string): DirectionRow[] {
  return db
    .prepare("SELECT * FROM directions WHERE world_id=? ORDER BY created_at")
    .all(worldId) as DirectionRow[];
}

export function consumeDirection(id: string, spanId: string | null = null) {
  db.prepare("UPDATE directions SET status='consumed', consumed_span_id=? WHERE id=?").run(spanId, id);
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
  const fingerprint = [...steps].sort().join("|") || `${kind}:${anchor}`;
  db.prepare(
    "INSERT INTO buildings(id,world_id,kind,anchor,title,sub,md,steps,status,version,basis,fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    worldId,
    kind,
    anchor,
    title,
    sub,
    md,
    JSON.stringify(steps),
    "detected",
    1,
    JSON.stringify({ kind, anchor }),
    fingerprint,
    now(),
  );
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
