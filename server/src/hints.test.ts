import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-hints-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addEdge, addNode, createWorld, db, getGraph } = await import("./db.js");
const { refreshHintDisplay } = await import("./services/hints.js");

test("提示池：按置信度/新近/热度排序，地图只显示 top-k", () => {
  const world = createWorld("hint-test", "根");
  const root = getGraph(world.id).nodes[0];
  const a = addNode(world.id, "A", 10, 10);
  const b = addNode(world.id, "B", 20, 20);
  const c = addNode(world.id, "C", 30, 30);
  addEdge(world.id, root.id, a.id, "suggest", "低", null, "", { confidence: 0.5 });
  addEdge(world.id, root.id, b.id, "suggest", "高", null, "", { confidence: 0.95 });
  addEdge(world.id, root.id, c.id, "suggest", "中", null, "", { confidence: 0.75 });

  refreshHintDisplay(world.id, 2);
  const edges = getGraph(world.id).edges.filter((e) => e.kind === "suggest");
  const shown = edges.filter((e) => e.hint_display === 1);
  assert.equal(shown.length, 2);
  assert.ok(shown.some((e) => e.label === "高"));
  assert.ok(shown.some((e) => e.label === "中"));
  assert.ok(edges.every((e) => e.hint_score !== undefined));

  refreshHintDisplay(world.id, 1);
  assert.equal(getGraph(world.id).edges.filter((e) => e.hint_display === 1).length, 1);
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
