import { addDirection, addEdge, addNode, computeFrontier, createSourceSpan, getGraph, getNode } from "./db.js";
import { env } from "./env.js";

/**
 * DEV：锚点优先的垂直切片（A 方案）
 * 锚点 → 候选 → 快判 → provisional → 慢判 → commit/修复 → 方向/推荐
 * 只用于 dev 接口/测试，不影响主链路。
 */

export type FastDecision = "possible" | "unrelated" | "defer" | "existing" | "metaphor";
export type CandidateInput = { name: string; evidence?: string };

type JudgeResult = {
  name: string;
  role?: "topic" | "subconcept" | "process" | "example" | "metaphor" | "step" | "noise";
  related?: boolean;
  predicate?: string;
  from?: string;
  to?: string;
  label?: string;
  evidence?: string;
  confidence?: number;
  recommendations?: { target: string; predicate?: string; label?: string; evidence?: string }[];
};

const CORE_PREDICATES = new Set(["kindOf", "partOf", "prerequisite", "contrast", "related", "alternative"]);
const CUE = /(从|用|使用|属于|包含|包括|组成|依赖|基于|先|再|然后|之后|衡量|评价|对比|不同|替代|检索|召回|合并|生成|输入|输出|阶段)/;

function norm(s: string) {
  return s.toLowerCase().replace(/[\s\-_·、，。,.；;：:（）()【】\[\]《》"'“”]/g, "");
}

function fastPass(text: string, anchorName: string, candidates: CandidateInput[]) {
  const simileAt = text.search(/(像|好像|如同|似的|一样)/);
  return candidates.map((c) => {
    const name = c.name.trim();
    if (!name) return { name, fast: "defer" as FastDecision, reason: "空候选" };
    const idx = text.indexOf(name);
    if (idx < 0) return { name, fast: "defer" as FastDecision, reason: "原文未出现" };
    if (name === anchorName) return { name, fast: "existing" as FastDecision, reason: "锚点" };
    if (simileAt >= 0 && idx > simileAt) {
      return { name, fast: "metaphor" as FastDecision, reason: "出现在“像/一样”之后，按喻体处理" };
    }
    if (simileAt >= 0 && idx < simileAt) {
      return { name, fast: "possible" as FastDecision, reason: "出现在“像/一样”之前，按话题候选" };
    }
    const window = text.slice(Math.max(0, idx - 12), idx + name.length + 16);
    if (CUE.test(window)) {
      return { name, fast: "possible" as FastDecision, reason: "附近有语义线索" };
    }
    return { name, fast: "defer" as FastDecision, reason: "缺少线索，暂缓" };
  });
}

async function judgeWithLLM(input: {
  anchor: { name: string; definition: string; md: string };
  existing: string[];
  text: string;
  candidates: { name: string; fast: string; reason: string }[];
}): Promise<JudgeResult[]> {
  if (!env.deepseekApiKey) return mockJudge(input);
  const system = `你是知识关系判定器。只输出 JSON，不要解释。
输出格式：
{"results":[{"name":"候选名","role":"topic|subconcept|process|example|metaphor|step|noise","related":true|false,"predicate":"kindOf|partOf|prerequisite|contrast|related|alternative|none","from":"起点概念名","to":"目标概念名","label":"关系名（含自由标签，如衡量/组合/使用）","evidence":"原文证据句","confidence":0.0,"recommendations":[{"target":"已有节点名","predicate":"...","label":"...","evidence":"..."}]}]}
规则：
1. 只有原文证据能支持时才 related=true；否则 related=false。
2. 比喻/举例 role=metaphor/example，related=false；不建正式关系。
3. 候选与锚点/已有节点都可能有关系，按证据判断；不要硬找关系。
4. 谓词只用 kindOf/partOf/prerequisite/contrast/related/alternative；说不清具体类型用 related，不要编造。
5. 方向必须符合：kindOf 具体→上位；partOf 部分→整体；prerequisite 前置→后续；contrast/related 无方向；alternative 旧→新。
6. 只输出与候选相关的结果。`;
  const user = `锚点：${JSON.stringify(input.anchor)}\n已有节点：${input.existing.join("、")}\n候选（含快判）：${JSON.stringify(input.candidates)}\n原文：${input.text}`;
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
  const raw = data.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.results) ? parsed.results : [];
}

function mockJudge(input: {
  anchor: { name: string };
  text: string;
  candidates: { name: string }[];
}): JudgeResult[] {
  return input.candidates.map((c) => {
    const simile = /(像|好像|如同|似的|一样)/.test(input.text);
    const related =
      !simile &&
      (input.text.includes("从") || input.text.includes("用") || input.text.includes("包含")) &&
      c.name !== input.anchor.name;
    return {
      name: c.name,
      role: simile ? "metaphor" : "topic",
      related,
      predicate: related ? "related" : "none",
      from: input.anchor.name,
      to: c.name,
      label: related ? "使用" : "",
      evidence: related ? input.text.slice(0, 60) : "",
      confidence: related ? 0.7 : 0.3,
    };
  });
}

export async function runAnchorFirst(input: {
  worldId: string;
  anchorId?: string;
  text: string;
  candidates: CandidateInput[];
  variant?: "A1" | "A2";
  apply?: boolean;
}) {
  const timeline: { step: string; ms: number; detail?: unknown }[] = [];
  const t0 = Date.now();
  let last = t0;
  const mark = (step: string, detail?: unknown) => {
    const now = Date.now();
    timeline.push({ step, ms: now - last, detail });
    last = now;
  };

  const graph = getGraph(input.worldId);
  const anchor = getNode(input.anchorId ?? "") ?? graph.nodes[0];
  if (!anchor) throw new Error("anchor missing");
  const existingNames = graph.nodes.map((n) => n.name);
  mark("load", { anchor: anchor.name, existing: existingNames });

  const fast = fastPass(input.text, anchor.name, input.candidates).map((f) => {
    if (existingNames.some((n) => norm(n) === norm(f.name))) {
      return { ...f, fast: "existing" as FastDecision, reason: "已存在" };
    }
    return f;
  });
  mark("fast", fast);

  const toJudge = fast.filter((f) => f.fast === "possible" || f.fast === "defer");
  const judgeStart = Date.now();
  let judged: JudgeResult[] = [];
  try {
    judged = await judgeWithLLM({
      anchor: { name: anchor.name, definition: anchor.definition, md: anchor.free_md },
      existing: existingNames,
      text: input.text,
      candidates: toJudge.map((f) => ({ name: f.name, fast: f.fast, reason: f.reason })),
    });
  } catch (err: any) {
    judged = mockJudge({ anchor, text: input.text, candidates: toJudge });
    timeline.push({ step: "judge_fallback", ms: Date.now() - judgeStart, detail: String(err?.message ?? err) });
  }
  mark("judge", { count: judged.length, byName: judged.map((j) => j.name) });

  const variant = input.variant ?? "A1";
  const decisions = fast.map((f) => {
    const j = judged.find((x) => norm(x.name) === norm(f.name));
    const role = j?.role ?? (f.fast === "metaphor" ? "metaphor" : "topic");
    const isAnalogy = /(类比|比喻|举例|就像|一样)/.test(`${j?.label ?? ""} ${j?.evidence ?? ""}`);
    const related = Boolean(j?.related) && !isAnalogy;
    let action: "existing" | "drop_metaphor" | "drop_unrelated" | "commit_relation" | "commit_topic_pending" | "candidate";
    if (f.fast === "existing") action = "existing";
    else if (role === "metaphor" || role === "example") action = "drop_metaphor";
    else if (related) action = "commit_relation";
    else if (role === "topic" && variant === "A2") action = "commit_topic_pending";
    else if (f.fast === "unrelated") action = "drop_unrelated";
    else action = "candidate";
    return {
      name: f.name,
      fast: f.fast,
      fastReason: f.reason,
      role,
      related,
      predicate: j?.predicate ?? "none",
      label: isAnalogy ? "类比（非知识关系）" : j?.label ?? "",
      from: j?.from ?? anchor.name,
      to: j?.to ?? f.name,
      evidence: j?.evidence ?? "",
      confidence: j?.confidence ?? 0,
      action,
    };
  });
  mark("decide", decisions);

  const committed: any[] = [];
  if (input.apply) {
    for (const d of decisions) {
      if (d.action !== "commit_relation" && d.action !== "commit_topic_pending") continue;
      if (graph.nodes.some((n) => norm(n.name) === norm(d.name))) continue;
      const sourceSpan = createSourceSpan(input.worldId, input.text);
      const node = addNode(input.worldId, d.name, anchor.x + 260, anchor.y, d.evidence ? `## ${d.name}\n\n> ${d.evidence}` : "", {
        type: "概念",
        definition: d.label || "",
        sourceSpanId: sourceSpan.id,
      });
      const srcEdge = addEdge(input.worldId, anchor.id, node.id, "source", "本轮探索来源", null, "", {
        evidence: d.evidence,
        confidence: 0.9,
        origin: "dev",
      });
      let relEdge = null;
      if (d.action === "commit_relation") {
        const src = graph.nodes.find((n) => norm(n.name) === norm(d.from));
        const dst = node;
        const pred = CORE_PREDICATES.has(d.predicate) ? d.predicate : "related";
        const kind = d.evidence && d.confidence >= 0.75 ? "formal" : "suggest";
        relEdge = addEdge(input.worldId, src?.id ?? anchor.id, dst.id, kind, d.label || pred, null, "", {
          predicate: pred,
          evidence: d.evidence,
          confidence: d.confidence,
          origin: "dev",
        });
      }
      addDirection(input.worldId, node.id, `「${d.name}」的下一步可以探索什么？`, "dev 原型", null);
      computeFrontier(input.worldId);
      committed.push({ node, sourceEdge: srcEdge, relationEdge: relEdge, action: d.action });
    }
    mark("apply", { committed: committed.length });
  } else {
    mark("apply", { committed: 0, note: "apply=false，仅返回决策" });
  }

  const fresh = getGraph(input.worldId);
  return {
    anchor: { id: anchor.id, name: anchor.name },
    text: input.text,
    variant,
    timeline,
    fast,
    decisions,
    committed,
    nodes: fresh.nodes.map((n) => ({ id: n.id, name: n.name, frontier: n.frontier })),
    edges: fresh.edges.map((e) => ({
      id: e.id,
      kind: e.kind,
      predicate: e.predicate,
      label: e.label,
      src: e.src,
      dst: e.dst,
      evidence: e.evidence,
    })),
    totalMs: Date.now() - t0,
  };
}
