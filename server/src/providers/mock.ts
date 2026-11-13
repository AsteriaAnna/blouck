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
    const seen = new Set(existing);
    const found: string[] = [];
    for (const term of Object.keys(TERMS)) {
      if (text.includes(term) && !seen.has(term)) {
        entities.push({ name: term, hint: TERMS[term].relate });
        found.push(term);
      }
    }
    if (entities.length === 0) {
      const m = text.match(/[A-Za-z][A-Za-z0-9+.-]{2,20}|[\u4e00-\u9fa5]{2,6}/g) ?? [];
      for (const token of m) {
        if (token.length < 2 || seen.has(token)) continue;
        if (["这个", "那个", "然后", "就是", "可以", "我们", "一下", "之后"].includes(token))
          continue;
        entities.push({ name: token });
        found.push(token);
        if (entities.length >= 2) break;
      }
    }
    if (found.length) {
      // 新节点先只有一条"探索来源"的正式关系；建议线只给已有节点之间
      relations.push({ type: "source", label: "本轮探索来源", target: found[0] });
    }
    if (found.length && existing.length) {
      const others = existing.filter((x) => x !== focus.name);
      const other = others[Math.floor(Math.random() * others.length)];
      if (other) {
        relations.push({
          type: "suggest",
          label: `「${found[0]}」可能关联？`,
          target: other,
        });
      }
    }
    if (text.includes("?") || text.includes("？")) {
      relations.push({
        type: "direction",
        label: "",
        target: focus.name,
        question: text.split(/[?？]/)[0].slice(-24) + "？",
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
