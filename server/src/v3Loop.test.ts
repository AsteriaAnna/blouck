import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-v3-loop-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const {
  addEdge,
  addNode,
  createBuilding,
  createSourceSpan,
  createWorld,
  db,
  getBuilding,
} = await import("./db.js");
const { ensureUnderstandingTask, answerUnderstandingTask } = await import("./services/understanding.js");
const { ensureDungeonSequence, completeDungeonSequence } = await import("./services/dungeonSequence.js");
const { learningStats } = await import("./services/learningStats.js");
const { mockLLM } = await import("./providers/mock.js");

test("V3 全链路：源→关系→辨析→三关副本→指标", async () => {
  // 1. 知识层：源 + 节点 + 带证据关系
  const world = createWorld("v3-loop", "根");
  const a = addNode(world.id, "RAG", 0, 0, "", { definition: "检索增强生成" });
  const b = addNode(world.id, "检索", 100, 0, "", { definition: "召回外部信息" });
  const span = createSourceSpan(world.id, "RAG 包含检索，检索负责召回。");
  const edge = addEdge(world.id, a.id, b.id, "formal", "RAG 包含检索", null, "", {
    predicate: "partOf",
    evidence: "RAG 包含检索",
  });

  // 2. 理解层：带原文的辨析任务 + 解释评分
  const task = await ensureUnderstandingTask(edge.id, mockLLM, "boundary");
  assert.equal(task.status, "ready");
  assert.ok(task.task);
  const taskRow = db
    .prepare("SELECT correct_choice FROM understanding_tasks WHERE id=?")
    .get(task.task!.id) as { correct_choice: string };
  const answered = await answerUnderstandingTask(
    task.task!.id,
    taskRow.correct_choice,
    task.task!.rubric.join("；"),
    mockLLM,
  );
  assert.ok(answered);
  assert.equal(answered!.correct, true);
  assert.ok(answered!.explanation_score > 0);

  // 3. 记忆层：副本三关（边界已缓存 → 反例 → 迁移）并通关
  const building = createBuilding(world.id, "domain", a.id, "领域副本", "", "", [a.id, b.id]);
  const seq = await ensureDungeonSequence(building.id, mockLLM);
  assert.equal(seq.status, "ready");
  assert.equal(seq.stages.length, 3);
  for (const stage of seq.stages) {
    assert.ok(stage.task);
    const row = db
      .prepare("SELECT correct_choice FROM understanding_tasks WHERE id=?")
      .get(stage.task.id) as { correct_choice: string };
    const r = await answerUnderstandingTask(
      stage.task.id,
      row.correct_choice,
      stage.task.rubric.join("；"),
      mockLLM,
    );
    assert.ok(r);
  }
  const done = completeDungeonSequence(building.id);
  assert.equal(done.cleared, true);
  assert.equal(getBuilding(building.id)?.status, "cleared");

  // 4. 指标层：任务/作答/解释分/副本
  const stats = learningStats(world.id);
  assert.ok(stats.tasks.total >= 3);
  assert.ok(stats.attempts.total >= 4);
  assert.equal(stats.attempts.correct, stats.attempts.total);
  assert.ok(stats.attempts.avgExplanationScore > 0);
  assert.equal(stats.dungeons.cleared, 1);
  assert.ok(span.id);
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
