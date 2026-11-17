import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

/**
 * 用“旧 schema + 旧数据”的库启动当前 server：
 * - edges 只有旧列；
 * - server 启动时必须自动加 kind_v2/consumed_v2、回填、建 trigger/view；
 * - seed 仍能插入（旧代码只写 kind），API 仍返回 canonical。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, "..");
const port = 8898;
const base = `http://127.0.0.1:${port}`;
const dbPath = path.join(os.tmpdir(), `blouck-legacy-${Date.now()}.db`);
let child: ReturnType<typeof spawn> | null = null;

function makeLegacyDb() {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE edges(
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      md TEXT NOT NULL DEFAULT '',
      question TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  db.prepare(
    "INSERT INTO edges(id,world_id,src,dst,kind,label,md,question,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run("old-e1", "old-world", "a", "b", "formal", "旧关系", "", null, Date.now());
  db.close();
}

async function waitHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("legacy server did not start");
}

test.before(async () => {
  makeLegacyDb();
  child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: serverDir,
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      DEEPSEEK_API_KEY: "",
      DOUBAO_ASR_APP_ID: "",
      DOUBAO_ASR_TOKEN: "",
    },
  });
  await waitHealth();
});

test("旧库启动：自动迁移 + trigger 双写 + canonical API", async () => {
  const worlds = await (await fetch(base + "/api/worlds")).json();
  assert.ok(Array.isArray(worlds.worlds));
  const demo = worlds.worlds.find((w: any) => w.is_demo === 1);
  assert.ok(demo, "seed demo should exist");

  const graph = await (await fetch(`${base}/api/worlds/${demo.id}`)).json();
  assert.ok(graph.edges.length > 0);
  assert.ok(graph.edges.every((e: any) => e.line_type), "all edges need canonical line_type");
  assert.ok(graph.edges.some((e: any) => e.line_type === "relation"));

  // 旧行也要被回填/视图读到
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT kind, kind_v2, line_type FROM edges_canonical WHERE id='old-e1'").get() as any;
    assert.equal(row.kind, "formal");
    assert.equal(row.kind_v2, "relation");
    assert.equal(row.line_type, "relation");
    const trigger = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_edges_canonical_ai'")
      .get();
    assert.ok(trigger);
  } finally {
    db.close();
  }
});

test.after(() => {
  child?.kill();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch {}
  }
});
