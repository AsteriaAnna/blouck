import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-events-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { trackEvent, summarizeEvents } = await import("./db/events.js");
const { db } = await import("./db.js");

test("指标事件：写入/按 world 过滤/按 type 汇总", () => {
  trackEvent({ worldId: "w1", type: "node_card_open", targetId: "n1" });
  trackEvent({ worldId: "w1", type: "direction_explore", targetId: "d1" });
  trackEvent({ worldId: "w2", type: "node_card_open", targetId: "n2" });
  const all = summarizeEvents();
  assert.equal(all.total, 3);
  assert.ok(all.byType.some((x) => x.type === "node_card_open" && x.c === 2));
  const w1 = summarizeEvents("w1");
  assert.equal(w1.total, 2);
  assert.equal(w1.byType.length, 2);
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
