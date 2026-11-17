#!/usr/bin/env node
/**
 * 真实 LLM 质量抽样（本地脚本，不进 CI）：
 * 建临时 fixture → 注入原文/证据 → 让当前 provider 生成多种关系题型 →
 * 读取 /quality，输出分数/flags/stem。
 * 默认抽 2 条关系 × 2 种题型；可用 --edges/--variants 调整。
 * 会真实调用 DeepSeek，消耗少量额度；结束后删除临时世界。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = "http://127.0.0.1:8787";
const DB = path.join(__dirname, "..", "server", "data", "mvp.db");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const edgeCount = Math.max(1, Math.min(4, Number(args.edges ?? 2)));
const variants = String(args.variants ?? "boundary,transfer")
  .split(",")
  .filter((v) => ["boundary", "counterexample", "error_correction", "transfer"].includes(v));
const api = async (p, method = "GET", body) => {
  const r = await fetch(API + p, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p}: ${text}`);
  return JSON.parse(text);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fixture = await api("/api/dev/dungeon-fixture", "POST");
const worldId = fixture.world.id;
const graph = await api(`/api/worlds/${worldId}`);
const edges = graph.edges.filter((e) => e.kind === "formal").slice(0, edgeCount);
if (edges.length === 0) throw new Error("fixture edge not found");

const spanId = randomUUID();
const evidenceByEdge = new Map();
const sentences = edges.map((e, i) => {
  const text = `关系证据 ${i + 1}：${e.label || "相关"}，用于流程判断。`;
  evidenceByEdge.set(e.id, text);
  return text;
});
const db = new DatabaseSync(DB);
db.prepare("INSERT INTO source_spans(id,world_id,text,revision,created_at) VALUES(?,?,?,?,?)").run(
  spanId, worldId, sentences.join(" "), 1, Date.now(),
);
for (const e of edges) {
  db.prepare("UPDATE edges SET evidence=? WHERE id=?").run(evidenceByEdge.get(e.id), e.id);
  for (const nid of [e.src, e.dst]) {
    db.prepare("UPDATE nodes SET source_span_id=? WHERE id=?").run(spanId, nid);
  }
}
db.close();

const out = [];
for (const edge of edges) {
  const variantsOut = [];
  for (const variant of variants) {
    const started = Date.now();
    const p = await api(`/api/edges/${edge.id}/understanding?variant=${variant}`);
    const task = p.task;
    const q = task ? await api(`/api/understanding/${task.id}/quality`) : null;
    variantsOut.push({
      variant,
      status: p.status,
      score: q?.score ?? null,
      flags: q?.flags ?? [],
      stem: task?.stem?.slice(0, 100) ?? null,
      ms: Date.now() - started,
    });
    await sleep(300);
  }
  out.push({
    edgeId: edge.id,
    predicate: edge.predicate ?? null,
    label: edge.label ?? null,
    evidence: evidenceByEdge.get(edge.id),
    variants: variantsOut,
  });
}

console.log(JSON.stringify(out, null, 2));
await api(`/api/worlds/${worldId}`, "DELETE");
