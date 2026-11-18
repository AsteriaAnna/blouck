import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-buildings-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const {
  addEdge,
  addNode,
  computeFrontier,
  computeTier,
  createBuilding,
  createQuizzes,
  createWorld,
  db,
  getBuilding,
  listQuizzes,
  recordAttempt,
  refreshBuildingStatus,
  setNodeTier,
} = await import("./db.js");
const { dungeonReadiness } = await import("./services/buildings.js");

test("答题链路：short+judge 正确 → tier=1 → 副本 playable", () => {
  const world = createWorld("answer-unlock-test", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);
  const domain = createBuilding(world.id, "domain", a.id, "领域", "", "", [a.id, b.id]);
  createQuizzes(a.id, [
    { kind: "short", prompt: "短题", answer: "答案" },
    { kind: "judge", prompt: "判断题", answer: "对" },
  ]);
  const quizzes = listQuizzes(a.id);
  assert.equal(computeTier(a.id), 0);
  recordAttempt(quizzes.find((q) => q.kind === "short")!.id, true);
  assert.equal(computeTier(a.id), 0, "only short is not enough");
  recordAttempt(quizzes.find((q) => q.kind === "judge")!.id, true);
  assert.equal(computeTier(a.id), 1);
  setNodeTier(b.id, 1);
  refreshBuildingStatus(a.id);
  assert.equal(getBuilding(domain.id)?.status, "playable");
});

test("副本解锁：节点 tier>=1 后 domain/flow 从 detected → playable", () => {
  const world = createWorld("unlock-test", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);

  const domain = createBuilding(world.id, "domain", a.id, "领域", "", "", [a.id, b.id]);
  const flow = createBuilding(world.id, "flow", a.id, "流程", "", "", [a.id, b.id]);
  refreshBuildingStatus(a.id);
  assert.equal(getBuilding(domain.id)?.status, "detected");
  assert.equal(getBuilding(flow.id)?.status, "detected");

  setNodeTier(a.id, 1);
  setNodeTier(b.id, 1);
  refreshBuildingStatus(a.id);
  assert.equal(getBuilding(domain.id)?.status, "playable");
  assert.equal(getBuilding(flow.id)?.status, "playable");
});

test("副本发现门槛：节点/证据关系不够时不检测", () => {
  const world = createWorld("readiness", "根");
  const a = addNode(world.id, "A", 0, 0);
  const b = addNode(world.id, "B", 100, 0);
  addEdge(world.id, a.id, b.id, "formal", "A→B", null, "", {
    predicate: "related",
    evidence: "A 与 B 有关",
  });
  assert.equal(dungeonReadiness(world.id).ready, false);

  for (let i = 0; i < 8; i++) addNode(world.id, `N${i}`, i * 10, 200);
  for (let i = 0; i < 4; i++) {
    const src = addNode(world.id, `S${i}`, i * 20, 400);
    const dst = addNode(world.id, `D${i}`, i * 20, 500);
    addEdge(world.id, src.id, dst.id, "formal", `S${i}→D${i}`, null, "", {
      predicate: "prerequisite",
      evidence: `S${i} 先于 D${i}`,
    });
  }
  computeFrontier(world.id);
  const r = dungeonReadiness(world.id);
  assert.equal(r.nodes >= 8, true);
  assert.equal(r.evidenceEdges >= 4, true);
  assert.equal(r.ready, true);
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
