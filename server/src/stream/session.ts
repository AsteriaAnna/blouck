import {
  addEdge,
  addNode,
  computeFrontier,
  createSourceSpan,
  getGraph,
  getNode,
  setNodesStatus,
  commitStreamEdges,
  type NodeRow,
} from "../db.js";
import type { LLMProvider } from "../providers/types.js";
import { placeAround } from "../placement.js";

const norm = (s: string) =>
  s.toLowerCase().replace(/[\s\-_·、，。,.；;：:（）()【】\[\]《》"'“”]/g, "");

function aliasesOf(n: NodeRow): string[] {
  try {
    return JSON.parse(n.aliases || "[]") as string[];
  } catch {
    return [];
  }
}

function findNode(nodes: NodeRow[], raw?: string) {
  const key = norm(raw ?? "");
  if (!key) return undefined;
  return nodes.find((n) => norm(n.name) === key || aliasesOf(n).some((a) => norm(a) === key));
}

function mentionedNodes(nodes: NodeRow[], text: string) {
  const t = norm(text);
  return nodes.filter((n) =>
    [n.name, ...aliasesOf(n)].some((x) => norm(x).length >= 2 && t.includes(norm(x))),
  );
}

/**
 * 一段稳定文本 → provisional 节点/关系。
 * 这是正式流式链路的最小核心，不触发方向/题目/副本。
 */
export async function ingestSegment(
  worldId: string,
  text: string,
  focusId: string | null,
  llm: LLMProvider,
) {
  const graph = getGraph(worldId);
  let focus = (focusId ? getNode(focusId) : null) ?? getNode(graph.nodes[0]?.id ?? "");
  if (!focus) throw new Error("focus missing");

  const typed = text.trim();
  if (!typed) return { focusId: focus.id, createdNodes: [], nodes: graph.nodes, edges: graph.edges };

  const local = mentionedNodes(graph.nodes, typed);
  if (local.length) focus = local[local.length - 1];

  const span = createSourceSpan(worldId, typed);
  const result = await llm.extract({
    text: typed,
    focus: { id: focus.id, name: focus.name },
    existing: graph.nodes.map((n) => n.name),
  });

  const created: NodeRow[] = [];
  const placed = graph.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));

  for (const ent of result.entities) {
    const name = ent.name?.trim();
    if (!name || name.length < 2 || name.length > 20 || findNode(graph.nodes, name)) continue;
    const evidence = ent.evidence?.trim() ?? "";
    if (evidence && !typed.includes(evidence)) continue;
    if (!evidence) continue;
    const confidence = typeof ent.confidence === "number" ? ent.confidence : 0.7;
    if (confidence < 0.6) continue;

    const parent = mentionedNodes(graph.nodes, typed).find((n) => norm(n.name) !== norm(name)) ?? focus;
    const pos = placeAround(placed, { id: parent.id, x: parent.x, y: parent.y }, {
      preferAngle: (placed.length * 1.7) % (Math.PI * 2),
    });
    const node = addNode(worldId, name, pos.x, pos.y, "", {
      type: ent.type ?? "概念",
      definition: ent.definition ?? "",
      aliases: ent.aliases ?? [],
      sourceSpanId: span.id,
      status: "provisional",
    });
    created.push(node);
    graph.nodes.push(node);
    placed.push({ id: node.id, x: node.x, y: node.y });
    addEdge(worldId, parent.id, node.id, "source", "本轮探索来源", null, "", {
      evidence,
      confidence: 0.9,
      origin: "stream",
    });
  }

  // provisional 关系：只建建议边，commit 时再决定是否升级
  for (const rel of result.relations ?? []) {
    const target = findNode(graph.nodes, rel.target) ?? created.find((n) => norm(n.name) === norm(rel.target ?? ""));
    if (!target) continue;
    const source = findNode(graph.nodes, rel.source) ?? created.find((n) => norm(n.name) === norm(rel.source ?? "")) ?? focus;
    if (!source || source.id === target.id) continue;
    let evidence = rel.evidence?.trim() ?? "";
    if (evidence && !typed.includes(evidence)) evidence = "";
    if (!evidence) evidence = target.name;
    addEdge(worldId, source.id, target.id, "suggest", rel.label || rel.predicate || "相关", null, "", {
      predicate: rel.predicate ?? "related",
      evidence,
      confidence: rel.confidence ?? 0.6,
      origin: "stream",
    });
  }

  const last = created[created.length - 1];
  computeFrontier(worldId);
  const fresh = getGraph(worldId);
  return {
    focusId: last?.id ?? focus.id,
    createdNodes: created,
    nodes: fresh.nodes,
    edges: fresh.edges,
  };
}

/** 句/整段 final：把 provisional 升级为 committed。 */
export function commitStream(worldId: string, ids?: string[]) {
  const graph = getGraph(worldId);
  const targets = ids?.length
    ? graph.nodes.filter((n) => ids.includes(n.id))
    : graph.nodes.filter((n) => n.status === "provisional");
  setNodesStatus(targets.map((n) => n.id), "committed");
  commitStreamEdges(worldId);
  computeFrontier(worldId);
  const fresh = getGraph(worldId);
  return { committed: targets.map((n) => n.id), nodes: fresh.nodes, edges: fresh.edges };
}
