import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-dseq-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addEdge, addNode, createBuilding, createSourceSpan, createWorld, db, getBuilding } =
  await import("./db.js");
const { ensureDungeonSequence, completeDungeonSequence } = await import(
  "./services/dungeonSequence.js"
);
const { answerUnderstandingTask } = await import("./services/understanding.js");
const { mockLLM } = await import("./providers/mock.js");

test("辨析副本：边界→反例→迁移，三关通过后 cleared", async () => {
  const world = createWorld("dungeon-seq", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);
  createSourceSpan(world.id, "A 是一种 B 的实现。");
  const edge = addEdge(world.id, a.id, b.id, "formal", "A 是一种 B", null, "", {
    predicate: "kindOf",
    evidence: "A 是一种 B 的实现",
  });
  const building = createBuilding(world.id, "domain", a.id, "领域", "", "", [a.id, b.id]);
  const seq = await ensureDungeonSequence(building.id, mockLLM);
  assert.equal(seq.status, "ready");
  assert.equal(seq.stages.length, 3);
  assert.deepEqual(
    seq.stages.map((s: any) => s.variant),
    ["boundary", "counterexample", "transfer"],
  );

  for (const s of seq.stages) {
    const row = db
      .prepare("SELECT correct_choice FROM understanding_tasks WHERE id=?")
      .get(s.task.id) as { correct_choice: string };
    const r = await answerUnderstandingTask(
      s.task.id,
      row.correct_choice,
      s.task.rubric.join("；"),
      mockLLM,
    );
    assert.ok(r);
  }
  const done = completeDungeonSequence(building.id, edge.id);
  assert.equal(done.cleared, true);
  assert.equal(getBuilding(building.id)?.status, "cleared");
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
