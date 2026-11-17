import type { NodeDoc, NodeDocPayload, RelationDoc, RelationDocPayload } from "@blouck/shared";
import { db, getGraph, getNode } from "../db.js";
import {
  getNodeDoc,
  getNodeDocRow,
  getRelationDoc,
  getRelationDocRow,
  upsertNodeDoc,
  upsertRelationDoc,
} from "../db/docs.js";
import type { EdgeRow } from "../db/edges.js";
import type { LLMProvider } from "../providers/types.js";

function sourceTextOf(nodeId: string): string {
  const row = db
    .prepare(
      "SELECT s.text FROM nodes n JOIN source_spans s ON s.id=n.source_span_id WHERE n.id=?",
    )
    .get(nodeId) as { text: string } | undefined;
  return row?.text ?? "";
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h);
}

function fallbackNodeDoc(
  nodeId: string,
  name: string,
  definition: string,
  neighbors: { id: string; name: string; predicate?: string | null; label?: string; evidence?: string }[],
  sourceText: string,
  nextHint: string,
): NodeDoc {
  return {
    definition: definition || `${name} 是一个知识节点。`,
    position: neighbors.slice(0, 4).map((n) => ({
      node_id: n.id,
      predicate: n.predicate ?? "related",
      why: n.evidence || n.label || `与「${n.name}」相关`,
    })),
    boundary: "",
    source_quote: sourceText.slice(0, 160),
    next_hint: nextHint,
    generated_at: Date.now(),
  };
}

function fallbackRelationDoc(
  a: { name: string; definition?: string },
  b: { name: string; definition?: string },
  edge: EdgeRow,
): RelationDoc {
  return {
    one_line: edge.label || `「${a.name}」与「${b.name}」相关。`,
    predicate: edge.predicate ?? "related",
    evidence_quote: (edge.evidence || "").slice(0, 200),
    compare: { same: [], different: [], boundary: [] },
    counterexample: "",
    generated_at: Date.now(),
  };
}

function nextDirectionHint(nodeId: string): string {
  const row = db
    .prepare(
      "SELECT question FROM directions WHERE node_id=? AND status='open' ORDER BY created_at LIMIT 1",
    )
    .get(nodeId) as { question: string } | undefined;
  return row?.question ?? "";
}

/**
 * 懒生成节点理解卡：优先 LLM；证据/结构校验失败则模板兜底。
 * 不覆盖 notes_md；同一内容幂等（已有文档直接返回）。
 */
export async function ensureNodeDoc(
  nodeId: string,
  llm: LLMProvider,
  force = false,
): Promise<NodeDocPayload> {
  const node = getNode(nodeId);
  if (!node) return { doc: null, notes_md: "", status: "missing" };
  const existing = getNodeDocRow(nodeId);
  if (existing && !force) {
    const doc = getNodeDoc(nodeId);
    return { doc, notes_md: existing.notes_md, status: doc ? "ready" : "failed" };
  }

  const graph = getGraph(node.world_id);
  const semantic = graph.edges.filter(
    (e) => (e.src === nodeId || e.dst === nodeId) && (e.kind === "formal" || e.kind === "suggest"),
  );
  const neighbors = semantic.slice(0, 6).map((e) => {
    const otherId = e.src === nodeId ? e.dst : e.src;
    const other = graph.nodes.find((n) => n.id === otherId);
    return {
      id: otherId,
      name: other?.name ?? otherId,
      predicate: e.predicate ?? "related",
      label: e.label,
      evidence: e.evidence,
    };
  });
  const sourceText = sourceTextOf(nodeId);
  let doc: NodeDoc;
  try {
    const draft = await llm.generateNodeDoc({
      name: node.name,
      type: node.type,
      definition: node.definition,
      sourceText,
      neighbors,
    });
    const allowed = new Set(neighbors.map((n) => n.id));
    doc = {
      definition: draft.definition || node.definition || `${node.name} 是一个知识节点。`,
      position: draft.position.filter((p) => allowed.has(p.node_id)).slice(0, 6),
      boundary: draft.boundary,
      source_quote:
        draft.source_quote && sourceText.includes(draft.source_quote)
          ? draft.source_quote
          : sourceText.slice(0, 160),
      next_hint: draft.next_hint || nextDirectionHint(nodeId),
      generated_at: Date.now(),
    };
    if (!doc.position.length) {
      doc.position = fallbackNodeDoc(nodeId, node.name, node.definition, neighbors, sourceText, doc.next_hint).position;
    }
  } catch (err) {
    console.warn("[docs] 节点卡生成失败，使用模板：", err);
    doc = fallbackNodeDoc(
      nodeId,
      node.name,
      node.definition,
      neighbors,
      sourceText,
      nextDirectionHint(nodeId),
    );
  }
  upsertNodeDoc(nodeId, node.world_id, doc, hash(JSON.stringify(doc)));
  const row = getNodeDocRow(nodeId);
  return { doc, notes_md: row?.notes_md ?? "", status: "ready" };
}

/** 懒生成关系对照卡；只有关系边才生成，避免给方向/来路也造 MD。 */
export async function ensureRelationDoc(
  edgeId: string,
  llm: LLMProvider,
  force = false,
): Promise<RelationDocPayload> {
  const edge = db.prepare("SELECT * FROM edges_canonical WHERE id=?").get(edgeId) as
    | EdgeRow
    | undefined;
  if (!edge || (edge.kind !== "formal" && edge.kind !== "suggest")) {
    return { doc: null, notes_md: "", status: "missing" };
  }
  const existing = getRelationDocRow(edgeId);
  if (existing && !force) {
    const doc = getRelationDoc(edgeId);
    return { doc, notes_md: existing.notes_md, status: doc ? "ready" : "failed" };
  }
  const a = getNode(edge.src);
  const b = getNode(edge.dst);
  if (!a || !b) return { doc: null, notes_md: "", status: "missing" };

  let doc: RelationDoc;
  try {
    const draft = await llm.generateRelationDoc({
      a: { id: a.id, name: a.name, definition: a.definition },
      b: { id: b.id, name: b.name, definition: b.definition },
      predicate: edge.predicate,
      label: edge.label,
      evidence: edge.evidence,
    });
    doc = {
      one_line: draft.one_line || edge.label,
      predicate: edge.predicate ?? draft.predicate ?? "related",
      evidence_quote:
        draft.evidence_quote && edge.evidence.includes(draft.evidence_quote)
          ? draft.evidence_quote
          : edge.evidence.slice(0, 200),
      compare: {
        same: draft.compare.same.slice(0, 6),
        different: draft.compare.different.slice(0, 6),
        boundary: draft.compare.boundary.slice(0, 6),
      },
      counterexample: draft.counterexample,
      generated_at: Date.now(),
    };
  } catch (err) {
    console.warn("[docs] 关系卡生成失败，使用模板：", err);
    doc = fallbackRelationDoc(a, b, edge);
  }
  upsertRelationDoc(edgeId, edge.world_id, doc, hash(JSON.stringify(doc)));
  const row = getRelationDocRow(edgeId);
  return { doc, notes_md: row?.notes_md ?? "", status: "ready" };
}
