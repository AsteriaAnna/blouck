import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-dirservice-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addDirection, addEdge, addNode, computeFrontier, createWorld, db, getGraph, listDirections } = await import("./db.js");
const { consumeDirectionEdge, materializeDirectionEdges } = await import("./services/directions.js");

test("materialize: 每节点最多 2 条，重复执行幂等", () => {
  const world = createWorld("materialize-test", "root");
  const root = getGraph(world.id).nodes[0];
  const a = addNode(world.id, "A", 100, 100);
  for (const q of ["方向一是什么？", "方向二是什么？", "方向三是什么？"]) {
    addDirection(world.id, a.id, q, "test", { name: `目标${q}` });
  }
  computeFrontier(world.id);
  materializeDirectionEdges(world.id);
  let dirs = getGraph(world.id).edges.filter((e) => e.kind === "direction");
  assert.equal(dirs.length, 2);
  assert.ok(dirs.every((e) => e.src === a.id && e.dst === a.id));

  materializeDirectionEdges(world.id);
  dirs = getGraph(world.id).edges.filter((e) => e.kind === "direction");
  assert.equal(dirs.length, 2, "materialize must be idempotent");
  assert.ok(root);
});

test("materialize: 非 frontier 的方向边被删除", () => {
  const world = createWorld("materialize-frontier-test", "root");
  const root = getGraph(world.id).nodes[0];
  const a = addNode(world.id, "A2", 100, 100);
  const b = addNode(world.id, "B2", 200, 200);
  addDirection(world.id, a.id, "A 的下一步？", "test", { name: "A next" });
  computeFrontier(world.id);
  materializeDirectionEdges(world.id);
  assert.equal(getGraph(world.id).edges.filter((e) => e.kind === "direction").length, 1);

  // A 有 formal 出边后不再是 frontier，方向边应删除
  addEdge(world.id, a.id, b.id, "formal", "依赖", null, "", {
    predicate: "related",
    evidence: "A 依赖 B",
  });
  computeFrontier(world.id);
  materializeDirectionEdges(world.id);
  assert.equal(
    getGraph(world.id).edges.filter((e) => e.kind === "direction" && e.src === a.id).length,
    0,
  );
  assert.ok(root);
});

test("consume: directions 状态 consumed，投影边只打 consumed 标记", () => {
  const world = createWorld("consume-test", "root");
  const root = getGraph(world.id).nodes[0];
  const dir = addDirection(world.id, root.id, "下一步探索什么？", "test", { name: "下一步" });
  computeFrontier(world.id);
  materializeDirectionEdges(world.id);
  const edge = getGraph(world.id).edges.find((e) => e.kind === "direction");
  assert.ok(edge, "direction projection should exist");
  assert.equal(consumeDirectionEdge(edge!.id), true);
  assert.equal(listDirections(world.id).find((d) => d.id === dir.id)?.status, "consumed");
  assert.equal(getGraph(world.id).edges.find((e) => e.id === edge!.id)?.consumed, 1);
  const v2 = db
    .prepare("SELECT kind_v2, consumed_v2, line_type, line_state FROM edges_canonical WHERE id=?")
    .get(edge!.id) as {
    kind_v2: string;
    consumed_v2: number;
    line_type: string;
    line_state: string;
  };
  assert.equal(v2.kind_v2, "exploration");
  assert.equal(v2.consumed_v2, 1);
  assert.equal(v2.line_type, "exploration");
  assert.equal(v2.line_state, "consumed");
  assert.equal(consumeDirectionEdge(edge!.id), false, "second consume should be rejected");
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
