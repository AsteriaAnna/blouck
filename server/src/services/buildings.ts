import {
  addEdge,
  addNode,
  createBuilding,
  getGraph,
  getNode,
  listBuildings,
  refreshBuildingStatus,
  setBuildingStatus,
  type EdgeRow,
  type NodeRow,
} from "../db.js";
import { ensureBuildingPositions } from "../assetops.js";
import { llm } from "../providers/active.js";
import {
  detectDomainCandidates,
  detectFlowCandidates,
  toDungeonEdges,
  toDungeonNodes,
  validateDomainCandidate,
  validateFlowCandidate,
} from "../dungeons.js";

function detectBuildings(worldId: string, focus: NodeRow, all: NodeRow[]) {
  const bs = listBuildings(worldId);
  if (!bs.some((b) => b.kind === "domain") && all.length >= 4) {
    createBuilding(
      worldId,
      "domain",
      focus.id,
      "领域副本",
      "领域每日练习 · 10 题",
      `## 领域副本\n\n围绕「${focus.name}」及其邻居的每日练习。`,
      [],
    );
  }
  if (!bs.some((b) => b.kind === "flow") && all.length >= 5) {
    const steps = orderedSteps(worldId).slice(0, 6);
    if (steps.length >= 3) {
      createBuilding(
        worldId,
        "flow",
        all[0].id,
        "流程副本",
        "流程排序 · 连线题",
        "## 流程副本\n\n把打乱的步骤按正确顺序连接。",
        steps,
      );
    }
  }
}

/** 最长 formal 链：DFS 简单路径（深度≤6，容忍图里有环），链长 3—6 才生成流程副本 */
function longestFormalChain(nodes: NodeRow[], formalEdges: { src: string; dst: string }[]): string[] {
  const out = new Map<string, string[]>();
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) out.set(n.id, []);
  for (const e of formalEdges) {
    if (!ids.has(e.src) || !ids.has(e.dst)) continue;
    out.get(e.src)!.push(e.dst);
  }
  let best: string[] = [];
  const dfs = (id: string, path: string[], seen: Set<string>) => {
    if (path.length > best.length) best = [...path];
    if (path.length >= 6) return;
    for (const nb of out.get(id) ?? []) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      path.push(nb);
      dfs(nb, path, seen);
      path.pop();
      seen.delete(nb);
    }
  };
  for (const n of nodes) dfs(n.id, [n.id], new Set([n.id]));
  return best;
}

/** 副本发现门槛：世界要先长大、有证据关系、有可探索边缘，才允许检测副本。 */
export function dungeonReadiness(worldId: string): {
  ready: boolean;
  nodes: number;
  evidenceEdges: number;
  frontier: number;
} {
  const { nodes, edges } = getGraph(worldId);
  const visible = nodes.filter((n) => !n.hidden);
  const evidenceEdges = edges.filter(
    (e) => e.kind === "formal" && e.src !== e.dst && (e.evidence ?? "").trim().length > 0,
  ).length;
  const frontier = visible.filter((n) => n.frontier === 1).length;
  return {
    ready: visible.length >= 8 && evidenceEdges >= 4 && frontier >= 1,
    nodes: visible.length,
    evidenceEdges,
    frontier,
  };
}

/**
 * 副本生成 v2：AI/规则只提候选，这里用硬校验（流程唯一序、每步来源、领域共同依据）。
 * 规则细节见 docs/design/dungeon-generation-rules.md。
 */
