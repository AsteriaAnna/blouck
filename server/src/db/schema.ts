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
// V3 提示池：score/display 由 services/hints.ts 刷新
if (!columnNames("edges").includes("hint_score")) db.exec("ALTER TABLE edges ADD COLUMN hint_score REAL NOT NULL DEFAULT 0");
if (!columnNames("edges").includes("hint_display")) db.exec("ALTER TABLE edges ADD COLUMN hint_display INTEGER NOT NULL DEFAULT 0");

// P2 Stage A/B：canonical 双写列 + 回填。旧代码继续读 kind，canonical 视图读 kind_v2。
if (!columnNames("edges").includes("kind_v2")) db.exec("ALTER TABLE edges ADD COLUMN kind_v2 TEXT");
if (!columnNames("edges").includes("consumed_v2")) db.exec("ALTER TABLE edges ADD COLUMN consumed_v2 INTEGER");
const kindV2Sql = `CASE kind
  WHEN 'formal' THEN 'relation'
  WHEN 'source' THEN 'sequence'
  WHEN 'suggest' THEN 'hint'
  WHEN 'direction' THEN 'exploration'
  ELSE kind END`;
db.exec(`UPDATE edges SET kind_v2 = ${kindV2Sql} WHERE kind_v2 IS NULL OR kind_v2 IS NOT (${kindV2Sql})`);
db.exec("UPDATE edges SET consumed_v2 = consumed WHERE consumed_v2 IS NULL OR consumed_v2 <> consumed");
// 双写 trigger：旧代码仍只写 kind/consumed，新列自动同步。
db.exec(`
  DROP TRIGGER IF EXISTS trg_edges_canonical_ai;
  CREATE TRIGGER trg_edges_canonical_ai AFTER INSERT ON edges
  BEGIN
    UPDATE edges SET
      kind_v2 = CASE NEW.kind
        WHEN 'formal' THEN 'relation'
        WHEN 'source' THEN 'sequence'
        WHEN 'suggest' THEN 'hint'
        WHEN 'direction' THEN 'exploration'
        ELSE NEW.kind END,
      consumed_v2 = NEW.consumed
    WHERE id = NEW.id;
  END;
  DROP TRIGGER IF EXISTS trg_edges_canonical_au;
  CREATE TRIGGER trg_edges_canonical_au AFTER UPDATE OF kind, consumed ON edges
  BEGIN
    UPDATE edges SET
      kind_v2 = CASE NEW.kind
        WHEN 'formal' THEN 'relation'
        WHEN 'source' THEN 'sequence'
        WHEN 'suggest' THEN 'hint'
        WHEN 'direction' THEN 'exploration'
        ELSE NEW.kind END,
      consumed_v2 = NEW.consumed
    WHERE id = NEW.id;
  END;
`);

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


/*
 * P2 兼容层：不改旧表/旧查询，先提供 canonical 只读视图。
 * - edges_canonical：DB kind → 产品 line_type/line_state；新代码/报表可直接读。
 * - dungeons：产品名视图；底层仍是 buildings，迁移期保持双向兼容。
 * 每次启动重建，保证视图定义随代码更新。
 */
db.exec(`
DROP VIEW IF EXISTS edges_canonical;
CREATE VIEW edges_canonical AS
SELECT *,
  COALESCE(kind_v2,
    CASE kind
      WHEN 'formal' THEN 'relation'
      WHEN 'source' THEN 'sequence'
      WHEN 'suggest' THEN 'hint'
      WHEN 'direction' THEN 'exploration'
      ELSE kind
    END
  ) AS line_type,
  CASE COALESCE(kind_v2, kind)
    WHEN 'relation' THEN 'confirmed'
    WHEN 'sequence' THEN 'provenance'
    WHEN 'hint' THEN 'proposed'
    WHEN 'exploration' THEN CASE WHEN COALESCE(consumed_v2, consumed)=1 THEN 'consumed' ELSE 'planned' END
    WHEN 'formal' THEN 'confirmed'
    WHEN 'source' THEN 'provenance'
    WHEN 'suggest' THEN 'proposed'
    WHEN 'direction' THEN CASE WHEN COALESCE(consumed_v2, consumed)=1 THEN 'consumed' ELSE 'planned' END
    ELSE 'unknown'
  END AS line_state
FROM edges;

DROP VIEW IF EXISTS dungeons;
CREATE VIEW dungeons AS SELECT * FROM buildings;
`);


/* ---------- V3 Phase 0：理解卡 / 候选 / 生成任务 ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS node_docs(
  node_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  doc_json TEXT NOT NULL DEFAULT '{}',
  notes_md TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL DEFAULT '',
  generated_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_node_docs_world ON node_docs(world_id);

CREATE TABLE IF NOT EXISTS relation_docs(
  edge_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  doc_json TEXT NOT NULL DEFAULT '{}',
  notes_md TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL DEFAULT '',
  generated_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_relation_docs_world ON relation_docs(world_id);

CREATE TABLE IF NOT EXISTS node_candidates(
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT '概念',
  definition TEXT NOT NULL DEFAULT '',
  aliases TEXT NOT NULL DEFAULT '[]',
  evidence TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_node_candidates_world ON node_candidates(world_id, status);

CREATE TABLE IF NOT EXISTS generation_jobs(
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status, created_at);
`);


/* ---------- V3 Phase 2：关系练习 ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS edge_practice(
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edge_practice_edge ON edge_practice(edge_id);
CREATE TABLE IF NOT EXISTS edge_attempts(
  id TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL,
  correct INTEGER NOT NULL,
  at INTEGER NOT NULL
);
`);


/* ---------- V3 指标事件（本地、单用户） ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS events(
  id TEXT PRIMARY KEY,
  world_id TEXT,
  type TEXT NOT NULL,
  target_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_world_type ON events(world_id, type, created_at);
`);
