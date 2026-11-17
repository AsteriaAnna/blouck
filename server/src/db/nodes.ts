import { randomUUID } from "node:crypto";
import { db } from "./connection.js";

const now = () => Date.now();
const uid = () => randomUUID();

export type NodeRow = {
  id: string;
  world_id: string;
  name: string;
  x: number;
  y: number;
  free_md: string;
  hidden: number;
  tier: number;
  type: string;
  definition: string;
  aliases: string;
  source_span_id: string | null;
  frontier: number;
  status: "provisional" | "committed";
  created_at: number;
};

export function getNode(id: string): NodeRow | undefined {
  return db.prepare("SELECT * FROM nodes WHERE id=?").get(id) as NodeRow | undefined;
}

export function addNode(
  worldId: string,
  name: string,
  x: number,
  y: number,
  freeMd = "",
  meta: {
    type?: string;
    definition?: string;
    aliases?: string[];
    sourceSpanId?: string | null;
    status?: "provisional" | "committed";
  } = {},
): NodeRow {
  const id = uid();
  db.prepare(
    "INSERT INTO nodes(id,world_id,name,x,y,free_md,hidden,tier,type,definition,aliases,source_span_id,frontier,status,created_at) VALUES(?,?,?,?,?,?,0,0,?,?,?,?,0,?,?)",
  ).run(
    id,
    worldId,
    name,
    x,
    y,
    freeMd,
    meta.type ?? "概念",
    meta.definition ?? "",
    JSON.stringify(meta.aliases ?? []),
    meta.sourceSpanId ?? null,
    meta.status ?? "committed",
    now(),
  );
  return getNode(id)!;
}

export function setNodeStatus(id: string, status: "provisional" | "committed") {
  db.prepare("UPDATE nodes SET status=? WHERE id=?").run(status, id);
}

export function setNodesStatus(ids: string[], status: "provisional" | "committed") {
  for (const id of ids) setNodeStatus(id, status);
}

export function updateNodeMeta(
  id: string,
  patch: { type?: string; definition?: string; aliases?: string[]; sourceSpanId?: string | null },
) {
  const cur = getNode(id);
  if (!cur) return;
  db.prepare("UPDATE nodes SET type=?, definition=?, aliases=?, source_span_id=? WHERE id=?").run(
    patch.type ?? cur.type,
    patch.definition || cur.definition,
    JSON.stringify(patch.aliases ?? (JSON.parse(cur.aliases || "[]") as string[])),
    patch.sourceSpanId ?? cur.source_span_id,
    id,
  );
}

/** 重新计算前沿节点：没有向外知识关系的节点（隐藏节点不算） */

export function updateNodeMd(id: string, freeMd: string) {
  db.prepare("UPDATE nodes SET free_md=? WHERE id=?").run(freeMd, id);
}

export function setNodePosition(id: string, x: number, y: number) {
  db.prepare("UPDATE nodes SET x=?, y=? WHERE id=?").run(x, y, id);
}

export function setNodeHidden(id: string, hidden: number) {
  db.prepare("UPDATE nodes SET hidden=? WHERE id=?").run(hidden, id);
}

export function setNodeTier(id: string, tier: number) {
  db.prepare("UPDATE nodes SET tier=? WHERE id=?").run(tier, id);
}
