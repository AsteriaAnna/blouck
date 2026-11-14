import { env } from "../env.js";
import { mockLLM } from "./mock.js";
import type { ExtractResult, LLMProvider, QuizItem } from "./types.js";

/**
 * DeepSeek 语言能力预留位。
 * 未配置 DEEPSEEK_API_KEY 时自动降级到 mock；配置后走真实调用。
 * 注意：抽取/出题/判题都应让模型返回严格 JSON，并在服务端做 schema 校验。
 */
async function chat(system: string, user: string): Promise<string> {
  const res = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: env.deepseekModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

export const deepseekLLM: LLMProvider = {
  name: "deepseek",

  async extract({ text, focus, existing }) {
    const system = `你是知识世界的概念/关系抽取器。只输出 JSON，不要解释。
格式：
{"entities":[{"name":"名词概念","type":"概念|方法|组件|指标|工具","definition":"一句定义","aliases":["别名"],"evidence":"原文证据句","confidence":0.0}],
 "relations":[{"source":"起点概念名（缺省为当前节点）","target":"目标概念名","type":"formal|suggest|source|direction","predicate":"kindOf|partOf|prerequisite|contrast|alternative|related","label":"关系名称","evidence":"同时包含两端概念的原文证据句","confidence":0.0,"question":"direction 时的问题"}]}

规则：
1. 节点只能是名词概念，不是问句/动词/代词；问题不要当节点。
2. 关系必须有证据句，evidence 必须是原文子串，且同时出现 source 与 target（或明确指代）。
3. predicate 方向固定：kindOf 具体→上位；partOf 部分→整体；prerequisite 前置→后续；contrast/related 无方向；alternative 旧→新。
4. 证据充分且 confidence>=0.75 用 formal；不充分 0.5-0.75 用 suggest；新节点的探索来路用 source；下一步问题用 direction。
5. 不要编造原文没有的概念。`;
    const user = `当前节点：${focus.name}\n已有概念：${existing.join("、")}\n文本：${text}`;
    try {
      const raw = await chat(system, user);
      const parsed = JSON.parse(raw) as ExtractResult;
      const entities = (Array.isArray(parsed.entities) ? parsed.entities : []).map((e) => ({
        ...e,
        type: e.type ?? "概念",
        confidence: typeof e.confidence === "number" ? e.confidence : 0.7,
      }));
      const relations = (Array.isArray(parsed.relations) ? parsed.relations : []).map((r) => ({
        ...r,
        confidence: typeof r.confidence === "number" ? r.confidence : 0.7,
      }));
      return { entities, relations };
    } catch (err) {
      console.warn("[llm] deepseek extract 失败，降级 mock：", err);
      return mockLLM.extract({ text, focus, existing });
    }
  },

  async generateQuiz({ name, md }) {
    const system =
      '你是出题器。只输出 JSON：{"items":[{"kind":"short|judge","prompt":"","answer":""}]}。要求：5 道简答、10 道判断，题目必须有依据，不要编造；判断答案只能是“对”或“错”。';
    try {
      const raw = await chat(system, `节点：${name}\n材料：${md.slice(0, 2000)}`);
      const parsed = JSON.parse(raw) as { items?: QuizItem[] };
      if (parsed.items?.length) return parsed.items.slice(0, 15);
    } catch (err) {
      console.warn("[llm] deepseek 出题失败，降级 mock：", err);
    }
    return mockLLM.generateQuiz({ name, md });
  },

  async judge({ prompt, answer, reference }) {
    const system =
      '你是判题器。只输出 JSON：{"correct":true|false,"feedback":""}。判断学生答案是否覆盖参考要点，不要因为措辞不同就判错。';
    try {
      const raw = await chat(
        system,
        `题目：${prompt}\n参考答案：${reference}\n学生答案：${answer}`,
      );
      const parsed = JSON.parse(raw) as { correct?: boolean; feedback?: string };
      return {
        correct: Boolean(parsed.correct),
        feedback: parsed.feedback ?? "",
      };
    } catch (err) {
      console.warn("[llm] deepseek 判题失败，降级 mock：", err);
      return mockLLM.judge({ prompt, answer, reference });
    }
  },

  async suggestRelation({ a, b, evidence }) {
    const system = `你是知识关系命名器。只输出 JSON：{"predicate":"kindOf|partOf|prerequisite|contrast|alternative|related","label":"关系名称（2-12字）","md":"为什么这样定位（1-2句，引用依据）"}。
方向约定：kindOf 具体→上位；partOf 部分→整体；prerequisite 前置→后续；contrast/related 无方向；alternative 旧→新。不要编造证据。`;
    const user = `概念 A：${a.name}\n定义：${a.definition ?? ""}\n笔记：${(a.md ?? "").slice(0, 500)}\n概念 B：${b.name}\n定义：${b.definition ?? ""}\n笔记：${(b.md ?? "").slice(0, 500)}\n可用证据：${evidence ?? "（无，置信度要低）"}`;
    try {
      const raw = await chat(system, user);
      const parsed = JSON.parse(raw) as { predicate?: string; label?: string; md?: string };
      const allowed = ["kindOf", "partOf", "prerequisite", "contrast", "alternative", "related"];
      return {
        predicate: (allowed.includes(parsed.predicate ?? "") ? parsed.predicate : "related") as any,
        label: parsed.label?.slice(0, 16) || `${a.name} 与 ${b.name}`,
        md: parsed.md ?? evidence ?? "",
      };
    } catch (err) {
      console.warn("[llm] deepseek 关系命名失败，降级默认：", err);
      return mockLLM.suggestRelation({ a, b, evidence });
    }
  },

  async suggestDirections({ nodes }) {
    const system = `你是学习探索引导器。只输出 JSON：{"items":[{"node":"节点名","question":"下一步问题（8-60字，必须提到该节点）","reason":"为什么问这个"}]}。
每个节点给 1 条，问题要具体、可探索，不要泛泛而问。`;
    const user = nodes
      .map((n) => `节点：${n.name}\n定义：${n.definition ?? ""}\n邻居：${n.neighbors.join("、")}`)
      .join("\n---\n");
    try {
      const raw = await chat(system, user);
      const parsed = JSON.parse(raw) as { items?: { node?: string; question?: string; reason?: string }[] };
      return (parsed.items ?? [])
        .filter((x) => x.node && x.question && x.question.length >= 8)
        .map((x) => ({ node: x.node!, question: x.question!, reason: x.reason ?? "" }));
    } catch (err) {
      console.warn("[llm] deepseek 方向生成失败：", err);
      return [];
    }
  },

  async detectDungeons({ nodes, edges }) {
    const system = `你是副本候选识别器。只输出 JSON：
{"flows":[{"processName":"过程名","steps":["步骤概念名"],"precedence":[{"before":"概念名","after":"概念名","evidence":"原文或关系证据"}],"confidence":0.0}],
 "domains":[{"domainName":"领域名","members":["概念名"],"confidence":0.0}]}
规则：
- 流程：同一过程、3-6 步、有先后证据；多解/证据不足不要提。
- 领域：同一上位概念下的 4-8 个概念；只是互相连边不算。
- 不得编造不存在的概念。`;
    const user = `概念：\n${nodes
      .map((n) => `- ${n.name}（${n.type ?? "概念"}）：${n.definition ?? ""}`)
      .join("\n")}\n关系：\n${edges
      .map((e) => `- ${e.src} --${e.predicate ?? e.label ?? "相关"}--> ${e.dst}（${e.evidence ?? ""}）`)
      .join("\n")}`;
    try {
      const raw = await chat(system, user);
      const parsed = JSON.parse(raw) as {
        flows?: any[];
        domains?: any[];
      };
      return {
        flows: Array.isArray(parsed.flows) ? parsed.flows : [],
        domains: Array.isArray(parsed.domains) ? parsed.domains : [],
      };
    } catch (err) {
      console.warn("[llm] deepseek 副本候选失败：", err);
      return { flows: [], domains: [] };
    }
  },
};