export function detectBuildingsV2(worldId: string, _focus: NodeRow, _all: NodeRow[], force = false) {
  if (!force && !dungeonReadiness(worldId).ready) return;
  const bs = listBuildings(worldId);
  const { nodes, edges } = getGraph(worldId);
  const dNodes = toDungeonNodes(nodes);
  const dEdges = toDungeonEdges(edges);

  {
    const domainList = () => listBuildings(worldId).filter((b) => b.kind === "domain");
    const existing = bs
      .filter((b) => b.kind === "domain")
      .map((b) => {
        try {
          return JSON.parse(b.steps || "[]") as string[];
        } catch {
          return [];
        }
      });
    for (const candidate of detectDomainCandidates(dNodes, dEdges, existing)) {
      if (domainList().length >= 3) break;
      const fp = candidate.members.map((m) => m.id).sort().join("|");
      if (domainList().some((b) => b.fingerprint === fp)) continue;
      const check = validateDomainCandidate(dNodes, dEdges, candidate, existing);
      if (!check.ok) continue;
      const degree = (id: string) =>
        dEdges.filter((e) => e.kind === "formal" && (e.src === id || e.dst === id)).length;
      const anchorId =
        candidate.commonParent ??
        [...candidate.members].sort((a, b) => degree(b.id) - degree(a.id))[0].id;
      const anchorNode =
        nodes.find((n) => n.id === anchorId) ?? nodes.find((n) => n.id === candidate.members[0].id)!;
      createBuilding(
        worldId,
        "domain",
        anchorNode.id,
        `${candidate.domainName} · 领域副本`,
        `领域每日练习 · 10 题 · ${candidate.members.length} 个概念`,
        `## 领域副本

领域：**${candidate.domainName}**

成员：${candidate.members
          .map((m) => m.name)
          .join("、")}

依据：${candidate.commonParent ? "共同上位/共同邻居" : "共同来源"}。`,
        candidate.members.map((m) => m.id),
      );
      ensureBuildingPositions(worldId);
      break;
    }
  }

  {
    const flowList = () => listBuildings(worldId).filter((b) => b.kind === "flow");
    for (const candidate of detectFlowCandidates(dNodes, dEdges)) {
      if (flowList().length >= 3) break;
      const check = validateFlowCandidate(dNodes, candidate);
      if (!check.ok || !check.order) continue;
      const fingerprint = [...check.order].sort().join("|");
      if (flowList().some((b) => b.fingerprint === fingerprint)) continue;
      const head = nodes.find((n) => n.id === check.order![0]);
      if (!head) continue;
      createBuilding(
        worldId,
        "flow",
        head.id,
        candidate.processName,
        `流程排序 · ${check.order.length} 步`,
        `## 流程副本

过程：**${candidate.processName}**

顺序：${check.order
          .map((id) => nodes.find((n) => n.id === id)?.name ?? id)
          .join(" → ")}

依据：${candidate.precedence
          .map((p) => `「${p.evidence}」`)
          .join("；")}`,
        check.order,
      );
      ensureBuildingPositions(worldId);
      break;
    }
  }

  refreshAllBuildingStatus(worldId);
}


/** LLM 提出副本候选，程序硬校验；规则检测作为兜底 */
export async function detectBuildingsLLM(worldId: string, focus: NodeRow, force = false) {
  if (!force && !dungeonReadiness(worldId).ready) return;
  const bs = listBuildings(worldId);
  if (bs.some((b) => b.kind === "flow") && bs.some((b) => b.kind === "domain")) return;
  const graph = getGraph(worldId);
  const dNodes = toDungeonNodes(graph.nodes);
  const dEdges = toDungeonEdges(graph.edges);
  const byName = new Map(graph.nodes.map((n) => [n.name, n]));
  const suggestions = await llm.detectDungeons({
    nodes: graph.nodes.map((n) => ({ name: n.name, type: n.type, definition: n.definition })),
    edges: graph.edges
      .filter((e) => e.kind === "formal")
      .map((e) => ({ src: e.src, dst: e.dst, predicate: e.predicate, label: e.label, evidence: e.evidence })),
  });

  {
    const flowList = () => listBuildings(worldId).filter((b) => b.kind === "flow");
    for (const f of suggestions.flows ?? []) {
      if (flowList().length >= 3) break;
      const steps = (f.steps ?? [])
        .map((name) => byName.get(name))
        .filter(Boolean) as NodeRow[];
      const precedence = (f.precedence ?? [])
        .map((x) => {
          const before = byName.get(x.before);
          const after = byName.get(x.after);
          return before && after ? { before: before.id, after: after.id, evidence: x.evidence } : null;
        })
        .filter(Boolean) as { before: string; after: string; evidence: string }[];
      if (steps.length < 3) continue;
      const fingerprint = steps.map((n) => n.id).sort().join("|");
      if (flowList().some((b) => b.fingerprint === fingerprint)) continue;
      const rawName = (f.processName ?? "").trim();
      const processName =
        !rawName || rawName.length < 3 || rawName === focus.name
          ? `${steps[0].name}流程`
          : rawName;
      const candidate = {
        processName,
        steps: steps.map((n) => ({ id: n.id, name: n.name })),
        precedence,
        confidence: typeof f.confidence === "number" ? f.confidence : 0.8,
        origin: "ai" as const,
      };
      const check = validateFlowCandidate(dNodes, candidate);
      if (!check.ok || !check.order) continue;
      const head = graph.nodes.find((n) => n.id === check.order![0]);
      if (!head) continue;
      createBuilding(
        worldId,
        "flow",
        head.id,
        candidate.processName,
        `流程排序 · ${check.order.length} 步`,
        `## 流程副本\n\n过程：**${candidate.processName}**\n\n顺序：${check.order
          .map((id) => graph.nodes.find((n) => n.id === id)?.name ?? id)
          .join(" → ")}\n\n依据：${precedence.map((p) => `「${p.evidence}」`).join("；")}`,
        check.order,
      );
      ensureBuildingPositions(worldId);
      break;
    }
  }

  {
    const domainList = () => listBuildings(worldId).filter((b) => b.kind === "domain");
    for (const d of suggestions.domains ?? []) {
      if (domainList().length >= 3) break;
      const members = (d.members ?? [])
        .map((name) => byName.get(name))
        .filter(Boolean) as NodeRow[];
      if (members.length < 4) continue;
      const fingerprint = members.map((n) => n.id).sort().join("|");
      if (domainList().some((b) => b.fingerprint === fingerprint)) continue;
      const parent = d.commonParent ? byName.get(d.commonParent) : undefined;
      const candidate = {
        domainName: d.domainName || `${members[0].name}领域`,
        members: members.map((n) => ({ id: n.id, name: n.name })),
        commonParent: parent?.id,
        sharedSpanIds: d.sharedSpanIds,
        confidence: typeof d.confidence === "number" ? d.confidence : 0.8,
        origin: "ai" as const,
      };
      const check = validateDomainCandidate(dNodes, dEdges, candidate, []);
      if (!check.ok) continue;
      const anchorNode = parent ?? members[0];
      createBuilding(
        worldId,
        "domain",
        anchorNode.id,
        `${candidate.domainName} · 领域副本`,
        `领域每日练习 · 10 题 · ${members.length} 个概念`,
        `## 领域副本\n\n领域：**${candidate.domainName}**\n\n成员：${members
          .map((n) => n.name)
          .join("、")}\n\n依据：LLM 识别 + 程序校验。`,
        members.map((n) => n.id),
      );
      ensureBuildingPositions(worldId);
      break;
    }
  }
  refreshAllBuildingStatus(worldId);
  void focus;
}

