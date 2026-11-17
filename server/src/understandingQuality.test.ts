import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-quality-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addEdge, addNode, createSourceSpan, createWorld, db } = await import("./db.js");
const { createUnderstandingTask } = await import("./db/understanding.js");
const { ensureUnderstandingTask } = await import("./services/understanding.js");
const { auditUnderstandingTask } = await import("./services/understandingQuality.js");
const { mockLLM } = await import("./providers/mock.js");

test("质量审计：有源/有误解/rubric 的好题高分；定义题/无源低分", async () => {
  const world = createWorld("quality-test", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);
  createSourceSpan(world.id, "A 是一种 B 的实现。");
  const edge = addEdge(world.id, a.id, b.id, "formal", "A 是一种 B", null, "", {
    predicate: "kindOf",
    evidence: "A 是一种 B 的实现",
  });
  const p = await ensureUnderstandingTask(edge.id, mockLLM);
  const good = auditUnderstandingTask(p.task!.id);
  assert.ok(good);
  assert.ok(good!.score >= 80, `good task score ${good!.score}`);

  const bad = createUnderstandingTask({
    world_id: world.id,
    edge_id: "x",
    target_type: "edge",
    node_id: null,
    task_kind: "boundary",
    learning_goal: "discriminate",
    misconception: "",
    stem: "A 是什么？",
    answer_type: "short",
    choices_json: "[]",
    correct_choice: "",
    rubric_json: "[]",
    evidence_quote: "",
    source_span_id: null,
    follow_up: "",
  });
  const report = auditUnderstandingTask(bad.id);
  assert.ok(report);
  assert.ok(report!.score < 60);
  assert.ok(report!.flags.includes("evidence"));
  assert.ok(report!.flags.includes("notDefinition"));
  assert.ok(report!.flags.includes("comparison"));
  assert.ok(report!.flags.includes("choices"));

  // 反例：真实 LLM 常见措辞不应被误判
  const realish = createUnderstandingTask({
    world_id: world.id,
    edge_id: "y",
    target_type: "edge",
    node_id: null,
    task_kind: "counterexample",
    learning_goal: "discriminate",
    misconception: "把流程顺序关系误判为同类关系",
    stem: "有人说两者是同一类技术。请判断这种说法错在哪里，并说明到底是什么关系。",
    answer_type: "choice_explain",
    choices_json: JSON.stringify([
      { id: "a", text: "前置关系" },
      { id: "b", text: "同类关系" },
    ]),
    correct_choice: "a",
    rubric_json: JSON.stringify(["指出错误", "说明真实关系"]),
    evidence_quote: "A 是一种 B 的实现",
    source_span_id: null,
    follow_up: "",
  });
  const r2 = auditUnderstandingTask(realish.id)!;
  assert.equal(r2.checks.notDefinition, true, "‘是什么关系’不是定义题");
  assert.equal(r2.checks.comparison, true, "‘错在哪里’算辨析");
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
