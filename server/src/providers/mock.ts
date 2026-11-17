import type {
  ASRProvider,
  ASRSession,
  ExtractResult,
  LLMProvider,
  QuizItem,
} from "./types.js";

/** 术语 → 关系提示（mock 用；真实实现交给模型） */
const TERMS: Record<string, { relate: string; kind: "source" | "formal" | "suggest" }> = {
  重排: { relate: "精排环节", kind: "source" },
  Rerank: { relate: "精排环节", kind: "source" },
  精排: { relate: "提升相关性", kind: "source" },
  混合检索: { relate: "关键词 + 向量", kind: "source" },
  BM25: { relate: "关键词召回", kind: "formal" },
  召回: { relate: "先粗排", kind: "source" },
  知识图谱: { relate: "增强检索", kind: "suggest" },
  多模态: { relate: "扩展输入形态", kind: "suggest" },
  长上下文: { relate: "替代部分检索", kind: "suggest" },
  评测集: { relate: "衡量效果", kind: "suggest" },
  Agent: { relate: "自主调用工具", kind: "suggest" },
  工作流: { relate: "编排步骤", kind: "suggest" },
};

/**
 * mock：不依赖任何外部服务，保证空世界也能走通
 * 语音 → 稳定文本 → 实体/关系 → 落图 的完整链路。
 */
