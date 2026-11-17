import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// 必须在 import db 之前设置，db.ts 初始化时读取 env.
const dbPath = path.join(os.tmpdir(), `blouck-test-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addDirection, addEdge, addNode, commitStreamEdges, computeFrontier, createWorld, db, getGraph, listDirections } =
  await import("./db.js");

test("computeFrontier: 只看 formal 出边", () => {
  const world = createWorld("frontier-test", "root");
  const root = getGraph(world.id).nodes[0];
  const a = addNode(world.id, "A", 10, 10);
  const b = addNode(world.id, "B", 20, 20);
  addEdge(world.id, root.id, a.id, "source", "来路");
  addEdge(world.id, a.id, b.id, "formal", "依赖", null, "", {
    predicate: "related",
    evidence: "A 依赖 B",
  });
  computeFrontier(world.id);
  const nodes = getGraph(world.id).nodes;
  assert.equal(nodes.find((n) => n.id === a.id)?.frontier, 0);
  assert.equal(nodes.find((n) => n.id === b.id)?.frontier, 1);

  const edges = getGraph(world.id).edges;
  const formalEdge = edges.find((e) => e.kind === "formal");
  assert.equal(formalEdge?.line_type, "relation");
  assert.equal(formalEdge?.line_state, "confirmed");
  const sourceEdge = edges.find((e) => e.kind === "source");
  assert.equal(sourceEdge?.line_type, "sequence");
  assert.equal(sourceEdge?.line_state, "provenance");

  // P2 兼容视图：旧 kind 不迁移，也能直接读 canonical
  const viewFormal = db
    .prepare("SELECT line_type, line_state FROM edges_canonical WHERE id=?")
    .get(formalEdge!.id) as { line_type: string; line_state: string };
  assert.equal(viewFormal.line_type, "relation");
  assert.equal(viewFormal.line_state, "confirmed");
  const viewDungeons = db.prepare("SELECT COUNT(*) AS c FROM dungeons").get() as { c: number };
  const viewBuildings = db.prepare("SELECT COUNT(*) AS c FROM buildings").get() as { c: number };
  assert.equal(viewDungeons.c, viewBuildings.c);
});

test("commitStreamEdges: 只提升 stream suggest，source 不动", () => {
  const world = createWorld("commit-test", "root");
  const root = getGraph(world.id).nodes[0];
  const a = addNode(world.id, "A2", 10, 10);
  addEdge(world.id, root.id, a.id, "source", "来路", null, "", { origin: "stream" });
  addEdge(world.id, root.id, a.id, "suggest", "相关", null, "", {
    predicate: "related",
    evidence: "原文证据",
    origin: "stream",
  });
  commitStreamEdges(world.id);
  const edges = getGraph(world.id).edges;
  assert.equal(edges.filter((e) => e.kind === "suggest").length, 0);
  assert.equal(edges.filter((e) => e.kind === "formal").length, 1);
  assert.equal(edges.filter((e) => e.kind === "source").length, 1);
});

test("directions: add/list 状态为 open", () => {
  const world = createWorld("dir-test", "root");
  const root = getGraph(world.id).nodes[0];
  addDirection(world.id, root.id, "下一步探索什么？", "测试", {
    name: "新概念",
    type: "概念",
    definition: "测试定义",
  });
  const dirs = listDirections(world.id);
  assert.equal(dirs.length, 1);
  assert.equal(dirs[0].status, "open");
  assert.equal(dirs[0].target_name, "新概念");
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
