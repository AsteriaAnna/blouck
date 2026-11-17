#!/usr/bin/env node
/**
 * 真实 LLM 质量抽样（本地脚本，不进 CI）：
 * 建临时 fixture → 注入原文/证据 → 让当前 provider 生成 4 种关系题 →
 * 读取 /quality，输出分数/flags/stem。
 * 会真实调用 DeepSeek，消耗少量额度；结束后删除临时世界。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = "http://127.0.0.1:8787";
const DB = path.join(__dirname, "..", "server", "data", "mvp.db");
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
const flow = graph.buildings.find((b) => b.kind === "flow");
const steps = JSON.parse(flow.steps);
const edge = graph.edges.find(
  (e) => e.kind === "formal" && steps.includes(e.src) && steps.includes(e.dst),
);
if (!edge) throw new Error("fixture flow edge not found");

const spanId = randomUUID();
const evidence = "先把文档切成分块，再做向量检索";
const db = new DatabaseSync(DB);
db.prepare("INSERT INTO source_spans(id,world_id,text,revision,created_at) VALUES(?,?,?,?,?)").run(
  spanId, worldId, `${evidence}；检索出候选后，再做重排。`, 1, Date.now(),
);
db.prepare("UPDATE edges SET evidence=? WHERE id=?").run(evidence, edge.id);
for (const nid of [edge.src, edge.dst]) {
  db.prepare("UPDATE nodes SET source_span_id=? WHERE id=?").run(spanId, nid);
}
db.close();

const out = [];
for (const variant of ["boundary", "counterexample", "error_correction", "transfer"]) {
  const started = Date.now();
  const p = await api(`/api/edges/${edge.id}/understanding?variant=${variant}`);
  const task = p.task;
  const q = task ? await api(`/api/understanding/${task.id}/quality`) : null;
  out.push({
    variant,
    status: p.status,
    taskId: task?.id ?? null,
    score: q?.score ?? null,
    flags: q?.flags ?? [],
    stem: task?.stem?.slice(0, 120) ?? null,
    ms: Date.now() - started,
  });
  await sleep(300);
}

console.log(JSON.stringify(out, null, 2));
await api(`/api/worlds/${worldId}`, "DELETE");
