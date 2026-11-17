#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = "http://localhost:5173";
const API = "http://127.0.0.1:8787";
const DB = path.join(__dirname, "..", "server", "data", "mvp.db");
const CDP = 9377;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, method = "GET", body) => {
  const r = await fetch(API + p, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t);
  return JSON.parse(t);
};

const fixture = await api("/api/dev/dungeon-fixture", "POST");
const worldId = fixture.world.id;
const graph = await api(`/api/worlds/${worldId}`);
const building = graph.buildings.find((b) => b.kind === "flow");
const steps = JSON.parse(building.steps);
const member = graph.nodes.find((n) => steps.includes(n.id));
const edge = graph.edges.find(
  (e) => e.kind === "formal" && steps.includes(e.src) && steps.includes(e.dst),
);
if (!member || !edge) throw new Error("fixture missing member/edge");

// 确定性夹具：原文 + 关系证据 + 已生成的辨析任务（不依赖运行时 LLM）
const spanId = randomUUID();
const sourceText = "BM25 是一种检索技术，它属于检索技术这一类。";
const db = new DatabaseSync(DB);
const now = Date.now();
db.prepare("INSERT INTO source_spans(id,world_id,text,revision,created_at) VALUES(?,?,?,?,?)").run(
  spanId, worldId, sourceText, 1, now,
);
db.prepare("UPDATE edges SET evidence=? WHERE id=?").run("BM25 是一种检索技术", edge.id);
for (const nid of [edge.src, edge.dst]) {
  db.prepare("UPDATE nodes SET source_span_id=? WHERE id=?").run(spanId, nid);
}
const taskId = randomUUID();
const choices = JSON.stringify([
  { id: "a", text: "归类：BM25 是检索技术的一种" },
  { id: "b", text: "组成：BM25 是检索技术的一部分" },
  { id: "c", text: "前置：BM25 是检索技术的前置" },
]);
const rubric = JSON.stringify(["指出归类关系", "引用原文证据", "说明为什么不是组成"]);
function insertTask(id, kind, targetType, edgeId, nodeId, stem) {
  db.prepare(
    `INSERT INTO understanding_tasks(id,world_id,edge_id,target_type,node_id,task_kind,learning_goal,misconception,stem,answer_type,choices_json,correct_choice,rubric_json,evidence_quote,source_span_id,follow_up,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, worldId, edgeId, targetType, nodeId, kind, "discriminate",
    "把归类关系误判为组成关系", stem, "choice_explain", choices, "a",
    rubric, "BM25 是一种检索技术", spanId, "如果把 BM25 换成检索呢？", now,
  );
}
insertTask(taskId, "boundary", "node", "", member.id, "BM25 与检索技术是什么关系？请用原文说明。");
for (const [i, kind] of ["boundary", "counterexample", "transfer"].entries()) {
  insertTask(randomUUID(), kind, "edge", edge.id, null, `第 ${i + 1} 关：${kind} 辨析`);
}
db.close();

const profile = path.join(os.tmpdir(), `blouck-e2e-profile-${Date.now()}`);
fs.mkdirSync(profile, { recursive: true });
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", "--no-first-run", `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`, "--enable-unsafe-swiftshader", "--mute-audio",
  "--window-size=1440,900", "about:blank",
], { stdio: "ignore" });
let ws, id = 0; const pending = new Map(); const errors = [];
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
});
try {
  for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  const target = await (await fetch(`http://127.0.0.1:${CDP}/json/new?url=about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console error");
  };
  await cdp("Page.enable"); await cdp("Runtime.enable");
  const ev = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result?.value; };
  const clickText = (text) => ev(`(() => { const b=[...document.querySelectorAll('.drawer button')].find(b=>b.innerText.trim()===${JSON.stringify(text)}); if(!b) return false; b.click(); return true; })()`);
  const drawerText = () => ev(`document.querySelector('.drawer')?.innerText ?? ''`);

  await cdp("Page.navigate", { url: `${WEB}/#world/${worldId}` });
  for (let i = 0; i < 100; i++) { if (await ev(`!!(document.querySelector('.topbar') && document.querySelector('canvas'))`)) break; await sleep(250); }
  await sleep(1200);

  // 1. 节点卡 → 辨析任务
  await ev(`window.__blouckStore.getState().openNode(${JSON.stringify(member.id)})`);
  await sleep(1000);
  const openedTask = await clickText("生成一个辨析任务");
  await sleep(1200);
  const taskText = await drawerText();
  const taskReady = taskText.includes("质量") && taskText.includes("BM25 与检索技术是什么关系");
  const filledNode = await ev(`(() => {
    const radio=document.querySelector('.drawer input[type=radio]'); if(!radio) return false; radio.click();
    const ta=[...document.querySelectorAll('.drawer textarea')].find(t=>(t.placeholder||'').includes('原文'));
    if(!ta) return false;
    const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    setter.call(ta,'依据原文，BM25 是检索技术的一种，所以是归类关系，不是组成关系。');
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  await sleep(350);
  const answeredNode = await ev(`(() => {
    const b=[...document.querySelectorAll('.drawer button')].find(b=>b.innerText.trim()==='提交辨析');
    if(!b || b.disabled) return false; b.click(); return true;
  })()`);
  await sleep(4000);
  const nodeFeedback = await drawerText();
  const nodePassed = nodeFeedback.includes("解释分") && (nodeFeedback.includes("判断正确") || nodeFeedback.includes("解释质量"));
  await ev(`document.querySelector('.drawer .close')?.click()`);
  await sleep(400);

  // 2. 副本 → 三关
  await ev(`window.__blouckStore.getState().openBuilding(${JSON.stringify(building.id)})`);
  await sleep(800);
  const started = await clickText("开始辨析副本");
  await sleep(1200);
  let stagesDone = 0;
  for (let i = 0; i < 3; i++) {
    const filled = await ev(`(() => {
      const radio=document.querySelector('.drawer input[type=radio]'); if(radio) radio.click();
      const ta=[...document.querySelectorAll('.drawer textarea')].find(t=>(t.placeholder||'').includes('判断'));
      if(ta){ const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; setter.call(ta,'依据原文，BM25 属于检索技术；这是归类关系，不是组成关系。'); ta.dispatchEvent(new Event('input',{bubbles:true})); }
      return true;
    })()`);
    await sleep(500);
    const submitted = await ev(`(() => {
      const b=[...document.querySelectorAll('.drawer button')].find(b=>b.innerText.trim()==='提交本关');
      if(!b || b.disabled) return false; b.click(); return true;
    })()`);
    if (!submitted) break;
    stagesDone++;
    await sleep(4000);
  }
  await sleep(2000);
  const dungeonText = await drawerText();
  const dungeonCleared = dungeonText.includes("三关通过");
  await ev(`document.querySelector('.drawer .close')?.click()`);
  await sleep(300);

  // 3. 指标面板
  const statsClicked = await ev(`(() => { const b=[...document.querySelectorAll('.topbar button')].find(b=>b.innerText.trim()==='学习指标'); if(!b) return false; b.click(); return true; })()`);
  await sleep(1000);
  const statsText = await ev(`document.querySelector('.learning-stats')?.innerText ?? ''`);
  const statsOk = statsText.includes("任务") && statsText.includes("副本：通关 1");

  console.log(JSON.stringify({
    openedTask, taskReady, answeredNode, nodePassed,
    started, stagesDone, dungeonCleared,
    statsClicked, statsOk,
    taskPreview: taskText.slice(0, 160),
    nodeFeedback: nodeFeedback.slice(-220),
    dungeonPreview: dungeonText.slice(-220),
    statsPreview: statsText.slice(0, 220),
    errors,
  }, null, 2));
} finally {
  try { await api(`/api/worlds/${worldId}`, "DELETE"); } catch {}
  try { spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
}
