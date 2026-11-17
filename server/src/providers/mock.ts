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
