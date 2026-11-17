import { randomUUID } from "node:crypto";
import { db } from "./connection.js";

export type EventRow = {
  id: string;
  world_id: string | null;
  type: string;
  target_id: string | null;
  payload: string;
  created_at: number;
};

export function trackEvent(input: {
  worldId?: string | null;
  type: string;
  targetId?: string | null;
  payload?: unknown;
}): EventRow {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO events(id,world_id,type,target_id,payload,created_at) VALUES(?,?,?,?,?,?)",
  ).run(
    id,
    input.worldId ?? null,
    input.type.slice(0, 60),
    input.targetId ?? null,
    JSON.stringify(input.payload ?? {}),
    Date.now(),
  );
  return db.prepare("SELECT * FROM events WHERE id=?").get(id) as EventRow;
}

export function summarizeEvents(worldId?: string | null) {
  const where = worldId ? "WHERE world_id=?" : "";
  const args = worldId ? [worldId] : [];
  const total = (
    db.prepare(`SELECT COUNT(*) c FROM events ${where}`).get(...args) as { c: number }
  ).c;
  const byType = db
    .prepare(`SELECT type, COUNT(*) c FROM events ${where} GROUP BY type ORDER BY c DESC`)
    .all(...args) as { type: string; c: number }[];
  const recent = db
    .prepare(`SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT 50`)
    .all(...args) as EventRow[];
  return { total, byType, recent: recent.map((e) => ({ ...e, payload: JSON.parse(e.payload) })) };
}