export const mockLLM: LLMProvider = {
  name: "mock",

  async extract({ text, focus, existing }) {
    const entities: ExtractResult["entities"] = [];
    const relations: ExtractResult["relations"] = [];
    const seen = new Set(existing.map((x) => x.toLowerCase()));
    const found: string[] = [];
    const sentenceFor = (term: string) =>
      text
        .split(/[。！？!?；;]/)
        .map((s) => s.trim())
        .find((s) => s.includes(term)) ?? text.slice(0, 60);

    const typeOf = (term: string): "概念" | "方法" | "组件" | "指标" | "工具" => {
      if (["BM25", "向量数据库", "Embedding", "交叉编码器"].includes(term)) return "组件";
      if (["Rerank", "重排", "精排", "混合检索", "检索", "召回"].includes(term)) return "方法";
      if (["召回率", "准确率", "延迟"].includes(term)) return "指标";
      return "概念";
    };

    for (const term of Object.keys(TERMS)) {
      if (text.includes(term) && !seen.has(term.toLowerCase())) {
        entities.push({
          name: term,
          type: typeOf(term),
          definition: `${term}：${TERMS[term].relate}`,
          aliases: [],
          evidence: sentenceFor(term),
          confidence: 0.72,
        });
        found.push(term);
      }
    }
    if (entities.length === 0) {
      const m = text.match(/[A-Za-z][A-Za-z0-9+.-]{2,20}|[\u4e00-\u9fa5]{2,6}/g) ?? [];
      for (const token of m) {
        if (token.length < 2 || seen.has(token.toLowerCase())) continue;
        if (["这个", "那个", "然后", "就是", "可以", "我们", "一下", "之后"].includes(token))
          continue;
        entities.push({
          name: token,
          type: "概念",
          definition: token,
          evidence: sentenceFor(token),
          confidence: 0.62,
        });
        found.push(token);
        if (entities.length >= 2) break;
      }
    }

    // 每个新节点都有一条探索来源；有关联提示时给低置信度 formal/suggest
    for (const name of found) {
      relations.push({
        type: "source",
        source: focus.name,
        target: name,
        label: "本轮探索来源",
        evidence: sentenceFor(name),
        confidence: 0.9,
      });
      const hint = TERMS[name];
      if (hint) {
        relations.push({
          type: hint.kind === "suggest" ? "suggest" : "formal",
          predicate: "related",
          source: focus.name,
          target: name,
          label: `${focus.name} → ${hint.relate}`,
          evidence: sentenceFor(name),
          confidence: hint.kind === "suggest" ? 0.55 : 0.78,
        });
      }
    }
    if (text.includes("?") || text.includes("？")) {
      relations.push({
        type: "direction",
        source: focus.name,
        target: focus.name,
        label: "",
        question: text.split(/[?？]/)[0].slice(-24) + "？",
        confidence: 0.8,
      });
    }
    const processes: ExtractResult["processes"] = [];
    const seq = text.match(/依次做?([^。；;]+)/);
    if (seq) {
      const steps = seq[1].split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
      if (steps.length >= 3) {
        processes.push({
          name: `${focus.name}工作流`,
          steps,
          evidence: [seq[0]],
          confidence: 0.7,
        });
      }
    }
    return { entities, relations, processes };
  },

  async generateQuiz({ name, md }) {
    const items: QuizItem[] = [];
    for (let i = 1; i <= 5; i++) {
      items.push({
        kind: "short",
        prompt: `用你自己的话说明「${name}」的第 ${i} 个要点。`,
        answer: `${name} 的关键点 ${i}：${(md || name).slice(0, 40)}`,
      });
    }
    for (let i = 1; i <= 10; i++) {
      items.push({
        kind: "judge",
        prompt: `判断：「${name}」与第 ${i} 条相关理解存在稳定关系。`,
        answer: i % 3 === 0 ? "错" : "对",
      });
    }
    return items;
  },

  async judge({ answer, reference }) {
    const norm = (s: string) =>
      s.replace(/[\s，。,.、；;：:！!？?]/g, "").toLowerCase();
    const a = norm(answer);
    const r = norm(reference);
    if (!a) return { correct: false, feedback: "答案为空" };
    if (r === "对" || r === "错") {
      return a === r
        ? { correct: true, feedback: "判断正确" }
        : { correct: false, feedback: `参考答案：${r}` };
    }
    const chars = new Set(r.split(""));
    let hit = 0;
    for (const c of new Set(a.split(""))) if (chars.has(c)) hit++;
    const ratio = hit / Math.max(1, chars.size);
    return ratio >= 0.35
      ? { correct: true, feedback: "关键点基本覆盖（mock 判题）" }
      : { correct: false, feedback: "关键点不足，建议补充细节" };
  },

  async suggestRelation({ a, b, evidence }) {
    return {
      predicate: "related",
      label: `${a.name} 与 ${b.name}`,
      md: evidence ? `依据：${evidence}` : "用户手动关联；证据待补充。",
    };
  },

  async suggestDirections({ nodes, existing }) {
    const pool = ["上下文压缩", "查询改写", "语义缓存", "评测集", "幻觉检测", "多路召回", "重排模型", "文档分块策略"];
    const used = new Set(existing.map((x) => x.trim()));
    const out: any[] = [];
    for (const n of nodes.slice(0, 4)) {
      for (let i = 0; i < 4; i++) {
        const name = pool.find((x) => !used.has(x)) ?? `${n.name}的延伸${i + 1}`;
        used.add(name);
        out.push({
          node: n.name,
          question: `「${n.name}」往「${name}」延伸时，关键机制是什么？`,
          reason: "mock：预先计划一个延伸节点",
          target: { name, type: "概念" as const, definition: `mock 为「${n.name}」规划的延伸概念「${name}」。`, aliases: [] },
          predicate: "related" as const,
          label: "延伸",
        });
      }
    }
    return out;
  },

  async detectDungeons() {
    return { flows: [], domains: [] };
  },

  async generateUnderstandingTask({ a, b, predicate, evidence, variant = "boundary", neighbors }) {
    const types = [
      { id: "kindOf", text: "归类：A 是 B 的一种" },
      { id: "partOf", text: "组成：A 是 B 的一部分" },
      { id: "prerequisite", text: "前置：A 是 B 的前置" },
      { id: "contrast", text: "对比：A 与 B 形成对比" },
      { id: "related", text: "相关：二者只是相关" },
    ];
    const correct = types.some((x) => x.id === (predicate ?? "")) ? predicate! : "related";
    if (variant === "transfer") {
      const other = neighbors[0] ?? "相近概念";
      return {
        learning_goal: "transfer",
        misconception: "把一条关系的适用范围无限扩大",
        stem: `把「${a.name}」换成一个更宽泛的近邻「${other}」后，「${b.name}」与它的关系还成立吗？请说明边界。`,
        choices: [
          { id: "no", text: `不成立，需要重新判断「${other}」与「${b.name}」的关系` },
          { id: "yes", text: `成立，因为「${a.name}」和「${other}」差不多` },
          { id: "same", text: `成立，关系与概念无关` },
        ],
        correct_choice: "no",
        rubric: ["判断是否成立", "说明边界", "引用原文"],
        evidence_quote: (evidence || "").slice(0, 200),
        follow_up: "还有哪个场景会让这条关系失效？",
      };
    }
    if (variant === "counterexample") {
      return {
        learning_goal: "apply",
        misconception: "把原文支持的关系套到没有证据的场景",
        stem: `以下哪一句是对「${a.name}→${b.name}」关系的反例？请选择，并说明原文边界。`,
        choices: [
          { id: "counter", text: `原文没有支持「${a.name}」与「${b.name}」关系的证据` },
          { id: "support", text: `原文明确支持「${a.name}」与「${b.name}」的关系` },
          { id: "irrelevant", text: `「${a.name}」与「${b.name}」完全无关` },
        ],
        correct_choice: "counter",
        rubric: ["指出反例", "引用原文", "说明边界"],
        evidence_quote: (evidence || "").slice(0, 200),
        follow_up: "换一个场景，这个反例还成立吗？",
      };
    }
    if (variant === "error_correction") {
      return {
        learning_goal: "explain",
        misconception: "把关系方向或类型说反",
        stem: `关于「${a.name}」与「${b.name}」，哪一句是错误表述、需要修正？`,
        choices: [
          { id: "wrong", text: `「${b.name}」是「${a.name}」的${predicate ?? "相关"}关系` },
          { id: "right", text: `「${a.name}」与「${b.name}」是${predicate ?? "相关"}关系` },
        ],
        correct_choice: "wrong",
        rubric: ["指出错误", "给出正确表述", "引用原文"],
        evidence_quote: (evidence || "").slice(0, 200),
        follow_up: "正确表述应该怎么写？",
      };
    }
    return {
      learning_goal: "discriminate",
      misconception: "把相邻关系类型混用，或忽略关系方向",
      stem: `「${a.name}」与「${b.name}」之间是哪一种关系？请选择，并用原文说明为什么不是相邻类型。`,
      choices: types,
      correct_choice: correct,
      rubric: ["指出正确关系类型", "引用原文证据", "说明为什么不是相邻类型"],
      evidence_quote: (evidence || "").slice(0, 200),
      follow_up: "如果把两者的方向反过来，关系还成立吗？",
    };
  },

  async generateNodeUnderstandingTask({ node, neighbors, sourceText }) {
    const other = neighbors[0]?.name ?? "相近概念";
    return {
      learning_goal: "discriminate",
      misconception: `把「${node.name}」与「${other}」当成同一个东西`,
      stem: `关于「${node.name}」的边界，下面哪一项最符合原文？请选择，并说明「${node.name}」与「${other}」的区别。`,
      choices: [
        { id: "boundary", text: `「${node.name}」不等同于「${other}」，需要说明两者的边界` },
        { id: "same", text: `「${node.name}」与「${other}」是同义概念` },
        { id: "upper", text: `「${other}」是「${node.name}」的下位概念` },
      ],
      correct_choice: "boundary",
      rubric: ["指出边界", "引用原文", "说明为什么不是同义/上下位"],
      evidence_quote: (sourceText || "").slice(0, 200),
      follow_up: `如果换一个场景，「${node.name}」还成立吗？`,
    };
  },

  async generateNodeDoc({ name, type, definition, sourceText, neighbors }) {
    return {
      definition: definition || `${name} 是一个${type || "概念"}。`,
      position: neighbors.slice(0, 4).map((n) => ({
        node_id: n.id,
        predicate: n.predicate ?? "related",
        why: n.evidence || n.label || `与「${n.name}」相关`,
      })),
      boundary: `「${name}」的边界还需要更多材料来确认。`,
      source_quote: (sourceText || "").slice(0, 160),
      next_hint: neighbors[0]
        ? `继续追问「${name}」与「${neighbors[0].name}」的区别。`
        : `继续补充「${name}」的上下文。`,
    };
  },

  async generateRelationDoc({ a, b, predicate, label, evidence }) {
    return {
      one_line: label || `「${a.name}」与「${b.name}」存在${predicate ?? "相关"}关系。`,
      predicate: predicate ?? "related",
      evidence_quote: (evidence || "").slice(0, 200),
      compare: {
        same: [`都与「${a.name}」「${b.name}」的上下文相关`],
        different: [`需要更多材料确认两者的具体差异`],
        boundary: [],
      },
      counterexample: "",
    };
  },
};

/** mock 流式 ASR：按句式逐段吐 partial，用于前端联调 */
export const mockASR: ASRProvider = {
  name: "mock",
  open(events) {
    const script =
      "检索出来之后还要重排一下，Rerank 会按相关度重新排序，所以召回率和精排是两件事。";
    let i = 0;
    let timer: NodeJS.Timeout | null = null;
    const session: ASRSession = {
      push() {},
      end() {
        if (timer) clearInterval(timer);
        events.onFinal(script);
      },
    };
    timer = setInterval(() => {
      i += 3;
      if (i >= script.length) {
        if (timer) clearInterval(timer);
        events.onFinal(script);
      } else {
        events.onPartial(script.slice(0, i));
      }
    }, 160);
    return session;
  },
};
