import { db } from "./connection.js";

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
CREATE TABLE IF NOT EXISTS directions(
  id TEXT PRIMARY KEY, world_id TEXT NOT NULL, node_id TEXT NOT NULL,
  question TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
  target_hint TEXT, status TEXT NOT NULL DEFAULT 'open',
  consumed_span_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_directions_world ON directions(world_id);
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
  // 方向线预先计划好的延伸节点
  ["target_name", "TEXT"],
  ["target_type", "TEXT"],
  ["target_definition", "TEXT"],
  ["target_aliases", "TEXT"],
  ["target_predicate", "TEXT"],
  ["target_label", "TEXT"],
] as const) {
  if (!columnNames("edges").includes(col)) db.exec(`ALTER TABLE edges ADD COLUMN ${col} ${ddl}`);
}
// 方向表：生成方向时就把延伸节点计划好（名称/类型/定义/关系）
for (const [col, ddl] of [
  ["target_name", "TEXT"],
  ["target_type", "TEXT"],
  ["target_definition", "TEXT"],
  ["target_aliases", "TEXT"],
  ["target_predicate", "TEXT"],
  ["target_label", "TEXT"],
] as const) {
  if (!columnNames("directions").includes(col)) db.exec(`ALTER TABLE directions ADD COLUMN ${col} ${ddl}`);
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
