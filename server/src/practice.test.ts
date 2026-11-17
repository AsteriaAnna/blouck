import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-practice-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addEdge, addNode, createWorld, db } = await import("./db.js");
const { listEdgePractice } = await import("./db/practice.js");
const { answerRelationPractice, ensureRelationPractice } = await import("./services/practice.js");
const { mockLLM } = await import("./providers/mock.js");

test("关系练习：生成 3 题、隐藏答案、缓存、判题记录", async () => {
  const world = createWorld("practice-test", "根");
  const a = addNode(world.id, "A", 0, 0, "", { definition: "A 定义" });
  const b = addNode(world.id, "B", 100, 0, "", { definition: "B 定义" });
  const edge = addEdge(world.id, a.id, b.id, "formal", "A 是一种 B", null, "", {
    predicate: "kindOf",
    evidence: "A 是一种 B 的实现",
  });

  const first = await ensureRelationPractice(edge.id, mockLLM);
  assert.equal(first.items.length, 3);
  assert.ok(first.items.every((x) => !("answer" in x)));
  const rows = listEdgePractice(edge.id);
  assert.equal(rows.length, 3);

  const again = await ensureRelationPractice(edge.id, mockLLM);
  assert.deepEqual(
    again.items.map((x) => x.id),
    first.items.map((x) => x.id),
    "practice should be cached",
  );

  const result = await answerRelationPractice(rows[0].id, rows[0].answer, mockLLM);
  assert.ok(result);
  assert.equal(result!.correct, true);
  assert.equal(result!.progress.correct, 1);
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
