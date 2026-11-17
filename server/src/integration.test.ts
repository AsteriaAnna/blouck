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
  const worlds = await api("/api/worlds");
  const demo = worlds.worlds.find((w: any) => w.is_demo === 1);
  if (demo) {
    const demoGraph = await api(`/api/worlds/${demo.id}`);
    const dirs = demoGraph.edges.filter((e: any) => e.kind === "direction");
    assert.ok(dirs.length > 0, "seed demo should materialize direction edges");
    assert.ok(dirs.every((e: any) => e.line_type === "exploration"));
  }

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

  // 每个新节点 4 条方向计划（地图仍只 materialize 1–2）
  for (const n of extract.createdNodes) {
    const ds = (extract.directions ?? []).filter((d: any) => d.node_id === n.id && d.status === "open");
    assert.ok(ds.length >= 4, `node ${n.name} should have 4 directions, got ${ds.length}`);
  }

  // 幂等：同一段文字再抽一次，不应产生重复 (src,dst,kind,predicate) 边
  const extract2 = await api(`/api/worlds/${world.id}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "RAG 包含检索。检索包含向量检索。混合检索用于融合召回。" }),
  });
  const keys = extract2.edges.map(
    (e: any) =>
      `${e.src}|${e.dst}|${e.kind}|${e.predicate ?? ""}|${e.kind === "direction" ? e.question ?? "" : ""}`,
  );
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

  // 手动关系：两个已有节点建立 formal，origin=manual
  if (extract.nodes.length >= 2) {
    const [a, b] = extract.nodes;
    const manual = await api(`/api/worlds/${world.id}/relations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromNodeId: a.id,
        toNodeId: b.id,
        predicate: "contrast",
        label: "对比",
        evidence: "集成测试手动关系",
      }),
    });
    assert.equal(manual.edge.origin, "manual");
    assert.equal(manual.edge.kind, "formal");
  }

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

test("软准入：无语义关系的实体只进候选，不直接上地图", async () => {
  const created = await api("/api/worlds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "admission", rootName: "根" }),
  });
  const world = created.world;
  const extract = await api(`/api/worlds/${world.id}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "苹果香蕉橘子" }),
  });
  assert.ok(Array.isArray(extract.createdCandidates));
  assert.ok(extract.createdCandidates.length >= 1, "orphan entity should be candidate");
  assert.equal(extract.createdNodes.length, 0, "orphan entity must not become node");
  assert.equal(extract.nodes.length, 1, "only root should remain visible");

  const list = await api(`/api/worlds/${world.id}/candidates`);
  assert.ok(list.candidates.length >= 1);
  const admitted = await api(`/api/candidates/${list.candidates[0].id}/admit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetNodeId: world.root_node_id, predicate: "related" }),
  });
  assert.equal(admitted.edge.kind, "formal");
  assert.equal(admitted.edge.origin, "manual");
  const after = await api(`/api/worlds/${world.id}/candidates`);
  assert.equal(after.candidates.length, list.candidates.length - 1);
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
