import { randomUUID } from "node:crypto";
import { db } from "./connection.js";

export type ReviewVerdict = "good" | "bad";

export function recordTaskReview(taskId: string, verdict: ReviewVerdict, note = "") {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO understanding_task_reviews(id,task_id,verdict,note,created_at) VALUES(?,?,?,?,?)",
  ).run(id, taskId, verdict, note.slice(0, 500), Date.now());
  return db.prepare("SELECT * FROM understanding_task_reviews WHERE id=?").get(id);
}

export function listTaskReviews(taskId: string) {
  return db
    .prepare("SELECT * FROM understanding_task_reviews WHERE task_id=? ORDER BY created_at DESC")
    .all(taskId) as { id: string; task_id: string; verdict: string; note: string; created_at: number }[];
}

export function countTaskReviews(worldId?: string): { good: number; bad: number } {
  const where = worldId ? "WHERE t.world_id=?" : "";
  const args = worldId ? [worldId] : [];
  const rows = db
    .prepare(
      `SELECT r.verdict, COUNT(*) c FROM understanding_task_reviews r
       JOIN understanding_tasks t ON t.id=r.task_id ${where} GROUP BY r.verdict`,
    )
    .all(...args) as { verdict: string; c: number }[];
  return {
    good: rows.find((r) => r.verdict === "good")?.c ?? 0,
    bad: rows.find((r) => r.verdict === "bad")?.c ?? 0,
  };
}
