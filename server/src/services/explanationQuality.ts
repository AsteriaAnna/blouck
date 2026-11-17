export type ExplanationQuality = {
  score: number;
  covered: string[];
  missing: string[];
  feedback: string;
};

const REASONING = /因为|所以|依据|原文|区别|不同|不是|而是|边界|条件|因此/;

function coverageText(s: string): string {
  return s.replace(/[\s，。,.、；;：:！!？?（）()「」“”"'—-]/g, "");
}

/** 启发式解释评分：长度/推理词/rubric 覆盖/判题通过。不是语义真理。 */
export function scoreExplanation(
  explanation: string,
  rubric: string[],
  judgedCorrect: boolean,
): ExplanationQuality {
  const text = coverageText(explanation);
  if (!text) {
    return { score: 0, covered: [], missing: rubric, feedback: "没有写理由，理解题不能只选答案。" };
  }
  let score = text.length >= 20 ? 20 : text.length >= 8 ? 10 : 0;
  if (REASONING.test(explanation)) score += 20;
  const covered: string[] = [];
  const missing: string[] = [];
  for (const item of rubric) {
    const key = coverageText(item);
    const grams: string[] = [];
    for (let i = 0; i + 2 <= key.length; i++) grams.push(key.slice(i, i + 2));
    if (grams.some((g) => text.includes(g))) covered.push(item);
    else missing.push(item);
  }
  if (rubric.length) score += Math.round((covered.length / rubric.length) * 40);
  if (judgedCorrect) score += 20;
  const final = Math.min(100, score);
  const feedback =
    final >= 70
      ? "解释覆盖了主要评分点。"
      : `解释还缺：${missing.slice(0, 3).join("；") || "更具体的边界/原因"}`;
  return { score: final, covered, missing, feedback };
}
