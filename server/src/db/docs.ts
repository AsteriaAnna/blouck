import type { NodeDoc, RelationDoc } from "@blouck/shared";
import { db } from "./connection.js";

const now = () => Date.now();

export type NodeDocRow = {
  node_id: string;
  world_id: string;
  doc_json: string;
  notes_md: string;
  version: number;
  content_hash: string;
  generated_at: number;
  updated_at: number;
};

export type RelationDocRow = {
  edge_id: string;
  world_id: string;
  doc_json: string;
  notes_md: string;
  version: number;
  content_hash: string;
  generated_at: number;
  updated_at: number;
};

export function getNodeDocRow(nodeId: string): NodeDocRow | undefined {
  return db.prepare("SELECT * FROM node_docs WHERE node_id=?").get(nodeId) as NodeDocRow | undefined;
}

export function getNodeDoc(nodeId: string): NodeDoc | null {
  const row = getNodeDocRow(nodeId);
  if (!row) return null;
  try {
    return JSON.parse(row.doc_json) as NodeDoc;
  } catch {
    return null;
  }
}

export function upsertNodeDoc(nodeId: string, worldId: string, doc: NodeDoc, hash = "") {
  db.prepare(
    `INSERT INTO node_docs(node_id,world_id,doc_json,notes_md,version,content_hash,generated_at,updated_at)
     VALUES(?,?,?,'',1,?,?,?)
     ON CONFLICT(node_id) DO UPDATE SET
       doc_json=excluded.doc_json,
       version=node_docs.version+1,
       content_hash=excluded.content_hash,
       generated_at=excluded.generated_at,
       updated_at=excluded.updated_at`,
  ).run(nodeId, worldId, JSON.stringify(doc), hash, doc.generated_at, now());
}

export function setNodeDocNotes(nodeId: string, notesMd: string) {
  db.prepare(
    `INSERT INTO node_docs(node_id,world_id,doc_json,notes_md,version,content_hash,generated_at,updated_at)
     VALUES(?, '', '{}', ?, 1, '', 0, ?)
     ON CONFLICT(node_id) DO UPDATE SET notes_md=excluded.notes_md, updated_at=excluded.updated_at`,
  ).run(nodeId, notesMd, now());
}

export function getRelationDocRow(edgeId: string): RelationDocRow | undefined {
  return db.prepare("SELECT * FROM relation_docs WHERE edge_id=?").get(edgeId) as
    | RelationDocRow
    | undefined;
}

export function getRelationDoc(edgeId: string): RelationDoc | null {
  const row = getRelationDocRow(edgeId);
  if (!row) return null;
  try {
    return JSON.parse(row.doc_json) as RelationDoc;
  } catch {
    return null;
  }
}

export function upsertRelationDoc(edgeId: string, worldId: string, doc: RelationDoc, hash = "") {
  db.prepare(
    `INSERT INTO relation_docs(edge_id,world_id,doc_json,notes_md,version,content_hash,generated_at,updated_at)
     VALUES(?,?,?,'',1,?,?,?)
     ON CONFLICT(edge_id) DO UPDATE SET
       doc_json=excluded.doc_json,
       version=relation_docs.version+1,
       content_hash=excluded.content_hash,
       generated_at=excluded.generated_at,
       updated_at=excluded.updated_at`,
  ).run(edgeId, worldId, JSON.stringify(doc), hash, doc.generated_at, now());
}

export function setRelationDocNotes(edgeId: string, notesMd: string) {
  db.prepare(
    `INSERT INTO relation_docs(edge_id,world_id,doc_json,notes_md,version,content_hash,generated_at,updated_at)
     VALUES(?, '', '{}', ?, 1, '', 0, ?)
     ON CONFLICT(edge_id) DO UPDATE SET notes_md=excluded.notes_md, updated_at=excluded.updated_at`,
  ).run(edgeId, notesMd, now());
}
