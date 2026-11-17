import { randomUUID } from "node:crypto";
import { db } from "./connection.js";

const now = () => Date.now();
const uid = () => randomUUID();

export type DirectionTargetPlan = {
  name: string;
  type?: string;
  definition?: string;
  aliases?: string[];
  predicate?: string | null;
  label?: string;
};

export type DirectionRow = {
  id: string;
  world_id: string;
  node_id: string;
  question: string;
  reason: string;
  target_hint: string | null;
  target_name: string | null;
  target_type: string | null;
  target_definition: string | null;
  target_aliases: string | null;
  target_predicate: string | null;
  target_label: string | null;
  status: "open" | "consumed" | "archived";
  consumed_span_id: string | null;
  created_at: number;
};

export function addDirection(
  worldId: string,
  nodeId: string,
  question: string,
  reason = "",
  plan?: DirectionTargetPlan | string | null,
): DirectionRow {
  const id = uid();
  const p = plan && typeof plan === "object" ? plan : null;
  const legacyHint = typeof plan === "string" ? plan : p?.name ?? null;
  db.prepare(
    `INSERT INTO directions(id,world_id,node_id,question,reason,target_hint,target_name,target_type,target_definition,target_aliases,target_predicate,target_label,status,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'open',?)`,
  ).run(
    id,
    worldId,
    nodeId,
    question,
    reason,
    legacyHint,
    p?.name ?? legacyHint,
    p?.type ?? null,
    p?.definition ?? null,
    p?.aliases ? JSON.stringify(p.aliases) : null,
    p?.predicate ?? null,
    p?.label ?? null,
    now(),
  );
  return db.prepare("SELECT * FROM directions WHERE id=?").get(id) as DirectionRow;
}

export function listDirections(worldId: string): DirectionRow[] {
  return db
    .prepare("SELECT * FROM directions WHERE world_id=? ORDER BY created_at")
    .all(worldId) as DirectionRow[];
}

export function consumeDirection(id: string, spanId: string | null = null) {
  db.prepare("UPDATE directions SET status='consumed', consumed_span_id=? WHERE id=?").run(spanId, id);
}
