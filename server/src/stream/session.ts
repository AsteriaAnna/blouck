import {
  addEdge,
  addNode,
  computeFrontier,
  createSourceSpan,
  commitStreamEdges,
  getFocusStack,
  getGraph,
  getNode,
  setFocusStack,
  setNodesStatus,
  type NodeRow,
} from "../db.js";
import type { LLMProvider } from "../providers/types.js";
import { placeAround } from "../placement.js";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s\-_·、，。,.；;：:（）()【】\[\]《》"'“”]/g, "");

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

function uniqueNodes(nodes: NodeRow[]): NodeRow[] {
  const seen = new Set<string>();
  return nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
}

/** “它/这个/前者/后者”解析。前后者依赖焦点栈；没有栈时退回当前焦点。 */
function pronounFocus(text: string, stack: NodeRow[], current: NodeRow): NodeRow {
  if (/前者/.test(text) && stack[1]) return stack[1];
  if (/后者/.test(text) && stack[0]) return stack[0];
  if (/它们|他们/.test(text) && stack[1]) return stack[1];
  return current;
}

function relationPartner(name: string, relations: any[], nodes: NodeRow[]): NodeRow | undefined {
  const key = norm(name);
  for (const rel of relations) {
    if (norm(rel.source ?? "") === key) {
      const other = findNode(nodes, rel.target);
      if (other) return other;
    }
    if (norm(rel.target ?? "") === key) {
      const other = findNode(nodes, rel.source);
      if (other) return other;
    }
  }
  return undefined;
}

function pickParent(
  name: string,
  relations: any[],
  local: NodeRow[],
  stack: NodeRow[],
  current: NodeRow,
): NodeRow {
  const partner = relationPartner(name, relations, [...stack, ...local, current]);
  if (partner && norm(partner.name) !== norm(name)) return partner;
  const mentioned = local.filter((n) => norm(n.name) !== norm(name));
  if (mentioned.length) return mentioned[mentioned.length - 1];
  if (stack[0] && norm(stack[0].name) !== norm(name)) return stack[0];
  return current;
}

/**
 * 一段稳定文本 → provisional 节点/关系。
 * focus 栈：当前焦点 + 上一句焦点；parent 不再默认全部挂 focus。
 */
export async function ingestSegment(
  worldId: string,
  text: string,
  focusId: string | null,
  llm: LLMProvider,
) {
  const graph = getGraph(worldId);
  const stackIds = getFocusStack(worldId);
  const stack = stackIds.map((id) => getNode(id)).filter(Boolean) as NodeRow[];
  let current =
    (focusId ? getNode(focusId) : null) ??
    stack[0] ??
    (graph.nodes[0] ? getNode(graph.nodes[0].id) : null);
  if (!current) throw new Error("focus missing");

  const typed = text.trim();
  if (!typed) {
    return { focusId: current.id, focusStack: stack.map((n) => n.id), createdNodes: [], nodes: graph.nodes, edges: graph.edges };
  }

  const local = mentionedNodes(graph.nodes, typed);
  const pronounStack = stack;
  current = pronounFocus(typed, stack, current);
  if (local.length) current = local[local.length - 1];
  const activeStack = uniqueNodes([current, ...stack]);

  const span = createSourceSpan(worldId, typed);
  const result = await llm.extract({
    text: typed,
    focus: { id: current.id, name: current.name },
    existing: graph.nodes.map((n) => n.name),
  });

  const relations = result.relations ?? [];
  const created: NodeRow[] = [];
  const placed = graph.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));

  const entities = result.entities.filter((e) => {
    const n = e.name?.trim();
    return Boolean(n && n.length >= 2 && n.length <= 20 && !findNode(graph.nodes, n));
  });
  for (let ei = 0; ei < entities.length; ei++) {
    const ent = entities[ei];
    const name = ent.name.trim();
    const evidence = ent.evidence?.trim() ?? "";
    if (evidence && !typed.includes(evidence)) continue;
    if (!evidence) continue;
    const confidence = typeof ent.confidence === "number" ? ent.confidence : 0.7;
    if (confidence < 0.6) continue;

    let parent = pickParent(name, relations, local, activeStack, current);
    const pair = /前者/.test(typed) && /后者/.test(typed) && entities.length >= 2;
    if (pair && pronounStack[1]) {
      parent = ei === 0 ? pronounStack[1] : pronounStack[0] ?? parent;
    } else if (/前者/.test(typed) && pronounStack[1]) {
      parent = pronounStack[1];
    } else if (/后者/.test(typed) && pronounStack[0]) {
      parent = pronounStack[0];
    }
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

  for (const rel of relations) {
    const target =
      findNode(graph.nodes, rel.target) ?? created.find((n) => norm(n.name) === norm(rel.target ?? ""));
    if (!target) continue;
    const source =
      findNode(graph.nodes, rel.source) ??
      created.find((n) => norm(n.name) === norm(rel.source ?? "")) ??
      (activeStack[0] ?? current);
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

  // focus 栈：本句主题优先；没有新主题时保留当前/指代目标
  const topic = created[created.length - 1] ?? local[local.length - 1] ?? current;
  const siblings = created.slice(0, -1).reverse();
  const nextStack = uniqueNodes([topic, ...siblings, current, ...activeStack]).slice(0, 8);
  setFocusStack(worldId, nextStack.map((n) => n.id));

  computeFrontier(worldId);
  const fresh = getGraph(worldId);
  return {
    focusId: nextStack[0].id,
    focusStack: nextStack.map((n) => n.id),
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
