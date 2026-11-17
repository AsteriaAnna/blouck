import { db } from "../db.js";
import type { EdgeRow } from "../db/edges.js";
import {
  countEdgePractice,
  createEdgePractice,
  getEdgePracticeItem,
  listEdgePractice,
  recordEdgeAttempt,
} from "../db/practice.js";
import { ensureRelationDoc } from "./contentDocs.js";
import type { LLMProvider } from "../providers/types.js";

export type PracticeQuestion = { id: string; kind: string; prompt: string };

/** 关系短练习：从关系卡生成/缓存最多 3 题；返回时去掉答案。 */
export async function ensureRelationPractice(
  edgeId: string,
  llm: LLMProvider,
): Promise<{ items: PracticeQuestion[]; progress: { total: number; correct: number } }> {
  const edge = db.prepare("SELECT * FROM edges WHERE id=?").get(edgeId) as EdgeRow | undefined;
  if (!edge) throw new Error("edge not found");
  let rows = listEdgePractice(edgeId);
  if (rows.length === 0) {
    const doc = await ensureRelationDoc(edgeId, llm);
    const md = doc.doc
      ? [
          doc.doc.one_line,
          `依据：${doc.doc.evidence_quote}`,
          ...doc.doc.compare.same,
          ...doc.doc.compare.different,
          doc.doc.counterexample,
        ].join("\n")
      : edge.label || edge.md;
    try {
      const items = await llm.generateQuiz({
        name: `${edge.label || "关系"} 的关系辨析`,
        md,
      });
      rows = createEdgePractice(edge.world_id, edgeId, items);
    } catch (err) {
      console.warn("[practice] 关系题生成失败：", err);
    }
  }
  return {
    items: rows.map((r) => ({ id: r.id, kind: r.kind, prompt: r.prompt })),
    progress: countEdgePractice(edgeId),
  };
}

export async function answerRelationPractice(
  practiceId: string,
  answer: string,
  llm: LLMProvider,
) {
  const item = getEdgePracticeItem(practiceId);
  if (!item) return null;
  const judged = await llm.judge({
    prompt: item.prompt,
    answer,
    reference: item.answer,
  });
  recordEdgeAttempt(item.id, judged.correct);
  return {
    correct: judged.correct,
    feedback: judged.feedback,
    progress: countEdgePractice(item.edge_id),
  };
}
