import { addDirection, addEdge, addNode, computeFrontier, createSourceSpan, getGraph, getNode } from "../db.js";
import { env } from "../env.js";
import { deepseekLLM } from "../providers/deepseek.js";
import { mockLLM } from "../providers/mock.js";

/**
 * DEV：锚点优先的垂直切片（A 方案，三层串联）
 * 1) 句子角色预筛（比喻/例子/已有）
 * 2) 批量 LLM 词对快筛（possible/unrelated/defer）
 * 3) 慢判（谓词/方向/证据/无关）
 * 4) commit / 修复 / 方向
 * 只用于 dev 接口/测试，不影响主链路。
 */

type Verdict = "possible" | "unrelated" | "defer";
type Role = "topic" | "subconcept" | "process" | "example" | "metaphor" | "step" | "noise";
type CandidateInput = { name: string };

type PairFast = { name: string; verdict: Verdict; confidence: number; reason: string };
type JudgeResult = {
  name: string;
  role?: Role;
  related?: boolean;
  predicate?: string;
  from?: string;
  to?: string;
  label?: string;
  evidence?: string;
  confidence?: number;
  direction?: string;
  recommendations?: { target: string; predicate?: string; label?: string; evidence?: string }[];
};

const CORE_PREDICATES = new Set(["kindOf", "partOf", "prerequisite", "contrast", "related", "alternative"]);
const SIMILE = /(像|好像|如同|似的|一样)/;

