import { randomUUID } from "node:crypto";
import { db } from "./connection.js";

const now = () => Date.now();
const uid = () => randomUUID();

export function getFocusStack(worldId: string): string[] {
  const row = db.prepare("SELECT stack FROM focus_stack WHERE world_id=?").get(worldId) as
    | { stack: string }
    | undefined;
  if (!row) return [];
  try {
    const arr = JSON.parse(row.stack);
    return Array.isArray(arr) ? arr.map(String).slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function setFocusStack(worldId: string, stack: string[]) {
  const clean = [...new Set(stack.filter(Boolean))].slice(0, 12);
  db.prepare(
    "INSERT INTO focus_stack(world_id,stack,updated_at) VALUES(?,?,?) ON CONFLICT(world_id) DO UPDATE SET stack=excluded.stack, updated_at=excluded.updated_at",
  ).run(worldId, JSON.stringify(clean), now());
}

export type SourceSpanRow = {
  id: string;
  world_id: string;
  text: string;
  revision: number;
  created_at: number;
};

export function createSourceSpan(worldId: string, text: string, revision = 1): SourceSpanRow {
  const id = uid();
  db.prepare("INSERT INTO source_spans(id,world_id,text,revision,created_at) VALUES(?,?,?,?,?)").run(
    id,
    worldId,
    text,
    revision,
    now(),
  );
  return db.prepare("SELECT * FROM source_spans WHERE id=?").get(id) as SourceSpanRow;
}
