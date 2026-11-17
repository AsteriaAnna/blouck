import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-understanding-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addEdge, addNode, createSourceSpan, createWorld, db } = await import("./db.js");
const { getUnderstandingTaskByEdge } = await import("./db/understanding.js");
const { answerUnderstandingTask, ensureUnderstandingTask } = await import("./services/understanding.js");
const { mockLLM } = await import("./providers/mock.js");

test("辨析任务：无源不出题", async () => {
  const world = createWorld("understanding-nosrc", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);
  const edge = addEdge(world.id, a.id, b.id, "formal", "A 与 B", null, "", {
    predicate: "related",
    evidence: "原文没有的句子",
  });
  const p = await ensureUnderstandingTask(edge.id, mockLLM);
  assert.equal(p.status, "source_required");
  assert.equal(p.task, null);
});

test("辨析任务：带原文引用、选择+解释、判题", async () => {
  const world = createWorld("understanding-test", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);
  createSourceSpan(world.id, "A 是一种 B 的实现。");
  const edge = addEdge(world.id, a.id, b.id, "formal", "A 是一种 B", null, "", {
    predicate: "kindOf",
    evidence: "A 是一种 B 的实现",
  });
  const p = await ensureUnderstandingTask(edge.id, mockLLM);
  assert.equal(p.status, "ready");
  assert.ok(p.task);
  assert.ok(p.task!.choices.length >= 3);
  assert.ok(p.task!.evidence_quote.includes("A 是一种 B"));
  assert.equal("correct_choice" in p.task!, false, "correct answer must not be exposed");

  const row = getUnderstandingTaskByEdge(edge.id)!;
  const result = await answerUnderstandingTask(
    row.id,
    row.correct_choice,
    "依据原文 A 是一种 B 的实现，所以是 kindOf。",
    mockLLM,
  );
  assert.ok(result);
  assert.equal(result!.choice_correct, true);
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
