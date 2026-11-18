import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-demo-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { db, getGraph, seedDemoWorld } = await import("./db.js");

test("demo 世界：正式关系必须有 canonical predicate + 原文证据", () => {
  const world = seedDemoWorld();
  const graph = getGraph(world.id);
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n.name]));
  const allowed = new Set(["kindOf", "partOf", "prerequisite", "contrast", "alternative", "related"]);
  const formal = graph.edges.filter((e) => e.kind === "formal");

  assert.ok(formal.length >= 8);
  for (const e of formal) {
    assert.ok(allowed.has(e.predicate ?? ""), `bad predicate on ${e.id}: ${e.predicate}`);
    assert.ok(e.evidence.trim().length > 0, `missing evidence on ${e.id}`);
    assert.notEqual(e.src, e.dst, "self-loop is not a relation");
  }
  const bad = formal.find(
    (e) =>
      [byId[e.src], byId[e.dst]].sort().join("|") === ["上下文窗口", "向量数据库"].sort().join("|"),
  );
  assert.equal(bad, undefined, "向量数据库与上下文窗口不应被硬连成关系");

  const spans = db.prepare("SELECT COUNT(*) c FROM source_spans WHERE world_id=?").get(world.id) as {
    c: number;
  };
  assert.ok(spans.c >= 1);
  for (const n of graph.nodes) {
    assert.ok(n.source_span_id, `node ${n.name} missing source span`);
  }
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