function norm(s: string) {
  return s.toLowerCase().replace(/[\s\-_·、，。,.；;：:（）()【】\[\]《》"'“”]/g, "");
}

function stripFence(s: string) {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function sentencePrefilter(text: string, anchorName: string, candidates: CandidateInput[]) {
  const simileAt = text.search(SIMILE);
  return candidates.map((c) => {
    const name = c.name.trim();
    const idx = text.indexOf(name);
    if (!name) return { name, role: "noise" as Role, reason: "空候选" };
    if (name === anchorName) return { name, role: "topic" as Role, reason: "锚点" };
    if (idx < 0) return { name, role: "noise" as Role, reason: "原文未出现" };
    if (simileAt >= 0 && idx > simileAt) {
      return { name, role: "metaphor" as Role, reason: "出现在“像/一样”之后" };
    }
    return { name, role: "topic" as Role, reason: "非喻体，进入词对判断" };
  });
}

async function extractCandidatesLLM(
  text: string,
  anchor: { id: string; name: string },
  existing: string[],
): Promise<string[]> {
  const provider = env.deepseekApiKey ? deepseekLLM : mockLLM;
  try {
    const result = await provider.extract({
      text,
      focus: { id: anchor.id, name: anchor.name },
      existing,
    });
    return result.entities.map((e) => e.name.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function pairFastLLM(
  anchor: { name: string; definition: string },
  candidates: { name: string }[],
): Promise<{ results: PairFast[]; ms: number }> {
  const t = Date.now();
  if (!env.deepseekApiKey || candidates.length === 0) {
    return {
      results: candidates.map((c) => ({ name: c.name, verdict: "possible" as Verdict, confidence: 0.5, reason: "mock" })),
      ms: Date.now() - t,
    };
  }
  const system = `你是概念相关度快速判定器。只输出 JSON：
{"results":[{"name":"候选名","verdict":"possible|unrelated|defer","confidence":0.0,"reason":""}]}
只根据两个概念本身判断是否可能存在知识关系，不要假设句子语境。
- possible：同一知识域或存在已知/可推断关联；
- unrelated：明显不同知识域、无已知关联；
- defer：信息不足。
不要为了显得聪明而硬找关系。`;
  const user = `锚点：${anchor.name}（${anchor.definition || "无定义"}）\n候选：${candidates.map((c) => c.name).join("、")}`;
  try {
    const res = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.deepseekApiKey}` },
      body: JSON.stringify({
        model: env.deepseekModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const data = (await res.json()) as any;
    const parsed = JSON.parse(stripFence(data.choices?.[0]?.message?.content ?? "{}"));
    const list = Array.isArray(parsed.results) ? parsed.results : [];
    return {
      results: candidates.map((c) => {
        const found = list.find((x: any) => norm(String(x.name ?? "")) === norm(c.name));
        return {
          name: c.name,
          verdict: (["possible", "unrelated", "defer"].includes(found?.verdict) ? found.verdict : "defer") as Verdict,
          confidence: Number(found?.confidence ?? 0),
          reason: String(found?.reason ?? ""),
        };
      }),
      ms: Date.now() - t,
    };
  } catch (err: any) {
    return {
      results: candidates.map((c) => ({ name: c.name, verdict: "defer" as Verdict, confidence: 0, reason: String(err?.message ?? err) })),
      ms: Date.now() - t,
    };
  }
}

async function slowJudge(input: {
  anchor: { name: string; definition: string; md: string };
  existing: string[];
  text: string;
  candidates: { name: string; pair: PairFast }[];
}): Promise<JudgeResult[]> {
  if (!env.deepseekApiKey) return mockJudge(input);
  const system = `你是知识关系判定器。只输出 JSON，不要解释。
输出格式：
{"results":[{"name":"候选名","role":"topic|subconcept|process|example|metaphor|step|noise","related":true|false,"predicate":"kindOf|partOf|prerequisite|contrast|related|alternative|none","from":"起点概念名","to":"目标概念名","label":"关系名（可带自由标签，如衡量/组合/使用）","evidence":"原文证据句","confidence":0.0,"direction":"下一步探索问题（可空）","recommendations":[{"target":"已有节点名","predicate":"...","label":"...","evidence":"..."}]}]}
规则：
1. 只有原文证据能支持时才 related=true；否则 related=false。
2. 比喻/举例 role=metaphor/example，related=false；不建正式关系。
3. 候选与锚点/已有节点都可能有关系，按证据判断；不要硬找关系。
'4. 谓词只用 kindOf/partOf/prerequisite/contrast/related/alternative；说不清用 related，不要编造。
   谓词消歧：
   - “A 是一种 B / A 属于某类” → kindOf；
   - “A 由 B 组成 / A 包含组件 B” → partOf（方向：组件→整体）；
   - “A 使用/依赖/从 B 获取/来源是 B” → related（label 使用/来源），不要用 prerequisite；
   - “A 组合了 B 和 C” → related（label 组合），不要用 partOf；
   - “先 A 后 B / A 必须在 B 之前” → prerequisite；
   - 比喻/举例 → related=false。'
5. 方向：kindOf 具体→上位；partOf 部分→整体；prerequisite 前置→后续；contrast/related 无方向；alternative 旧→新。
6. 只输出与候选相关的结果。
7. “像/一样/如同”之前的候选通常是话题主体，role 不要判成 metaphor；只有“像”之后的词才是喻体。
8. 如果只是类比/比喻/举例，即使 label 写“类比关联”，related 也必须为 false。`;
  const user = `锚点：${JSON.stringify(input.anchor)}\n已有节点：${input.existing.join("、")}\n候选（含词对快判）：${JSON.stringify(input.candidates)}\n原文：${input.text}`;
  try {
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
    const parsed = JSON.parse(stripFence(data.choices?.[0]?.message?.content ?? "{}"));
    return Array.isArray(parsed.results) ? parsed.results : [];
  } catch {
    return mockJudge(input);
  }
}

function mockJudge(input: { anchor: { name: string }; text: string; candidates: { name: string }[] }): JudgeResult[] {
  return input.candidates.map((c) => {
    const simile = SIMILE.test(input.text);
    const related = !simile && (input.text.includes("从") || input.text.includes("用") || input.text.includes("包含"));
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
    timeline.push({ step, ms: Date.now() - last, detail });
    last = Date.now();
  };

  const graph = getGraph(input.worldId);
  const anchor = getNode(input.anchorId ?? "") ?? graph.nodes[0];
  if (!anchor) throw new Error("anchor missing");
  const existingNames = graph.nodes.map((n) => n.name);
  mark("load", { anchor: anchor.name, existing: existingNames });

  let candidateInput = input.candidates;
  let candidateSource: "provided" | "extracted" = "provided";
  if (candidateInput.length === 0) {
    candidateInput = (await extractCandidatesLLM(input.text, anchor, existingNames)).map((name) => ({ name }));
    candidateSource = "extracted";
  }
  mark("candidates", { source: candidateSource, names: candidateInput.map((c) => c.name) });

  const sentence = sentencePrefilter(input.text, anchor.name, candidateInput);
  mark("sentence", sentence);

  const existingSet = new Set(existingNames.map(norm));
  const pairCandidates = sentence.filter(
    (s) => s.role !== "metaphor" && s.role !== "noise" && !existingSet.has(norm(s.name)),
  );
  const pair = await pairFastLLM({ name: anchor.name, definition: anchor.definition }, pairCandidates.map((p) => ({ name: p.name })));
  mark("pair_fast", { results: pair.results, ms: pair.ms });

  const toSlow = pair.results.filter((r) => r.verdict !== "unrelated");
  const slowStart = Date.now();
  let judged: JudgeResult[] = [];
  try {
    judged = await slowJudge({
      anchor: { name: anchor.name, definition: anchor.definition, md: anchor.free_md },
      existing: existingNames,
      text: input.text,
      candidates: toSlow.map((r) => ({ name: r.name, pair: r })),
    });
  } catch (err: any) {
    judged = mockJudge({ anchor, text: input.text, candidates: toSlow });
    timeline.push({ step: "slow_fallback", ms: Date.now() - slowStart, detail: String(err?.message ?? err) });
  }
  mark("slow_judge", { count: judged.length });

  const variant = input.variant ?? "A1";
  const decisions = sentence.map((s) => {
    const p = pair.results.find((x) => norm(x.name) === norm(s.name));
    const j = judged.find((x) => norm(x.name) === norm(s.name));
    const role: Role = j?.role ?? (s.role === "metaphor" ? "metaphor" : "topic");
    const isAnalogy = /(类比|比喻|举例|就像|一样)/.test(`${j?.label ?? ""} ${j?.evidence ?? ""}`);
    const evidence = j?.evidence ?? "";
    const evidenceValid =
      !evidence || input.text.includes(evidence) || input.text.includes(evidence.slice(0, Math.min(16, evidence.length)));
    const related = Boolean(j?.related) && !isAnalogy && evidenceValid;
    let action:
      | "existing"
      | "drop_metaphor"
      | "drop_unrelated"
      | "commit_relation"
      | "commit_topic_pending"
      | "candidate";
    if (existingSet.has(norm(s.name))) action = "existing";
    else if (role === "metaphor" || role === "example") action = "drop_metaphor";
    else if (p?.verdict === "unrelated") action = "drop_unrelated";
    else if (related) action = "commit_relation";
    else if (role === "topic" && variant === "A2") action = "commit_topic_pending";
    else action = "candidate";
    return {
      name: s.name,
      sentenceRole: s.role,
      sentenceReason: s.reason,
      pairVerdict: p?.verdict ?? "not_judged",
      pairConfidence: p?.confidence ?? 0,
      role,
      related,
      predicate: isAnalogy ? "none" : j?.predicate ?? "none",
      label: isAnalogy ? "类比（非知识关系）" : !evidenceValid ? "证据不匹配" : j?.label ?? "",
      from: j?.from ?? anchor.name,
      to: j?.to ?? s.name,
      evidence,
      evidenceValid,
      confidence: j?.confidence ?? 0,
      direction: j?.direction ?? "",
      recommendations: j?.recommendations ?? [],
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
        const pred = CORE_PREDICATES.has(d.predicate) ? d.predicate : "related";
        const kind = d.evidence && d.confidence >= 0.75 ? "formal" : "suggest";
        relEdge = addEdge(input.worldId, src?.id ?? anchor.id, node.id, kind, d.label || pred, null, "", {
          predicate: pred,
          evidence: d.evidence,
          confidence: d.confidence,
          origin: "dev",
        });
      }
      addDirection(input.worldId, node.id, d.direction || `「${d.name}」的下一步可以探索什么？`, "dev 原型", null);
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
    candidateSource,
    sentence,
    pairFast: pair.results,
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
