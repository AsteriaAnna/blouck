import type { EdgeRow, NodeRow } from "./db.js";

/**
 * 副本发现与校验（v2）
 *
 * 原则：AI/规则只负责"提出候选"，这里做硬校验；
 * 流程：3–6 步、每对相邻有过程证据、唯一线性顺序、无环、每步存在且可见、confidence 达标；
 * 领域：4–8 个成员、有共同上位/共同来源、命名合法、与已有领域重叠不超限。
 */

const PROCESS_CUE = /(先|首先|再|然后|接着|之后|最后|第一步|第二步|下一步|交给|再进入|再交给)/;
const GENERIC_DOMAIN = new Set(["AI", "技术", "知识", "领域", "系统", "方法", "流程", "概念"]);

export type DungeonNode = { id: string; name: string; hidden?: number };
export type DungeonEdge = { src: string; dst: string; kind: string; label?: string; predicate?: string };

export type FlowCandidate = {
  processName: string;
  steps: { id: string; name: string }[];
  /** 先后约束：before 必须在 after 之前；evidence 为原文证据 */
  precedence: { before: string; after: string; evidence: string }[];
  confidence: number;
  origin?: "ai" | "rule";
};

export type DomainCandidate = {
  domainName: string;
  members: { id: string; name: string }[];
  commonParent?: string;
  sharedSpanIds?: string[];
  confidence: number;
  origin?: "ai" | "rule";
};

export type ValidationResult = { ok: boolean; errors: string[]; order?: string[] };

/** 枚举线性扩展：只关心 0 / 1 / >1 */
export function countLinearExtensions(
  ids: string[],
  constraints: { before: string; after: string }[],
): { count: number; first: string[] } {
  const n = ids.length;
  if (n > 7) return { count: 0, first: [] };
  const idx = new Map(ids.map((id, i) => [id, i]));
  const cons = constraints
    .filter((c) => idx.has(c.before) && idx.has(c.after) && c.before !== c.after)
    .map((c) => ({ b: idx.get(c.before)!, a: idx.get(c.after)! }));
  let count = 0;
  let first: string[] = [];
  const used = new Array(n).fill(false);
  const seq: number[] = [];
  const dfs = () => {
    if (count >= 2) return;
    if (seq.length === n) {
      count++;
      if (count === 1) first = seq.map((i) => ids[i]);
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      if (cons.some((c) => c.a === i && !used[c.b])) continue;
      used[i] = true;
      seq.push(i);
      dfs();
      seq.pop();
      used[i] = false;
    }
  };
  dfs();
  return { count, first };
}

/** 流程候选硬校验 */
export function validateFlowCandidate(
  nodes: DungeonNode[],
  candidate: FlowCandidate,
  opts: { minSteps?: number; maxSteps?: number; minConfidence?: number; requireCue?: boolean } = {},
): ValidationResult {
  const minSteps = opts.minSteps ?? 3;
  const maxSteps = opts.maxSteps ?? 6;
  const minConfidence = opts.minConfidence ?? 0.75;
  const requireCue = opts.requireCue ?? true;
  const errors: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const stepIds = candidate.steps.map((s) => s.id);
  const uniqueIds = new Set(stepIds);

  if (uniqueIds.size !== stepIds.length) errors.push("步骤存在重复");
  if (stepIds.length < minSteps || stepIds.length > maxSteps) {
    errors.push(`步骤数 ${stepIds.length} 不在 ${minSteps}–${maxSteps}`);
  }
  for (const id of stepIds) {
    const node = byId.get(id);
    if (!node) errors.push(`步骤节点不存在：${id}`);
    else if (node.hidden) errors.push(`步骤节点被隐藏：${node.name}`);
  }
  if (candidate.confidence < minConfidence) errors.push(`confidence ${candidate.confidence} < ${minConfidence}`);
  if (!candidate.processName || candidate.processName.length < 2 || candidate.processName.length > 16) {
    errors.push("流程名不合法");
  }

  const prec = candidate.precedence ?? [];
  if (prec.length < stepIds.length - 1) errors.push("先后约束不足，无法确定唯一顺序");
  for (const p of prec) {
    if (!uniqueIds.has(p.before) || !uniqueIds.has(p.after)) errors.push("先后约束引用未知步骤");
    if (p.before === p.after) errors.push("先后约束自环");
    if (!p.evidence || p.evidence.trim().length < 4) errors.push("缺失证据句");
    if (requireCue && p.evidence && !PROCESS_CUE.test(p.evidence)) {
      errors.push(`证据缺少过程词：${p.evidence.slice(0, 20)}`);
    }
  }

  const { count, first } = countLinearExtensions(stepIds, prec);
  if (count === 0) errors.push("先后约束有环或无解");
  if (count > 1) errors.push("存在多种合理顺序（唯一性不满足）");

  return { ok: errors.length === 0, errors: [...new Set(errors)], order: count === 1 ? first : undefined };
}

