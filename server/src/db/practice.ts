import { randomUUID } from "node:crypto";
import { db } from "./connection.js";

const now = () => Date.now();
const uid = () => randomUUID();

export type EdgePracticeRow = {
  id: string;
  world_id: string;
  edge_id: string;
  kind: "short" | "judge";
  prompt: string;
  answer: string;
  source_span_id: string | null;
  evidence_quote: string;
  verification: string;
  created_at: number;
};

export function listEdgePractice(edgeId: string): EdgePracticeRow[] {
  return db
    .prepare("SELECT * FROM edge_practice WHERE edge_id=? ORDER BY created_at LIMIT 3")
    .all(edgeId) as EdgePracticeRow[];
}

export function createEdgePractice(
  worldId: string,
  edgeId: string,
  items: { kind: "short" | "judge"; prompt: string; answer: string }[],
  meta: { sourceSpanId?: string | null; evidenceQuote?: string; verification?: string } = {},
): EdgePracticeRow[] {
  const stmt = db.prepare(
    "INSERT INTO edge_practice(id,world_id,edge_id,kind,prompt,answer,source_span_id,evidence_quote,verification,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
  );
  for (const it of items.slice(0, 3)) {
    stmt.run(
      uid(),
      worldId,
      edgeId,
      it.kind,
      it.prompt,
      it.answer,
      meta.sourceSpanId ?? null,
      meta.evidenceQuote ?? "",
      meta.verification ?? "unverified",
      now(),
    );
  }
  return listEdgePractice(edgeId);
}

export function getEdgePracticeItem(id: string): EdgePracticeRow | undefined {
  return db.prepare("SELECT * FROM edge_practice WHERE id=?").get(id) as EdgePracticeRow | undefined;
}

export function recordEdgeAttempt(practiceId: string, correct: boolean) {
  db.prepare("INSERT INTO edge_attempts(id,practice_id,correct,at) VALUES(?,?,?,?)").run(
    uid(),
    practiceId,
    correct ? 1 : 0,
    now(),
  );
}

export function countEdgePractice(edgeId: string): { total: number; correct: number } {
  const total = (
    db.prepare("SELECT COUNT(*) c FROM edge_practice WHERE edge_id=?").get(edgeId) as { c: number }
  ).c;
  const correct = (
    db
      .prepare(
        "SELECT COUNT(DISTINCT a.practice_id) c FROM edge_attempts a JOIN edge_practice p ON p.id=a.practice_id WHERE p.edge_id=? AND a.correct=1",
      )
      .get(edgeId) as { c: number }
  ).c;
  return { total, correct };
}