/** 依据隐藏/争议变化，把副本标记为 stale；恢复后重新计算状态 */
export function refreshStaleBuildings(worldId: string) {
  const graph = getGraph(worldId);
  for (const b of listBuildings(worldId)) {
    const steps = (() => {
      try {
        return JSON.parse(b.steps || "[]") as string[];
      } catch {
        return [];
      }
    })();
    const basis = steps.length
      ? steps
      : [
          b.anchor,
          ...graph.edges
            .filter((e) => e.kind === "formal" && (e.src === b.anchor || e.dst === b.anchor))
            .map((e) => (e.src === b.anchor ? e.dst : e.src)),
        ];
    const hidden = basis.some((id) => (getNode(id)?.hidden ?? 0) === 1);
    const disputed =
      steps.length > 0 &&
      graph.edges.some(
        (e) =>
          e.claim_status === "disputed" &&
          basis.includes(e.src) &&
          basis.includes(e.dst),
      );
    if (hidden || disputed) {
      if (b.status !== "stale") setBuildingStatus(b.id, "stale");
    } else if (b.status === "stale") {
      refreshBuildingStatus(b.anchor);
    }
  }
}

/** 副本解锁状态：流程看链上节点，领域看锚点邻域，均需当前 tier≥1 */
export function refreshAllBuildingStatus(worldId: string) {
  for (const b of listBuildings(worldId)) {
    if (b.status === "cleared") continue;
    const steps = (() => {
      try {
        return JSON.parse(b.steps || "[]") as string[];
      } catch {
        return [];
      }
    })();
    let ready = false;
    if (b.kind === "flow") {
      const asNodes = steps.map((x) => getNode(x)).filter(Boolean);
      ready =
        asNodes.length === steps.length
          ? steps.length >= 3 && asNodes.every((n) => (n?.tier ?? 0) >= 1)
          : (getNode(b.anchor)?.tier ?? 0) >= 1;
    } else if (steps.length) {
      ready = steps.filter((id) => (getNode(id)?.tier ?? 0) >= 1).length >= 2;
    } else {
      const { edges } = getGraph(worldId);
      const ids = new Set<string>([b.anchor]);
      for (const e of edges) {
        if (e.kind !== "formal") continue;
        if (e.src === b.anchor) ids.add(e.dst);
        if (e.dst === b.anchor) ids.add(e.src);
      }
      ready = [...ids].filter((id) => (getNode(id)?.tier ?? 0) >= 1).length >= 2;
    }
    setBuildingStatus(b.id, ready ? "playable" : b.status === "stale" ? "stale" : "detected");
  }
}

function orderedSteps(worldId: string): string[] {
  const { nodes, edges } = getGraph(worldId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const formal = edges.filter((e) => e.kind === "formal" || e.kind === "source");
  const depth = new Map<string, number>();
  const roots = nodes.filter((n) => !formal.some((e) => e.dst === n.id));
  const queue = roots.map((r) => ({ id: r.id, d: 0 }));
  while (queue.length) {
    const cur = queue.shift()!;
    if (depth.has(cur.id)) continue;
    depth.set(cur.id, cur.d);
    for (const e of formal.filter((x) => x.src === cur.id)) {
      if (!depth.has(e.dst)) queue.push({ id: e.dst, d: cur.d + 1 });
    }
  }
  return [...depth.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => byId.get(id)?.name ?? "")
    .filter(Boolean);
}
