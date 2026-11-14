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
    return { entities, relations };
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

  async suggestDirections({ nodes }) {
    return nodes.slice(0, 3).map((n) => ({
      node: n.name,
      question: `「${n.name}」和${n.neighbors[0] ?? "相邻概念"}的区别是什么？`,
      reason: "mock：围绕定义与邻居生成",
    }));
  },

  async detectDungeons() {
    return { flows: [], domains: [] };
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
