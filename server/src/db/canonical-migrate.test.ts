import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyStageA, inspectStageA } from "./canonical-migrate.js";

const dbPath = path.join(os.tmpdir(), `blouck-migrate-${Date.now()}.db`);

function freshOldDb() {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE edges(
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, src TEXT NOT NULL, dst TEXT NOT NULL,
      kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', consumed INTEGER NOT NULL DEFAULT 0
    );
  `);
  const stmt = db.prepare("INSERT INTO edges(id,world_id,src,dst,kind,consumed) VALUES(?,?,?,?,?,?)");
  stmt.run("e1", "w", "a", "b", "formal", 0);
  stmt.run("e2", "w", "a", "c", "source", 0);
  stmt.run("e3", "w", "a", "d", "suggest", 0);
  stmt.run("e4", "w", "a", "a", "direction", 1);
  return db;
}

test("Stage A：加 kind_v2/consumed_v2、映射全 kind、幂等", () => {
  const db = freshOldDb();
  try {
    const before = inspectStageA(db);
    assert.equal(before.edges, 4);
    assert.equal(before.missingKindV2, 4);
    assert.equal(before.missingConsumedV2, 4);

    const after = applyStageA(db);
    assert.equal(after.missingKindV2, 0);
    assert.equal(after.kindMismatch, 0);
    assert.equal(after.missingConsumedV2, 0);
    assert.deepEqual(
      db.prepare("SELECT id, kind_v2, consumed_v2 FROM edges ORDER BY id").all().map((r: any) => [r.kind_v2, r.consumed_v2]),
      [
        ["relation", 0],
        ["sequence", 0],
        ["hint", 0],
        ["exploration", 1],
      ],
    );

    const again = applyStageA(db);
    assert.equal(again.missingKindV2, 0);
    assert.equal(again.kindMismatch, 0);
    assert.equal(again.missingConsumedV2, 0);
  } finally {
    db.close();
    fs.rmSync(dbPath, { force: true });
  }
});
