import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-stats-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addEdge, addNode, createBuilding, createSourceSpan, createWorld, db, setBuildingStatus } =
  await import("./db.js");
const { ensureUnderstandingTask } = await import("./services/understanding.js");
const { learningStats, learningTrend, learningCsv } = await import("./services/learningStats.js");
const { trackEvent } = await import("./db/events.js");
const { mockLLM } = await import("./providers/mock.js");
const { answerUnderstandingTask } = await import("./services/understanding.js");

test("学习指标：任务/作答/卡片/方向/副本汇总", async () => {
  const world = createWorld("stats-test", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);
  createSourceSpan(world.id, "A 是一种 B 的实现。");
  const edge = addEdge(world.id, a.id, b.id, "formal", "A 是一种 B", null, "", {
    predicate: "kindOf",
    evidence: "A 是一种 B 的实现",
  });
  const t1 = await ensureUnderstandingTask(edge.id, mockLLM, "boundary");
  await ensureUnderstandingTask(edge.id, mockLLM, "counterexample");
  const row = db.prepare("SELECT correct_choice FROM understanding_tasks WHERE id=?").get(t1.task!.id) as {
    correct_choice: string;
  };
  await answerUnderstandingTask(t1.task!.id, row.correct_choice, t1.task!.rubric.join("；"), mockLLM);
  trackEvent({ worldId: world.id, type: "node_card_open" });
  trackEvent({ worldId: world.id, type: "direction_explore" });
  const building = createBuilding(world.id, "domain", a.id, "副本", "", "", [a.id, b.id]);
  setBuildingStatus(building.id, "cleared");

  const s = learningStats(world.id);
  assert.equal(s.tasks.total, 2);
  assert.equal(s.tasks.byKind.boundary, 1);
  assert.equal(s.tasks.byKind.counterexample, 1);
  assert.equal(s.attempts.total, 1);
  assert.equal(s.attempts.correct, 1);
  assert.equal(s.attempts.rate, 1);
  assert.equal(s.cards.nodeOpen, 1);
  assert.equal(s.directions, 1);
  assert.equal(s.dungeons.cleared, 1);

  const trend = learningTrend(world.id, 7);
  assert.equal(trend.length, 7);
  assert.equal(trend[trend.length - 1].attempts, 1);
  assert.equal(trend[trend.length - 1].correct, 1);
  assert.equal(trend[trend.length - 1].tasks, 2);
  assert.equal(trend[trend.length - 1].nodeCards, 1);

  const csv = learningCsv(world.id, 7);
  assert.ok(csv.startsWith("day,attempts,correct,avgExplanation,tasks,nodeCards,directions"));
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 8);
  assert.ok(lines[lines.length - 1].includes(",1,1,"));
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
