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

export type PracticeStatus = "ready" | "source_required" | "unverified";

export type PracticeQuestion = { id: string; kind: string; prompt: string };

export type PracticePayload = {
  items: PracticeQuestion[];
  progress: { total: number; correct: number };
  status: PracticeStatus;
  message?: string;
  evidence_quote?: string;
};

function findSourceSpan(worldId: string, quote: string): { id: string; text: string } | undefined {
  if (!quote.trim()) return undefined;
  return db
    .prepare(
      "SELECT id, text FROM source_spans WHERE world_id=? AND instr(text, ?) > 0 ORDER BY created_at DESC LIMIT 1",
    )
    .get(worldId, quote) as { id: string; text: string } | undefined;
}

/**
 * 关系短练习：只有关系证据能回到用户原文时才生成事实题。
 * 无源/找不到原文 → 不给题目，返回 source_required；避免用模型生成的图谱考模型自己。
 */
export async function ensureRelationPractice(
  edgeId: string,
  llm: LLMProvider,
): Promise<PracticePayload> {
  const edge = db.prepare("SELECT * FROM edges WHERE id=?").get(edgeId) as EdgeRow | undefined;
  if (!edge) throw new Error("edge not found");
  let rows = listEdgePractice(edgeId);
  const span = findSourceSpan(edge.world_id, edge.evidence ?? "");

  if (rows.length === 0) {
    if (!span) {
      return {
        items: [],
        progress: countEdgePractice(edgeId),
        status: "source_required",
        message: "这条关系没有可回查的原文证据；事实题需要先补充来源/原文。",
      };
    }
    const doc = await ensureRelationDoc(edgeId, llm);
    const md = [
      `原文：${span.text.slice(0, 1200)}`,
      doc.doc ? `关系：${doc.doc.one_line}` : "",
      doc.doc ? `依据：${doc.doc.evidence_quote}` : "",
      doc.doc ? [...doc.doc.compare.same, ...doc.doc.compare.different].join("\n") : "",
      doc.doc?.counterexample ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const items = await llm.generateQuiz({
        name: `${edge.label || "关系"} 的关系辨析`,
        md,
      });
      rows = createEdgePractice(edge.world_id, edgeId, items, {
        sourceSpanId: span.id,
        evidenceQuote: edge.evidence,
        verification: "source_verified",
      });
    } catch (err) {
      console.warn("[practice] 关系题生成失败：", err);
    }
  }
  return {
    items: rows.map((r) => ({ id: r.id, kind: r.kind, prompt: r.prompt })),
    progress: countEdgePractice(edgeId),
    status: rows.length ? "ready" : "unverified",
    evidence_quote: rows[0]?.evidence_quote || edge.evidence,
    message: rows.length ? undefined : "题目生成失败，可稍后重试。",
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
