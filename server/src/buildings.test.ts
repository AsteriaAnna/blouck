import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-buildings-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addNode, createBuilding, createWorld, db, getBuilding, refreshBuildingStatus, setNodeTier } =
  await import("./db.js");

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
