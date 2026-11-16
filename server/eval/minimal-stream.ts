import { env } from "../src/env.js";

type GNode = {
  id: string;
  name: string;
  definition: string;
  aliases: string[];
  parent: string | null;
  status: "provisional" | "committed";
};

type Mention = { name: string; parent?: string; definition?: string; evidence?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_·、，。,.；;：:（）()【】\[\]《》"'“”]/g, "");

function stripFence(s: string) {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

async function streamPrint(text: string) {
  for (let i = 0; i < text.length; i += 5) {
    process.stdout.write(text.slice(i, i + 5));
    await sleep(18);
  }
  process.stdout.write("\n");
}

class MiniGraph {
  nodes: GNode[] = [];
  focus: string[] = [];
  private seq = 0;

  constructor(root: string, aliases: string[] = []) {
    const n = this.add(root, "", null, "committed", aliases);
    this.focus = [n.id];
  }

  add(name: string, definition: string, parent: string | null, status: "provisional" | "committed", aliases: string[] = []) {
    const node: GNode = {
      id: `n${++this.seq}`,
      name,
      definition,
      aliases,
      parent,
      status,
    };
    this.nodes.push(node);
    return node;
  }

  find(text: string) {
    const t = norm(text);
    return this.nodes.filter((n) =>
      [n.name, ...n.aliases].some((x) => norm(x).length >= 2 && t.includes(norm(x))),
    );
  }

  byName(name?: string) {
    if (!name) return undefined;
    const key = norm(name);
    return this.nodes.find((n) => norm(n.name) === key);
  }

  bump(id: string) {
    this.focus = [id, ...this.focus.filter((x) => x !== id)].slice(0, 4);
  }

  show() {
    return this.nodes
      .map((n) => `${n.status === "provisional" ? "◌" : "●"} ${n.name}${n.parent ? ` ← ${this.byName(this.nodes.find((x) => x.id === n.parent)?.name)?.name ?? n.parent}` : ""}`)
      .join("\n");
  }
}

async function askChunk(graph: MiniGraph, text: string): Promise<{ mentions: Mention[]; irrelevant: boolean }> {
  const system = `你是最小流式建图测试器。只输出 JSON。
输出格式：
{"mentions":[{"name":"名词概念","parent":"父节点名","definition":"一句定义","evidence":"原文子串"}],"irrelevant":false}

规则：
1. 只抽本片段里明确出现、值得作为学习对象的名词概念；忽略比喻/例子/步骤/口头语。
2. parent 默认用当前焦点第一个；只有文本明确出现“X的Y / 从X / 回到X”才改用 X。不要因为概念语义上属于某个已有节点就改 parent。
3. 如果片段与学习主题无关（闲聊/天气/无关故事），mentions=[]，irrelevant=true。
4. 不要抽已有节点本身。
5. 不要编造原文没有的概念。`;
  const user = `已有节点：${graph.nodes.map((n) => n.name).join("、")}
当前焦点（最近在前）：${graph.focus.map((id) => graph.nodes.find((n) => n.id === id)?.name).filter(Boolean).join("、")}
文本片段：${text}`;
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
  if (!res.ok) throw new Error(`deepseek ${res.status}`);
  const data = (await res.json()) as any;
  const parsed = JSON.parse(stripFence(data.choices?.[0]?.message?.content ?? "{}"));
  return {
    mentions: Array.isArray(parsed.mentions) ? parsed.mentions : [],
    irrelevant: Boolean(parsed.irrelevant),
  };
}

async function runScenario(title: string, root: string, chunks: string[], aliases: string[] = []) {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
  const graph = new MiniGraph(root, aliases);
  console.log(`初始节点：● ${root}${aliases.length ? `（别名：${aliases.join("、")}）` : ""}\n`);

  for (const chunk of chunks) {
    console.log(`\n[partial] `);
    await streamPrint(chunk);

    const matched = graph.find(chunk);
    for (const m of matched) {
      graph.bump(m.id);
      console.log(`[local match] ${m.name} → 焦点提前`);
    }

    const result = await askChunk(graph, chunk);
    if (result.irrelevant || result.mentions.length === 0) {
      console.log(`[skip] 无新概念${result.irrelevant ? "（irrelevant）" : ""}；焦点不变`);
      continue;
    }

    const created: GNode[] = [];
    for (const m of result.mentions) {
      if (!m?.name || graph.byName(m.name)) continue;
      const proposed = graph.byName(m.parent);
      const focusNode = graph.nodes.find((n) => n.id === graph.focus[0]) ?? graph.nodes[0];
      const mentioned = matched;
      // 最小 parent 规则：句子里提到的已有节点优先；没提到就用当前焦点；只有显式“分为/包括/由…组成”才允许同句新节点作父节点。
      const explicitChain = /(分为|包括|包含|由|组成|属于|也就是|即)/.test(chunk);
      const createdParent = created.find((n) => norm(n.name) === norm(m.parent ?? ""));
      const parent =
        (createdParent && explicitChain ? createdParent : undefined) ??
        (mentioned.length ? mentioned[0] : proposed && mentioned.includes(proposed) ? proposed : focusNode) ??
        graph.nodes[0];
      const p = graph.add(m.name, m.definition ?? "", parent?.id ?? null, "provisional");
      created.push(p);
      console.log(`[provisional] ${p.id} ${p.name}  parent=${parent?.name ?? "-"}  (same id will commit)`);
    }

    if (created.length === 0) {
      console.log(`[skip] 候选都与已有节点重复；焦点不变`);
      continue;
    }

    await sleep(240);
    for (const p of created) {
      p.status = "committed";
      if (p.parent) graph.bump(p.id);
      console.log(`[commit] ${p.id} ${p.name}${p.parent ? ` ← ${graph.nodes.find((n) => n.id === p.parent)?.name}` : ""}`);
    }
  }

  console.log(`\n最终图：\n${graph.show()}`);
}

const rag = [
  "RAG 包括检索和增强生成。",
  "检索又分为语义检索和向量检索。",
  "两者混合起来就是混合检索。",
  "回到增强生成：检索到的结果用来增强生成。",
  "这里涉及召回条数、Re-ranking 和 Top K。",
  "Re-ranking 这里还有一个召回率。",
  "今天天气不错，楼下咖啡店排队很长。",
];

const coffee = [
  "咖啡冲煮要先从研磨开始，研磨决定颗粒大小。",
  "萃取是冲煮的核心，萃取分为浸泡和滴滤。",
  "滴滤又有手冲和机器两种方式。",
  "回到研磨：磨豆机的刀盘会影响粗细。",
  "手冲里还有水温、粉水比和注水节奏。",
  "今天天气不错，楼下咖啡店排队很长。",
];

await runScenario("场景 1：RAG 多焦点", "RAG", rag);
await runScenario("场景 2：咖啡冲煮（更长、任意领域）", "咖啡冲煮", coffee, ["冲煮"]);
