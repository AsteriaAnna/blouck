import { randomUUID } from "node:crypto";
import { db } from "./connection.js";

const now = () => Date.now();
const uid = () => randomUUID();

export type QuizRow = {
  id: string;
  node_id: string;
  kind: "short" | "judge";
  prompt: string;
  answer: string;
  ai_generated: number;
  created_at: number;
};

export function listQuizzes(nodeId: string): QuizRow[] {
  return db
    .prepare("SELECT * FROM quizzes WHERE node_id=? ORDER BY kind, created_at")
    .all(nodeId) as QuizRow[];
}

export function createQuizzes(
  nodeId: string,
  items: { kind: "short" | "judge"; prompt: string; answer: string }[],
) {
  const stmt = db.prepare(
    "INSERT INTO quizzes(id,node_id,kind,prompt,answer,ai_generated,created_at) VALUES(?,?,?,?,?,1,?)",
  );
  for (const it of items) stmt.run(uid(), nodeId, it.kind, it.prompt, it.answer, now());
}

export function countPassed(nodeId: string) {
  const rows = db
    .prepare(
      `SELECT q.kind AS kind, COUNT(DISTINCT a.quiz_id) AS c
       FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
       WHERE q.node_id=? AND a.correct=1 GROUP BY q.kind`,
    )
    .all(nodeId) as { kind: string; c: number }[];
  const short = rows.find((r) => r.kind === "short")?.c ?? 0;
  const judge = rows.find((r) => r.kind === "judge")?.c ?? 0;
  return { short, judge };
}

/** 三档：1/1、3/5、5/10 同时满足 */
export function computeTier(nodeId: string): number {
  const { short, judge } = countPassed(nodeId);
  if (short >= 5 && judge >= 10) return 3;
  if (short >= 3 && judge >= 5) return 2;
  if (short >= 1 && judge >= 1) return 1;
  return 0;
}
