import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-worker-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addEdge, addNode, createWorld, db } = await import("./db.js");
const { enqueueGenerationJob, getGenerationJob, getNodeDocRow, getRelationDocRow } = await import(
  "./db/docs.js"
);
const { runOneGenerationJob } = await import("./services/generationWorker.js");
const { mockLLM } = await import("./providers/mock.js");

test("worker：node_doc/relation_doc 串行执行、幂等入队", async () => {
  const world = createWorld("worker-test", "根");
  const a = addNode(world.id, "A", 10, 10, "", { definition: "A 定义" });
  const b = addNode(world.id, "B", 20, 20, "", { definition: "B 定义" });
  const edge = addEdge(world.id, a.id, b.id, "formal", "A 依赖 B", null, "", {
    predicate: "prerequisite",
    evidence: "A 依赖 B",
  });

  const j1 = enqueueGenerationJob(world.id, "node_doc", a.id);
  const j1b = enqueueGenerationJob(world.id, "node_doc", a.id);
  assert.equal(j1, j1b, "pending job should be idempotent");
  assert.ok(j1);

  assert.equal(await runOneGenerationJob(mockLLM), true);
  assert.equal(getGenerationJob(j1!)?.status, "done");
  assert.ok(getNodeDocRow(a.id), "node doc should be written");

  const j2 = enqueueGenerationJob(world.id, "relation_doc", edge.id);
  assert.ok(j2);
  assert.equal(await runOneGenerationJob(mockLLM), true);
  assert.equal(getGenerationJob(j2!)?.status, "done");
  assert.ok(getRelationDocRow(edge.id), "relation doc should be written");

  assert.equal(await runOneGenerationJob(mockLLM), false, "empty queue returns false");
});

test.after(() => {
  try {
    db.close();
  } catch {}
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch {}
  }
});
