import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, "..");
const port = 8899;
const base = `http://127.0.0.1:${port}`;
const dbPath = path.join(os.tmpdir(), `blouck-it-${Date.now()}.db`);

let child: ReturnType<typeof spawn> | null = null;

async function waitHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
}

async function api(pathname: string, init?: RequestInit) {
  const r = await fetch(base + pathname, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

test.before(async () => {
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

test("mock 全链路：世界 → extract → stream segment/commit", async () => {
  const created = await api("/api/worlds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "integration", rootName: "RAG" }),
  });
  const world = created.world;
  assert.ok(world?.id);

  const extract = await api(`/api/worlds/${world.id}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "RAG 包含检索。检索包含向量检索。混合检索用于融合召回。" }),
  });
  assert.ok(Array.isArray(extract.nodes));
  assert.ok(extract.nodes.length >= 1);
  assert.ok(Array.isArray(extract.edges));

  // 幂等：同一段文字再抽一次，不应产生重复 (src,dst,kind,predicate) 边
  const extract2 = await api(`/api/worlds/${world.id}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "RAG 包含检索。检索包含向量检索。混合检索用于融合召回。" }),
  });
  const keys = extract2.edges.map((e: any) => `${e.src}|${e.dst}|${e.kind}|${e.predicate ?? ""}`);
  assert.equal(new Set(keys).size, keys.length, "duplicate edges after repeated extract");

  // 方向物化：只给 frontier、每节点最多 2 条
  const graph: any = await api(`/api/worlds/${world.id}`);
  const byId = new Map<string, any>(graph.nodes.map((n: any) => [n.id, n]));
  const perSrc = new Map<string, number>();
  for (const e of graph.edges.filter((x: any) => x.kind === "direction")) {
    assert.equal(byId.get(e.src)?.frontier, 1, `direction on non-frontier ${e.src}`);
    perSrc.set(e.src, (perSrc.get(e.src) ?? 0) + 1);
  }
  for (const [src, count] of perSrc) assert.ok(count <= 2, `too many directions on ${src}: ${count}`);

  const seg = await api(`/api/worlds/${world.id}/stream/segment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "重排用于提升相关性。" }),
  });
  assert.ok(Array.isArray(seg.nodes));
  assert.ok(seg.nodes.length >= 1);

  const commit = await api(`/api/worlds/${world.id}/stream/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.ok(Array.isArray(commit.nodes));
  assert.ok(commit.nodes.every((n: any) => n.status === "committed" || n.status === undefined));

  await fetch(`${base}/api/worlds/${world.id}`, { method: "DELETE" });
});

test.after(async () => {
  if (child) {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch {}
  }
});
