import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-reviews-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addEdge, addNode, createSourceSpan, createWorld, db } = await import("./db.js");
const { ensureUnderstandingTask } = await import("./services/understanding.js");
const { countTaskReviews, listTaskReviews, recordTaskReview } = await import("./db/taskReviews.js");
const { calibrationReport, learningStats } = await import("./services/learningStats.js");
const { mockLLM } = await import("./providers/mock.js");

test("人工反馈：好题/差题记录并汇总", async () => {
  const world = createWorld("reviews", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);
  createSourceSpan(world.id, "A 是一种 B。");
  const edge = addEdge(world.id, a.id, b.id, "formal", "A 是一种 B", null, "", {
    predicate: "kindOf",
    evidence: "A 是一种 B",
  });
  const task = await ensureUnderstandingTask(edge.id, mockLLM);
  recordTaskReview(task.task!.id, "good");
  recordTaskReview(task.task!.id, "bad", "太简单");
  assert.equal(listTaskReviews(task.task!.id).length, 2);
  assert.deepEqual(countTaskReviews(world.id), { good: 1, bad: 1 });
  assert.deepEqual(learningStats(world.id).reviews, { good: 1, bad: 1 });

  const cal = calibrationReport(world.id);
  assert.equal(cal.good, 1);
  assert.equal(cal.bad, 1);
  assert.ok(cal.avgGood >= 80);
  assert.equal(cal.examples.length, 2);
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
