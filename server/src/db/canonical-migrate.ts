import { DatabaseSync } from "node:sqlite";

/**
 * P2 Stage A：给旧 edges 加 canonical 双写列并回填。
 * 不改旧 kind、不删旧列；幂等，可安全重复执行。
 * 真正的读写切换见 docs/engineering/migrations.md。
 */
const KIND_MAP_SQL = `CASE kind
  WHEN 'formal' THEN 'relation'
  WHEN 'source' THEN 'sequence'
  WHEN 'suggest' THEN 'hint'
  WHEN 'direction' THEN 'exploration'
  ELSE kind END`;

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

export function hasEdgesTable(db: DatabaseSync): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edges'").get(),
  );
}

export type StageAReport = {
  edges: number;
  missingKindV2: number;
  kindMismatch: number;
  missingConsumedV2: number;
  kinds: { kind: string; c: number }[];
};

/** 只读检查：不对 DB 做任何修改 */
export function inspectStageA(db: DatabaseSync): StageAReport {
  if (!hasEdgesTable(db)) throw new Error("edges table not found");
  const cols = columns(db, "edges");
  const edges = (db.prepare("SELECT COUNT(*) AS c FROM edges").get() as { c: number }).c;
  const kinds = db.prepare("SELECT kind, COUNT(*) AS c FROM edges GROUP BY kind ORDER BY kind").all() as {
    kind: string;
    c: number;
  }[];
  const missingKindV2 = cols.includes("kind_v2")
    ? (db.prepare("SELECT COUNT(*) AS c FROM edges WHERE kind_v2 IS NULL").get() as { c: number }).c
    : edges;
  const kindMismatch = cols.includes("kind_v2")
    ? (
        db
          .prepare(`SELECT COUNT(*) AS c FROM edges WHERE kind_v2 IS NOT (${KIND_MAP_SQL})`)
          .get() as { c: number }
      ).c
    : 0;
  const missingConsumedV2 = cols.includes("consumed_v2")
    ? (db.prepare("SELECT COUNT(*) AS c FROM edges WHERE consumed_v2 IS NULL").get() as { c: number }).c
    : edges;
  return { edges, missingKindV2, kindMismatch, missingConsumedV2, kinds };
}

/** 执行 Stage A：加列 + 回填；返回执行后的检查报告 */
export function applyStageA(db: DatabaseSync): StageAReport {
  if (!hasEdgesTable(db)) throw new Error("edges table not found");
  const cols = columns(db, "edges");
  db.exec("BEGIN");
  try {
    if (!cols.includes("kind_v2")) db.exec("ALTER TABLE edges ADD COLUMN kind_v2 TEXT");
    if (!cols.includes("consumed_v2")) db.exec("ALTER TABLE edges ADD COLUMN consumed_v2 INTEGER");
    db.exec(`UPDATE edges SET kind_v2 = ${KIND_MAP_SQL} WHERE kind_v2 IS NULL OR kind_v2 IS NOT (${KIND_MAP_SQL})`);
    db.exec("UPDATE edges SET consumed_v2 = consumed WHERE consumed_v2 IS NULL OR consumed_v2 <> consumed");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return inspectStageA(db);
}
