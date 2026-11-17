import { randomUUID } from "node:crypto";
import type { EdgeKind as SharedEdgeKind, LineState, LineType } from "@blouck/shared";
import { db } from "./connection.js";

const now = () => Date.now();
const uid = () => randomUUID();

export type EdgeKind = SharedEdgeKind;

export type EdgeRow = {
  id: string;
  world_id: string;
  src: string;
  dst: string;
  kind: EdgeKind;
  label: string;
  md: string;
  question: string | null;
  frontier_x: number | null;
  frontier_y: number | null;
  consumed: number;
  predicate: string | null;
  evidence: string;
  confidence: number;
  origin: string;
  claim_status: string;
  revision: number;
  /** 方向线在生成时预先计划好的“延伸节点” */
  target_name: string | null;
  target_type: string | null;
  target_definition: string | null;
  target_aliases: string | null;
  target_predicate: string | null;
  target_label: string | null;
  /** canonical 派生字段（迁移期可选；由 getGraph 附加） */
  line_type?: LineType;
  line_state?: LineState;
  /** V3 提示池评分/显示位 */
  hint_score?: number;
  hint_display?: number;
  created_at: number;
};

/** 方向的延伸计划：探索时直接落这个节点，而不是拿问题去抽取 */

export function commitStreamEdges(worldId: string) {
  db.prepare(
    "UPDATE edges SET kind='formal' WHERE world_id=? AND origin='stream' AND kind='suggest' AND evidence<>''",
  ).run(worldId);
}

export function computeFrontier(worldId: string) {
  const nodes = db.prepare("SELECT id FROM nodes WHERE world_id=? AND hidden=0").all(worldId) as {
    id: string;
  }[];
  const hasOut = new Set(
    (
      db
        .prepare(
          "SELECT DISTINCT src FROM edges WHERE world_id=? AND kind='formal' AND src<>dst",
        )
        .all(worldId) as { src: string }[]
    ).map((r) => r.src),
  );
  const update = db.prepare("UPDATE nodes SET frontier=? WHERE id=?");
  for (const n of nodes) update.run(hasOut.has(n.id) ? 0 : 1, n.id);
}

export function updateEdgeMd(id: string, md: string, label?: string) {
  if (typeof label === "string") {
    db.prepare("UPDATE edges SET md=?, label=? WHERE id=?").run(md, label, id);
  } else {
    db.prepare("UPDATE edges SET md=? WHERE id=?").run(md, id);
  }
}

export function addEdge(
  worldId: string,
  src: string,
  dst: string,
  kind: EdgeKind,
  label = "",
  question: string | null = null,
  md = "",
  meta: {
    predicate?: string | null;
    evidence?: string;
    confidence?: number;
    origin?: string;
    /** 方向线：预先计划好的延伸节点 */
    target_name?: string | null;
    target_type?: string | null;
    target_definition?: string | null;
    target_aliases?: string | null;
    target_predicate?: string | null;
    target_label?: string | null;
  } = {},
): EdgeRow {
  const id = uid();
  db.prepare(
    "INSERT INTO edges(id,world_id,src,dst,kind,label,md,question,predicate,evidence,confidence,origin,target_name,target_type,target_definition,target_aliases,target_predicate,target_label,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    worldId,
    src,
    dst,
    kind,
    label,
    md,
    question,
    meta.predicate ?? null,
    meta.evidence ?? "",
    meta.confidence ?? 1,
    meta.origin ?? "auto",
    meta.target_name ?? null,
    meta.target_type ?? null,
    meta.target_definition ?? null,
    meta.target_aliases ?? null,
    meta.target_predicate ?? null,
    meta.target_label ?? null,
    now(),
  );
  return db.prepare("SELECT * FROM edges WHERE id=?").get(id) as EdgeRow;
}

export function updateEdgeKind(id: string, kind: EdgeKind) {
  db.prepare("UPDATE edges SET kind=? WHERE id=?").run(kind, id);
}
