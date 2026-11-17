import { randomUUID } from "node:crypto";
import { db } from "./connection.js";

const now = () => Date.now();
const uid = () => randomUUID();

export type DomainQuestionRow = {
  id: string;
  building_id: string;
  kind: "fill" | "judge" | "answer";
  prompt: string;
  answer: string;
  aliases: string;
  day: string;
  created_at: number;
};

export function listDomainQuestions(buildingId: string, day: string): DomainQuestionRow[] {
  return db
    .prepare("SELECT * FROM domain_questions WHERE building_id=? AND day=? ORDER BY created_at")
    .all(buildingId, day) as DomainQuestionRow[];
}

export function createDomainQuestions(
  buildingId: string,
  day: string,
  items: { kind: "fill" | "judge" | "answer"; prompt: string; answer: string; aliases?: string[] }[],
) {
  const stmt = db.prepare(
    "INSERT INTO domain_questions(id,building_id,kind,prompt,answer,aliases,day,created_at) VALUES(?,?,?,?,?,?,?,?)",
  );
  for (const it of items)
    stmt.run(uid(), buildingId, it.kind, it.prompt, it.answer, JSON.stringify(it.aliases ?? []), day, now());
}
