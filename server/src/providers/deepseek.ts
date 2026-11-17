import { env } from "../env.js";
import { mockLLM } from "./mock.js";
import type { ExtractResult, LLMProvider, QuizItem } from "./types.js";

/** 单次 DeepSeek 调用超时：挂起会卡住前端串行 segment 队列与 commit，必须有上限 */
const CHAT_TIMEOUT_MS = 20_000;

/**
 * DeepSeek 语言能力预留位。
 * 未配置 DEEPSEEK_API_KEY 时自动降级到 mock；配置后走真实调用。
 * 注意：抽取/出题/判题都应让模型返回严格 JSON，并在服务端做 schema 校验。
 */
async function chat(system: string, user: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
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
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`DeepSeek 请求超时（${CHAT_TIMEOUT_MS / 1000}s）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const deepseekLLM: LLMProvider = {
  name: "deepseek",

  async extract({ text, focus, existing }) {
    const system = `你是知识世界的概念/关系抽取器。只输出 JSON，不要解释。
格式：
{"entities":[{"name":"名词概念","type":"概念|方法|组件|指标|工具","definition":"一句定义","aliases":["别名"],"evidence":"原文证据句","confidence":0.0}],
 "relations":[{"source":"起点概念名（缺省为当前节点）","target":"目标概念名","type":"formal|suggest|source|direction","predicate":"kindOf|partOf|prerequisite|contrast|alternative|related","label":"关系名称","evidence":"同时包含两端概念的原文证据句","confidence":0.0,"question":"direction 时的问题"}],
 "processes":[{"name":"过程/工作流的名称（从上下文命名，如“内容生产工作流”，不要只叫“工作流”）","steps":["有序步骤名"],"evidence":["每步的来源句"],"confidence":0.0}]}

规则：
1. 节点只能是名词概念，不是问句/动词/代词；问题不要当节点。
2. **如果一句话在描述一个过程、工作流、体系：只把“过程本身”作为一个概念节点；步骤放进 processes.steps，不要给每个步骤单独建节点**。过程名要从上下文命名（例如“RAG 检索流程”“内容生产工作流”）。
3. 关系必须有证据句，evidence 必须是原文子串，且同时出现 source 与 target（或明确指代）。
4. predicate 方向固定：kindOf 具体→上位；partOf 部分→整体；prerequisite 前置→后续；contrast/related 无方向；alternative 旧→新。
5. 证据充分且 confidence>=0.75 用 formal；不充分 0.5-0.75 用 suggest；新节点的探索来路用 source；下一步问题用 direction。
6. 不要编造原文没有的概念；不要为“输入解析/检索资料/生成草稿/审核发布”这类步骤建节点。`;
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
      const processes = (Array.isArray(parsed.processes) ? parsed.processes : [])
        .filter((p) => p?.name && Array.isArray(p.steps) && p.steps.length >= 3)
        .map((p) => ({
          name: String(p.name),
          steps: p.steps.map((x: unknown) => String(x)),
          evidence: Array.isArray(p.evidence) ? p.evidence.map((x: unknown) => String(x)) : [],
          confidence: typeof p.confidence === "number" ? p.confidence : 0.75,
        }));
      return { entities, relations, processes };
    } catch (err) {
      // 抽取失败/超时不再降级 mock：mock 的正则切词会把“这个/然后”等写进用户的图。
      // 本段不落图，返回空结果 + warning，由 /stream/segment 响应回传给前端提示。
      console.warn("[llm] deepseek extract 失败，本段不落图：", err);
      return {
        entities: [],
        relations: [],
        processes: [],
        warning: `本句知识抽取失败（${errorMessage(err)}），未落图，可再说一次或稍后重试。`,
      };
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

  async suggestDirections({ nodes, existing }) {
    const system = `你是学习探索规划器。先为每个节点想好“下一步要延伸出的新节点”，再围绕它提问。
只输出 JSON：{"items":[{"node":"源节点名","question":"下一步问题（8-60字，必须提到目标概念）","reason":"为什么问这个","target":{"name":"新节点名（2-12字，具体概念，不能是已有节点/别名）","type":"概念|方法|组件|指标|工具","definition":"一句话定义（20-120字）","aliases":[]},"predicate":"kindOf|partOf|prerequisite|contrast|alternative|related","label":"关系名（2-8字）"}]}
规则：
- target 必须是当前图里还没有的新概念，不能拿已有概念当 target；
- question 必须指向 target，用户点击探索后就直接生成这个 target 节点；
- predicate 用“源节点 → target”的方向：kindOf 具体→上位、partOf 部分→整体、prerequisite 前置→后续、contrast/related 无方向、alternative 旧→新；
- 每个节点给 4 条不同方向，target 不能重复；给不够 4 条时只给能确定的，不要硬凑。`;
    const user = `已有节点（不能作为 target）：${existing.join("、") || "（无）"}\n\n${nodes
      .map((n) => `节点：${n.name}\n定义：${n.definition ?? ""}\n邻居：${n.neighbors.join("、")}`)
      .join("\n---\n")}`;
    try {
      const raw = await chat(system, user);
      const parsed = JSON.parse(raw) as {
        items?: {
          node?: string;
          question?: string;
          reason?: string;
          target?: { name?: string; type?: string; definition?: string; aliases?: string[] };
          predicate?: string;
          label?: string;
        }[];
      };
      const types = new Set(["概念", "方法", "组件", "指标", "工具"]);
      const preds = new Set(["kindOf", "partOf", "prerequisite", "contrast", "alternative", "related"]);
      return (parsed.items ?? [])
        .filter((x) => x.node && x.question && x.question.length >= 8 && x.target?.name)
        .map((x) => ({
          node: x.node!,
          question: x.question!,
          reason: x.reason ?? "",
          target: {
            name: x.target!.name!.trim(),
            type: (types.has(x.target!.type ?? "") ? x.target!.type : "概念") as any,
            definition: x.target!.definition ?? "",
            aliases: Array.isArray(x.target!.aliases) ? x.target!.aliases.slice(0, 4) : [],
          },
          predicate: (preds.has(x.predicate ?? "") ? x.predicate : "related") as any,
          label: x.label?.slice(0, 12) || "相关",
        }));
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

  async generateNodeDoc({ name, type, definition, sourceText, neighbors }) {
    const system = `你是知识卡的编辑，不是作者。只输出 JSON：
{"definition":"一句话定义","position":[{"node_id":"邻居 id","predicate":"kindOf|partOf|prerequisite|contrast|alternative|related","why":"依据"}],"boundary":"它不是什么/容易和谁混","source_quote":"原文证据","next_hint":"下一步建议"}
规则：
- position 只能使用输入的 neighbors id；不得新增节点。
- source_quote 必须是 sourceText 的连续子串；没有就空字符串。
- 没有证据的内容留空，不要编造。
- definition 优先使用输入 definition，不要改写成空话。`;
    const user = `节点：${name}（${type ?? "概念"}）
定义：${definition ?? ""}
来源原文：${sourceText ?? ""}
邻居：
${neighbors.map((n) => `- id=${n.id} name=${n.name} predicate=${n.predicate ?? "related"} label=${n.label ?? ""} evidence=${n.evidence ?? ""}`).join("\n")}`;
    try {
      const raw = await chat(system, user);
      const parsed = JSON.parse(raw) as any;
      const allowed = new Set(neighbors.map((n) => n.id));
      return {
        definition: String(parsed.definition ?? definition ?? ""),
        position: Array.isArray(parsed.position)
          ? parsed.position
              .filter((x: any) => x && typeof x.node_id === "string" && allowed.has(x.node_id))
              .slice(0, 6)
              .map((x: any) => ({
                node_id: x.node_id,
                predicate: x.predicate ?? "related",
                why: String(x.why ?? ""),
              }))
          : [],
        boundary: String(parsed.boundary ?? ""),
        source_quote:
          typeof parsed.source_quote === "string" &&
          sourceText &&
          sourceText.includes(parsed.source_quote)
            ? parsed.source_quote
            : "",
        next_hint: String(parsed.next_hint ?? ""),
      };
    } catch (err) {
      console.warn("[llm] deepseek 节点卡失败：", err);
      return mockLLM.generateNodeDoc({ name, type, definition, sourceText, neighbors });
    }
  },

  async generateRelationDoc({ a, b, predicate, label, evidence }) {
    const system = `你是知识卡编辑。只输出 JSON：
{"one_line":"一句话定位","predicate":"kindOf|partOf|prerequisite|contrast|alternative|related","evidence_quote":"原文证据","compare":{"same":[],"different":[],"boundary":[]},"counterexample":"容易混淆/不成立的情况"}
规则：
- 只依据输入证据；evidence_quote 必须是 evidence 的连续子串，没有就空字符串。
- 没有证据的对比/反例留空，不要编造。
- 不要写“二者密切相关”这类空话。`;
    const user = `A：${a.name}（${a.definition ?? ""}）
B：${b.name}（${b.definition ?? ""}）
谓词：${predicate ?? "related"}
标签：${label ?? ""}
证据：${evidence ?? ""}`;
    try {
      const raw = await chat(system, user);
      const parsed = JSON.parse(raw) as any;
      const cmp = parsed.compare ?? {};
      return {
        one_line: String(parsed.one_line ?? label ?? ""),
        predicate: parsed.predicate ?? predicate ?? "related",
        evidence_quote:
          typeof parsed.evidence_quote === "string" && evidence && evidence.includes(parsed.evidence_quote)
            ? parsed.evidence_quote
            : "",
        compare: {
          same: Array.isArray(cmp.same) ? cmp.same.map(String).slice(0, 6) : [],
          different: Array.isArray(cmp.different) ? cmp.different.map(String).slice(0, 6) : [],
          boundary: Array.isArray(cmp.boundary) ? cmp.boundary.map(String).slice(0, 6) : [],
        },
        counterexample: String(parsed.counterexample ?? ""),
      };
    } catch (err) {
      console.warn("[llm] deepseek 关系卡失败：", err);
      return mockLLM.generateRelationDoc({ a, b, predicate, label, evidence });
    }
  },

  async generateUnderstandingTask({ sourceText, a, b, predicate, label, evidence, neighbors }) {
    const system = `你是知识辨析教练，不是出定义题。只输出 JSON：
{"learning_goal":"discriminate","misconception":"这道题针对的一个具体误解","stem":"题干：让用户判断关系类型/方向/边界，必须比较相邻类型","choices":[{"id":"kindOf","text":"..."},{"id":"partOf","text":"..."},{"id":"prerequisite","text":"..."}],"correct_choice":"kindOf","rubric":["评分点1","评分点2"],"evidence_quote":"原文连续子串","follow_up":"进一步追问"}
规则：
- 不要问“A 是什么”这种定义回忆题；
- 必须有一个明确误解，干扰项要像真的；
- evidence_quote 必须来自 sourceText，没有就空字符串；
- 题干要求用户说明理由，而不是只选字母。`;
    const user = `原文：${sourceText.slice(0, 2000)}
A：${a.name}（${a.definition ?? ""}）
B：${b.name}（${b.definition ?? ""}）
当前关系：${predicate ?? "related"} / ${label ?? ""}
关系证据：${evidence ?? ""}
邻近概念：${neighbors.join("、")}`;
    try {
      const raw = await chat(system, user);
      const parsed = JSON.parse(raw) as any;
      const choices = Array.isArray(parsed.choices)
        ? parsed.choices
            .filter((x: any) => x && x.id && x.text)
            .slice(0, 5)
            .map((x: any) => ({ id: String(x.id), text: String(x.text).slice(0, 80) }))
        : [];
      const correct = choices.some((x: any) => x.id === parsed.correct_choice)
        ? String(parsed.correct_choice)
        : "";
      if (!correct) throw new Error("invalid correct choice");
      return {
        learning_goal: "discriminate",
        misconception: String(parsed.misconception ?? ""),
        stem: String(parsed.stem ?? ""),
        choices,
        correct_choice: correct,
        rubric: Array.isArray(parsed.rubric) ? parsed.rubric.map(String).slice(0, 5) : [],
        evidence_quote:
          typeof parsed.evidence_quote === "string" && sourceText.includes(parsed.evidence_quote)
            ? parsed.evidence_quote
            : "",
        follow_up: String(parsed.follow_up ?? ""),
      };
    } catch (err) {
      console.warn("[llm] deepseek 辨析任务失败：", err);
      return mockLLM.generateUnderstandingTask({
        sourceText,
        a,
        b,
        predicate,
        label,
        evidence,
        neighbors,
      });
    }
  },
};
