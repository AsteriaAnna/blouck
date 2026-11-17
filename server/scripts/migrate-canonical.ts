import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyStageA, inspectStageA } from "../src/db/canonical-migrate.js";

/**
 * 用法：
 *   pnpm --filter @blouck/server migrate:canonical -- --db server/data/blouck.db
 *   pnpm --filter @blouck/server migrate:canonical -- --db ... --apply
 *
 * 默认 dry-run；--apply 会先复制备份（<db>.bak-<timestamp>），再执行 Stage A。
 * 只加 kind_v2/consumed_v2 双写列，不改旧 kind、不删列。
 */
const args = process.argv.slice(2);
const dbArg = args.indexOf("--db");
const dbPath = dbArg >= 0 ? args[dbArg + 1] : "";
const apply = args.includes("--apply");

if (!dbPath) {
  console.error("missing --db <path>");
  process.exit(2);
}
if (!fs.existsSync(dbPath)) {
  console.error(`db not found: ${dbPath}`);
  process.exit(2);
}

const db = new DatabaseSync(dbPath);
try {
  const before = inspectStageA(db);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", before }, null, 2));
  if (!apply) {
    console.log("dry-run only; re-run with --apply to write kind_v2/consumed_v2");
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${dbPath}.bak-${stamp}`;
    fs.copyFileSync(dbPath, backup);
    const after = applyStageA(db);
    console.log(JSON.stringify({ backup: path.basename(backup), after }, null, 2));
  }
} finally {
  db.close();
}
