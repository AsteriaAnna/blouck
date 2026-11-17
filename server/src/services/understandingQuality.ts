import { db } from "../db.js";
import { getUnderstandingTask } from "../db/understanding.js";

export type QualityReport = {
  score: number;
  flags: string[];
  checks: Record<string, boolean>;
};

/**
 * 题目质量审计（启发式，不是真理）：
 * - 有原文引用且能回查
 * - 有明确误解
 * - 有选择/正确项
 * - 有 rubric
 * - 不是定义回忆题
 * - 要求解释
 */
export function auditUnderstandingTask(taskId: string): QualityReport | null {
  const task = getUnderstandingTask(taskId);
  if (!task) return null;
  const span = task.source_span_id
    ? (db.prepare("SELECT text FROM source_spans WHERE id=?").get(task.source_span_id) as
        | { text: string }
        | undefined)
    : undefined;
  const choices = (() => {
    try {
      return JSON.parse(task.choices_json || "[]") as { id: string; text: string }[];
    } catch {
      return [];
    }
  })();
  const rubric = (() => {
    try {
      return JSON.parse(task.rubric_json || "[]") as string[];
    } catch {
      return [];
    }
  })();
  const checks = {
    evidence: Boolean(
      task.evidence_quote && span?.text && span.text.includes(task.evidence_quote),
    ),
    misconception: (task.misconception ?? "").trim().length >= 8,
    choices:
      choices.length >= 2 &&
      choices.some((c) => c.id === task.correct_choice) &&
      choices.some((c) => c.id !== task.correct_choice),
    rubric: rubric.length >= 2,
    // 只有“什么是 X / X 是什么？”这类定义提问才扣分；“是什么关系”不算。
    notDefinition:
      !/(^|[，。；：])什么是/.test(task.stem) &&
      !/的定义是|定义：|的定义是什么/.test(task.stem) &&
      !/^[^，。；：]{0,24}是什么[？?]\s*$/.test(task.stem.trim()),
    comparison:
      /为什么|区别|不同|不是|边界|反例|迁移|换一个|哪一项|哪一种|哪一个|错在哪里|哪里错|错误|修正|改成|判断.*(错|不对)/.test(
        task.stem,
      ),
    explain: task.answer_type === "choice_explain",
  };
  const weights: Record<keyof typeof checks, number> = {
    evidence: 25,
    misconception: 15,
    choices: 15,
    rubric: 15,
    notDefinition: 10,
    comparison: 10,
    explain: 10,
  };
  let score = 0;
  const flags: string[] = [];
  for (const [k, ok] of Object.entries(checks) as [keyof typeof checks, boolean][]) {
    if (ok) score += weights[k];
    else flags.push(k);
  }
  return { score, flags, checks };
}
