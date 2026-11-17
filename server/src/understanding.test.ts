import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-understanding-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addEdge, addNode, createSourceSpan, createWorld, db } = await import("./db.js");
const { getUnderstandingTaskByEdge, getUnderstandingTaskByEdgeKind, getUnderstandingTaskByNode } = await import("./db/understanding.js");
const {
  answerUnderstandingTask,
  ensureNodeUnderstandingTask,
  ensureUnderstandingTask,
} = await import("./services/understanding.js");
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

test("节点辨析：无源不出题；有源生成边界任务", async () => {
  const world = createWorld("understanding-node", "根");
  const span = createSourceSpan(world.id, "RAG 包含检索，检索负责召回。");
  const a = addNode(world.id, "RAG", 0, 0, "", { definition: "检索增强生成", sourceSpanId: span.id });
  const b = addNode(world.id, "检索", 100, 0);
  addEdge(world.id, a.id, b.id, "formal", "包含", null, "", {
    predicate: "partOf",
    evidence: "RAG 包含检索",
  });
  const noSource = await ensureNodeUnderstandingTask(b.id, mockLLM);
  assert.equal(noSource.status, "source_required");

  const p = await ensureNodeUnderstandingTask(a.id, mockLLM);
  assert.equal(p.status, "ready");
  assert.ok(p.task);
  assert.ok(p.task!.evidence_quote.includes("RAG"));
  assert.equal("correct_choice" in p.task!, false);
  assert.ok(getUnderstandingTaskByNode(a.id));

  const row = getUnderstandingTaskByNode(a.id)!;
  const result = await answerUnderstandingTask(row.id, row.correct_choice, "依据原文，RAG 包含检索。", mockLLM);
  assert.ok(result);
});

test("辨析变体：反例题/纠错题独立缓存", async () => {
  const world = createWorld("understanding-variant", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);
  createSourceSpan(world.id, "A 是一种 B 的实现。");
  const edge = addEdge(world.id, a.id, b.id, "formal", "A 是一种 B", null, "", {
    predicate: "kindOf",
    evidence: "A 是一种 B 的实现",
  });
  const counter = await ensureUnderstandingTask(edge.id, mockLLM, "counterexample");
  assert.equal(counter.status, "ready");
  assert.ok(getUnderstandingTaskByEdgeKind(edge.id, "counterexample"));
  const boundary = await ensureUnderstandingTask(edge.id, mockLLM, "boundary");
  assert.equal(boundary.status, "ready");
  assert.notEqual(counter.task!.id, boundary.task!.id);
  const correction = await ensureUnderstandingTask(edge.id, mockLLM, "error_correction");
  assert.equal(correction.status, "ready");
  assert.ok(getUnderstandingTaskByEdgeKind(edge.id, "error_correction"));
  const transfer = await ensureUnderstandingTask(edge.id, mockLLM, "transfer");
  assert.equal(transfer.status, "ready");
  assert.ok(getUnderstandingTaskByEdgeKind(edge.id, "transfer"));
  assert.notEqual(transfer.task!.id, counter.task!.id);
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
