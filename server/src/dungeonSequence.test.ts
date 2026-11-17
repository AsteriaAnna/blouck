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
    assert.ok(s.task);
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
  const done = completeDungeonSequence(building.id);
  assert.equal(done.cleared, true);
  assert.equal(getBuilding(building.id)?.status, "cleared");
});

test("辨析副本：两条关系 → 多误解点 4 关", async () => {
  const world = createWorld("dungeon-multi", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);
  const c = addNode(world.id, "C", 200, 0);
  createSourceSpan(world.id, "A 包含 B。A 包含 C。");
  addEdge(world.id, a.id, b.id, "formal", "A 包含 B", null, "", {
    predicate: "partOf",
    evidence: "A 包含 B",
  });
  addEdge(world.id, a.id, c.id, "formal", "A 包含 C", null, "", {
    predicate: "partOf",
    evidence: "A 包含 C",
  });
  const building = createBuilding(world.id, "domain", a.id, "领域", "", "", [a.id, b.id, c.id]);
  const seq = await ensureDungeonSequence(building.id, mockLLM);
  assert.equal(seq.status, "ready");
  assert.equal(seq.stages.length, 4);
  assert.deepEqual(
    seq.stages.map((s: any) => s.variant),
    ["boundary", "counterexample", "boundary", "counterexample"],
  );
  for (const s of seq.stages) {
    assert.ok(s.task);
    const row = db
      .prepare("SELECT correct_choice FROM understanding_tasks WHERE id=?")
      .get(s.task.id) as { correct_choice: string };
    await answerUnderstandingTask(s.task.id, row.correct_choice, s.task.rubric.join("；"), mockLLM);
  }
  const done = completeDungeonSequence(building.id);
  assert.equal(done.cleared, true);
});

test("辨析副本：优先选更具辨析价值的关系（类型/证据）", async () => {
  const world = createWorld("dungeon-rank", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);
  const c = addNode(world.id, "C", 200, 0);
  createSourceSpan(world.id, "A 是一种 B 的实现，这是一种明确的归类关系。A 与 C 相关。");
  const weak = addEdge(world.id, a.id, c.id, "formal", "A 与 C 相关", null, "", {
    predicate: "related",
    evidence: "A 与 C 相关",
  });
  const strong = addEdge(world.id, a.id, b.id, "formal", "A 是一种 B", null, "", {
    predicate: "kindOf",
    evidence: "A 是一种 B 的实现，这是一种明确的归类关系",
  });
  const building = createBuilding(world.id, "domain", a.id, "领域", "", "", [a.id, b.id, c.id]);
  const seq = await ensureDungeonSequence(building.id, mockLLM);
  assert.equal(seq.status, "ready");
  assert.equal(seq.stages[0].edgeId, strong.id);
  assert.notEqual(seq.stages[0].edgeId, weak.id);
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
