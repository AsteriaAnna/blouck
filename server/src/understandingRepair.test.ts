import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-repair-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addEdge, addNode, createSourceSpan, createWorld, db } = await import("./db.js");
const { ensureUnderstandingTask } = await import("./services/understanding.js");
const { auditUnderstandingTask } = await import("./services/understandingQuality.js");

function draft(over: any = {}) {
  return {
    learning_goal: "discriminate",
    misconception: "把归类关系当成组成关系",
    stem: "A 与 B 是哪种关系？为什么不是组成？",
    choices: [
      { id: "a", text: "A 是 B 的一种" },
      { id: "b", text: "A 是 B 的一部分" },
    ],
    correct_choice: "a",
    rubric: ["指出归类", "引用原文"],
    evidence_quote: "A 是一种 B",
    follow_up: "换一个例子还成立吗？",
    ...over,
  };
}

test("质量自检：低分题带缺失项重写一次，保留高分版本", async () => {
  const world = createWorld("repair-test", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);
  createSourceSpan(world.id, "A 是一种 B 的实现。");
  const edge = addEdge(world.id, a.id, b.id, "formal", "A 是一种 B", null, "", {
    predicate: "kindOf",
    evidence: "A 是一种 B",
  });
  let calls = 0;
  const repairPrompts: string[] = [];
  const fake = {
    async generateUnderstandingTask(input: any) {
      calls++;
      if (input.repair) repairPrompts.push(input.repair);
      if (calls === 1) {
        return draft({
          misconception: "",
          stem: "A 是什么？",
          choices: [{ id: "a", text: "A 是 B" }],
          rubric: [],
        });
      }
      return draft();
    },
  } as any;

  const p = await ensureUnderstandingTask(edge.id, fake);
  assert.equal(p.status, "ready");
  assert.equal(calls, 2);
  assert.equal(repairPrompts.length, 1);
  assert.ok(repairPrompts[0].includes("notDefinition") || repairPrompts[0].includes("comparison"));
  const report = auditUnderstandingTask(p.task!.id);
  assert.ok(report && report.score >= 80, `repaired score ${report?.score}`);
  const count = (db.prepare("SELECT COUNT(*) c FROM understanding_tasks").get() as { c: number }).c;
  assert.equal(count, 1, "low-quality first task should be deleted");
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
