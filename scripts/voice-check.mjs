#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = "http://localhost:5173";
const API = "http://127.0.0.1:8787";
const CDP = 9384;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, method = "GET", body) => {
  const r = await fetch(API + p, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text);
  return JSON.parse(text);
};
const created = await api("/api/worlds", "POST", { name: "语音链路验收", rootName: "RAG" });
const worldId = created.world.id;
const profile = path.join(os.tmpdir(), `blouck-voice-profile-${Date.now()}`);
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
  await cdp("Page.navigate", { url: `${WEB}/#world/${worldId}` });
  for (let i = 0; i < 120; i++) { if (await ev(`!!(document.querySelector('.topbar') && document.querySelector('.mock-btn'))`)) break; await sleep(250); }
  await sleep(800);
  const nodesBefore = await ev(`window.__blouckStore.getState().nodes.length`);
  const clicked = await ev(`(() => { const b=document.querySelector('.mock-btn'); if(!b) return false; b.click(); return true; })()`);
  let streamText = "";
  let nodesAfter = nodesBefore;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    streamText = await ev(`window.__blouckStore.getState().streamText`);
    nodesAfter = await ev(`window.__blouckStore.getState().nodes.length`);
    const stage = await ev(`window.__blouckStore.getState().stage`);
    const busy = await ev(`window.__blouckStore.getState().busy`);
    if (streamText && nodesAfter > nodesBefore && stage === "idle" && !busy) break;
  }
  await sleep(1200);
  const graph = await api(`/api/worlds/${worldId}`);
  const grounded = graph.nodes.filter((n) => n.source_span_id).length;
  const spanText = graph.nodes
    .map((n) => n.source_quote ?? "")
    .filter(Boolean)
    .join(" | ")
    .slice(0, 120);
  console.log(JSON.stringify({
    clicked,
    streamText: streamText.slice(0, 120),
    nodesBefore,
    nodesAfter,
    groundedNodes: grounded,
    spanText,
    errors,
  }, null, 2));
} finally {
  try { await api(`/api/worlds/${worldId}`, "DELETE"); } catch {}
  try { spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
}
