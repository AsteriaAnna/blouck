import fs from "fs";
import WebSocket from "ws";
import { env } from "../src/env.js";

type GNode = {
  id: string;
  name: string;
  aliases: string[];
  parent: string | null;
  status: "provisional" | "committed";
};

type Mention = { name: string; definition?: string; evidence?: string };
type Relation = { from: string; to: string; predicate?: string; evidence?: string };

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_·、，。,.；;：:（）()【】\[\]《》"'“”]/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readWavPcm(path: string) {
  const buf = fs.readFileSync(path);
  const dataAt = buf.indexOf("data");
  if (dataAt < 0) throw new Error("no data chunk");
  const size = buf.readUInt32LE(dataAt + 4);
  return buf.subarray(dataAt + 8, dataAt + 8 + size);
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[。！？!?；;])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

class Graph {
  nodes: GNode[] = [];
  edges: { from: string; to: string; predicate: string; evidence: string }[] = [];
  focus: string[] = [];
  seq = 0;

  constructor(initial: string[]) {
    for (const name of initial) {
      const n = this.add(name, null, "committed");
      this.focus.push(n.id);
    }
    this.focus = this.focus.slice(0, 3);
  }

  add(name: string, parent: string | null, status: "provisional" | "committed", aliases: string[] = []) {
    const n: GNode = { id: `n${++this.seq}`, name, aliases, parent, status };
    this.nodes.push(n);
    return n;
  }

  find(name?: string) {
    if (!name) return undefined;
    const key = norm(name);
    return this.nodes.find(
      (n) => norm(n.name) === key || n.aliases.some((a) => norm(a) === key),
    );
  }

  mentionIn(text: string) {
    const t = norm(text);
    return this.nodes.filter((n) =>
      [n.name, ...n.aliases].some((x) => norm(x).length >= 2 && t.includes(norm(x))),
    );
  }

  bump(id: string) {
    this.focus = [id, ...this.focus.filter((x) => x !== id)].slice(0, 3);
  }

  focusName() {
    return this.nodes.find((n) => n.id === this.focus[0])?.name ?? "-";
  }

  show() {
    console.log("\n图：");
    for (const n of this.nodes) {
      const parent = n.parent ? this.nodes.find((x) => x.id === n.parent)?.name : null;
      console.log(`${n.status === "provisional" ? "◌" : "●"} ${n.name}${parent ? ` ← ${parent}` : ""}`);
    }
    console.log("关系：");
    for (const e of this.edges) {
      console.log(`  ${e.from} --${e.predicate}--> ${e.to}   [${e.evidence.slice(0, 30)}]`);
    }
  }
}

async function llmExtract(graph: Graph, text: string): Promise<{ mentions: Mention[]; relations: Relation[] }> {
  const system = `你是对话建图抽取器。只输出 JSON：
{"mentions":[{"name":"名词概念","definition":"一句","evidence":"原文子串"}],
 "relations":[{"from":"起点概念","to":"目标概念","predicate":"kindOf|partOf|prerequisite|contrast|related|alternative","evidence":"原文子串"}]}

规则：
1. 只抽本句明确出现的学习概念；忽略比喻/例子/步骤/口头语。
2. from/to 必须是已有节点或本句 mentions；不能编造。
3. 谓词：属于/是一种→kindOf；由…组成/包含→partOf；衡量/使用/相关→related。方向按语义。
4. 无关句返回空。`;
  const user = `已有节点：${graph.nodes.map((n) => n.name).join("、")}
当前焦点：${graph.focusName()}
文本：${text}`;
  const res = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.deepseekApiKey}` },
    body: JSON.stringify({
      model: env.deepseekModel,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const data = (await res.json()) as any;
  const raw = (data.choices?.[0]?.message?.content ?? "{}")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed = JSON.parse(raw);
  return {
    mentions: Array.isArray(parsed.mentions) ? parsed.mentions : [],
    relations: Array.isArray(parsed.relations) ? parsed.relations : [],
  };
}

async function processSentence(graph: Graph, sentence: string) {
  console.log(`\n[stable] ${sentence}`);
  for (const n of graph.mentionIn(sentence)) {
    graph.bump(n.id);
    console.log(`[local match] ${n.name} → focus`);
  }

  const result = await llmExtract(graph, sentence);
  if (!result.mentions.length) {
    console.log("[skip] 无新概念");
    return;
  }

  const created: GNode[] = [];
  for (const m of result.mentions) {
    if (!m?.name || graph.find(m.name)) continue;
    const n = graph.add(m.name, null, "provisional");
    created.push(n);
    console.log(`[provisional] ${n.id} ${n.name}`);
  }

  // 关系先解析端点（已有/新节点），用已有端点定 parent
  for (const r of result.relations) {
    const from = graph.find(r.from) ?? created.find((n) => norm(n.name) === norm(r.from));
    const to = graph.find(r.to) ?? created.find((n) => norm(n.name) === norm(r.to));
    if (!from || !to) continue;
    const predicate = r.predicate ?? "related";
    const evidence = r.evidence ?? "";
    graph.edges.push({ from: from.name, to: to.name, predicate, evidence });
    console.log(`[relation] ${from.name} --${predicate}--> ${to.name}`);
    const newSide = created.find((n) => n.id === from.id) ?? created.find((n) => n.id === to.id);
    if (newSide && !newSide.parent) {
      const other = newSide.id === from.id ? to : from;
      newSide.parent = other.id;
    }
  }

  for (const n of created) {
    if (!n.parent) {
      const focus = graph.nodes.find((x) => x.id === graph.focus[0]);
      n.parent = focus?.id ?? null;
    }
  }

  await sleep(220);
  for (const n of created) {
    n.status = "committed";
    graph.bump(n.id);
    console.log(`[commit] ${n.id} ${n.name} ← ${graph.nodes.find((x) => x.id === n.parent)?.name ?? "-"}`);
  }
}

async function main() {
  const pcm = readWavPcm("eval/voice-test.wav");
  console.log(`语音 PCM ${pcm.length} bytes`);
  const graph = new Graph(["RAG", "检索", "增强生成"]);

  const ws = new WebSocket("ws://localhost:8787/ws/asr");
  let buffer = "";
  let processed = "";
  let queue = Promise.resolve();

  const processNew = (text: string, final = false) => {
    const sentences = splitSentences(text);
    const complete = final ? sentences : sentences.slice(0, -1);
    for (const s of complete) {
      if (processed.includes(s)) continue;
      processed += s;
      queue = queue.then(() => processSentence(graph, s));
    }
  };

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "start" }));
      let i = 0;
      const timer = setInterval(() => {
        if (i >= pcm.length) {
          clearInterval(timer);
          ws.send(JSON.stringify({ type: "stop" }));
          return;
        }
        const chunk = pcm.subarray(i, i + 3200);
        i += 3200;
        ws.send(JSON.stringify({ type: "audio", chunk: chunk.toString("base64") }));
      }, 100);
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "partial") {
        buffer = msg.text;
        console.log(`[partial] ${buffer}`);
        processNew(buffer);
      } else if (msg.type === "final") {
        buffer = msg.text;
        console.log(`\n[final] ${buffer}`);
        processNew(buffer, true);
        queue.then(() => {
          graph.show();
          ws.close();
          resolve();
        });
      } else if (msg.type === "error") {
        reject(new Error(msg.message));
      }
    });
    ws.on("error", reject);
  });
}

await main();
