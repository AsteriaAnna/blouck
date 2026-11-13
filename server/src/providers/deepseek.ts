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
    const system =
      '你是知识图谱抽取器。只输出 JSON：{"entities":[{"name":"","hint":""}],"relations":[{"type":"source|formal|suggest|direction","label":"","target":"","question":""}]}。source=本轮探索来源；suggest=不确定的关联；direction=下一步方向（无 MD，可带 question）。不要编造因果，证据不足用 suggest。';
    const user = `当前节点：${focus.name}\n已有实体：${existing.join("、")}\n文本：${text}`;
    try {
      const raw = await chat(system, user);
      const parsed = JSON.parse(raw) as ExtractResult;
      return {
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      };
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
};