/** 领域候选硬校验；existingMembers 用于重叠控制 */
export function validateDomainCandidate(
  nodes: DungeonNode[],
  edges: DungeonEdge[],
  candidate: DomainCandidate,
  existingMembers: string[][] = [],
  opts: { minMembers?: number; maxMembers?: number; minConfidence?: number; maxOverlap?: number } = {},
): ValidationResult {
  const minMembers = opts.minMembers ?? 4;
  const maxMembers = opts.maxMembers ?? 8;
  const minConfidence = opts.minConfidence ?? 0.7;
  const maxOverlap = opts.maxOverlap ?? 0.5;
  const errors: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memberIds = candidate.members.map((m) => m.id);
  const memberSet = new Set(memberIds);

  if (memberSet.size !== memberIds.length) errors.push("成员重复");
  if (memberIds.length < minMembers || memberIds.length > maxMembers) {
    errors.push(`成员数 ${memberIds.length} 不在 ${minMembers}–${maxMembers}`);
  }
  for (const id of memberIds) {
    const node = byId.get(id);
    if (!node) errors.push(`成员不存在：${id}`);
    else if (node.hidden) errors.push(`成员被隐藏：${node.name}`);
  }
  if (candidate.confidence < minConfidence) errors.push(`confidence ${candidate.confidence} < ${minConfidence}`);

  const name = candidate.domainName?.trim() ?? "";
  if (name.length < 2 || name.length > 12) errors.push("领域名长度不合法");
  if (GENERIC_DOMAIN.has(name)) errors.push("领域名过于泛化");
  if (candidate.members.some((m) => m.name === name)) errors.push("领域名不能是成员名");
  if (name.endsWith("领域") && name.length <= 4) errors.push("领域名过于泛化");

  // 共同依据：kindOf 同父（成员→上位）或共享来源片段；不能只是“连在同一个节点上”
  let basis = false;
  if (candidate.commonParent) {
    const kindOf = edges.filter(
      (e) =>
        (e.predicate === "kindOf" ||
          (e.predicate == null && /kindof|归类/i.test(e.label ?? ""))) &&
        memberSet.has(e.src) &&
        e.dst === candidate.commonParent,
    );
    if (kindOf.length >= Math.ceil(memberIds.length * 0.75)) basis = true;
  }
  if (!basis && candidate.sharedSpanIds && candidate.sharedSpanIds.length > 0) basis = true;
  if (!basis) errors.push("缺少共同上位概念（kindOf）或共同来源；仅仅是共同邻居不算领域");

  for (const existing of existingMembers) {
    const other = new Set(existing);
    const inter = memberIds.filter((id) => other.has(id)).length;
    const union = new Set([...memberIds, ...existing]).size;
    if (union && inter / union > maxOverlap) errors.push("与已有领域副本重叠过高");
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

/** 规则候选发现：从带过程词的 formal 边找弱连通分量（等关系 v2 后换成 LLM 候选） */
export function detectFlowCandidates(nodes: DungeonNode[], edges: DungeonEdge[]): FlowCandidate[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const usable = edges.filter(
    (e) => e.kind === "formal" && e.label && PROCESS_CUE.test(e.label) && byId.has(e.src) && byId.has(e.dst),
  );
  if (!usable.length) return [];

  // 弱连通分量
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };
  for (const e of usable) {
    if (!parent.has(e.src)) parent.set(e.src, e.src);
    if (!parent.has(e.dst)) parent.set(e.dst, e.dst);
    union(e.src, e.dst);
  }
  const groups = new Map<string, { nodes: Set<string>; edges: DungeonEdge[] }>();
  for (const e of usable) {
    const root = find(e.src);
    const g = groups.get(root) ?? { nodes: new Set<string>(), edges: [] };
    g.nodes.add(e.src);
    g.nodes.add(e.dst);
    g.edges.push(e);
    groups.set(root, g);
  }

  const out: FlowCandidate[] = [];
  for (const [, g] of groups) {
    if (g.nodes.size < 3 || g.nodes.size > 6) continue;
    const steps = [...g.nodes].map((id) => ({ id, name: byId.get(id)!.name }));
    out.push({
      processName: `${steps[0].name}流程`.slice(0, 16),
      steps,
      precedence: g.edges.map((e) => ({
        before: e.src,
        after: e.dst,
        evidence: e.label ?? "",
      })),
      confidence: 0.78,
      origin: "rule",
    });
  }
  return out;
}

/** 规则候选发现：锚点 + 形式邻居（等关系 v2 后换成 LLM 候选） */
export function detectDomainCandidates(
  nodes: DungeonNode[],
  edges: DungeonEdge[],
  existing: string[][] = [],
): DomainCandidate[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: DomainCandidate[] = [];
  const seen = new Set<string>();

  // 领域 = 同一上位概念（kindOf）下的一组概念：成员 --归类--> 上位
  const groups = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.kind !== "formal") continue;
    const isKindOf =
      e.predicate === "kindOf" || (e.predicate == null && /kindof|归类/i.test(e.label ?? ""));
    if (!isKindOf) continue;
    const parent = e.dst;
    const member = e.src;
    if (!byId.has(parent) || !byId.has(member)) continue;
    const set = groups.get(parent) ?? new Set<string>();
    set.add(member);
    groups.set(parent, set);
  }

  for (const [parentId, memberSet] of groups) {
    const parent = byId.get(parentId);
    if (!parent || parent.hidden) continue;
    const list = [...memberSet].filter((id) => byId.has(id) && !byId.get(id)!.hidden);
    if (list.length < 4 || list.length > 8) continue;
    const key = list.sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      domainName: parent.name.slice(0, 12),
      members: list.map((id) => ({ id, name: byId.get(id)!.name })),
      commonParent: parentId,
      confidence: 0.78,
      origin: "rule",
    });
    void existing;
  }
  return out;
}

/** 从 EdgeRow[] 适配 */
export function toDungeonEdges(edges: EdgeRow[]): DungeonEdge[] {
  return edges.map((e) => ({
    src: e.src,
    dst: e.dst,
    kind: e.kind,
    label: e.label,
    predicate: e.predicate ?? undefined,
  }));
}

export function toDungeonNodes(nodes: NodeRow[]): DungeonNode[] {
  return nodes.map((n) => ({ id: n.id, name: n.name, hidden: n.hidden }));
}
