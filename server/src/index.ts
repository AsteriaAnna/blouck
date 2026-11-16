import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { env, providers } from "./env.js";
import {
  addDirection,
  addEdge,
  computeFrontier,
  createSourceSpan,
  addNode,
  countPassed,
  computeTier,
  createBuilding,
  createDomainQuestions,
  createQuizzes,
  createWorld,
  db,
  deleteWorld,
  getBuilding,
  getGraph,
  getNode,
  getWorld,
  listBuildings,
  listDomainQuestions,
  listDirections,
  listQuizzes,
  listWorlds,
  recordAttempt,
  refreshBuildingStatus,
  seedDemoIfEmpty,
  setBuildingStatus,
  setNodeHidden,
  setNodePosition,
  updateEdgeMd,
  updateBuildingMd,
  updateEdgeKind,
  updateNodeMd,
  updateNodeMeta,
  type BuildingRow,
  type EdgeKind,
  type NodeRow,
} from "./db.js";
import { deepseekLLM } from "./providers/deepseek.js";
import { doubaoASR } from "./providers/doubao.js";
import { mockASR, mockLLM } from "./providers/mock.js";
import { elkLayout, wfcLayout } from "./layout.js";
import { placeAround } from "./placement.js";
import { simulateExplore } from "./explore.js";
import { runAnchorFirst } from "./anchorFirst.js";
import { ingestSegment, commitStream } from "./stream/session.js";
import { wfcGraphLayout } from "./wfc.js";
import {
  detectDomainCandidates,
  detectFlowCandidates,
  toDungeonEdges,
  toDungeonNodes,
  validateDomainCandidate,
  validateFlowCandidate,
} from "./dungeons.js";
import {
  applyHide,
  bumpDomainDaily,
  consumeDirection,
  ensureBuildingPositions,
  ensureDirectionFrontiers,
  exportWorld,
  hidePreview,
  setBuildingPosition,
  undoLastHide,
} from "./assetops.js";

seedDemoIfEmpty();

/** 把 frontier 节点的方向数据物化成可点击的方向线（每节点最多 2 条） */
function materializeDirectionEdges(worldId: string) {
  // 非边缘节点的方向线不再保留（方向数据仍在 directions 表，节点 MD 可看）
  db.prepare(
    "DELETE FROM edges WHERE world_id=? AND kind='direction' AND src IN (SELECT id FROM nodes WHERE world_id=? AND frontier=0)",
  ).run(worldId, worldId);
  const graph = getGraph(worldId);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const existing = new Set(
    graph.edges
      .filter((e) => e.kind === "direction")
      .map((e) => `${e.src}|${e.question ?? ""}`),
  );
  const count = new Map<string, number>();
  for (const d of listDirections(worldId)) {
    if (d.status !== "open") continue;
    const node = byId.get(d.node_id);
    if (!node || !node.frontier || node.hidden) continue;
    const used = count.get(node.id) ?? 0;
    if (used >= 2) continue;
    const key = `${node.id}|${d.question}`;
    if (existing.has(key)) {
      count.set(node.id, used + 1);
      continue;
    }
    addEdge(worldId, node.id, node.id, "direction", "", d.question, "", {
      evidence: d.reason,
      confidence: 0.6,
      origin: "direction",
    });
    existing.add(key);
    count.set(node.id, used + 1);
  }
}

const llm = env.deepseekApiKey ? deepseekLLM : mockLLM;
const asr = env.doubaoAppId && env.doubaoToken ? doubaoASR : mockASR;

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    providers: { ...providers, llmActive: llm.name, asrActive: asr.name },
    hint: "未配置 key 时使用 mock；配置 DEEPSEEK_API_KEY / DOUBAO_ASR_* 后自动切换",
  });
});

app.get("/api/worlds", (_req, res) => {
  res.json({ worlds: listWorlds() });
});

app.post("/api/worlds", (req, res) => {
  const { name, rootName } = req.body ?? {};
  if (!name || !rootName) {
    return res.status(400).json({ error: "需要世界名与初始节点名" });
  }
  const world = createWorld(String(name), String(rootName));
  res.json({ world });
});

app.delete("/api/worlds/:id", (req, res) => {
  deleteWorld(req.params.id);
  res.json({ ok: true });
});

app.get("/api/worlds/:id", (req, res) => {
  const world = getWorld(req.params.id);
  if (!world) return res.status(404).json({ error: "world not found" });
  ensureBuildingPositions(world.id);
  ensureDirectionFrontiers(world.id);
  const graph = getGraph(world.id);
  const buildings = listBuildings(world.id);
  const nodes = graph.nodes.map((n) => ({
    ...n,
    passed: countPassed(n.id),
    tier: computeTier(n.id),
  }));
  res.json({ world, nodes, edges: graph.edges, buildings, directions: listDirections(world.id) });
});

/** 节点名只去掉首尾空白；“是不是一个概念”由抽取阶段的过程/步骤区分决定，不再做字符串补后缀 */
function normalizeConceptName(raw: string): { name: string; aliases: string[] } {
  return { name: raw.trim(), aliases: [] };
}

/** 语音/文字 → 概念/关系/方向 → 落图（关系与节点 v2） */
app.post("/api/worlds/:id/extract", async (req, res) => {
  const world = getWorld(req.params.id);
  if (!world) return res.status(404).json({ error: "world not found" });
  const text = String(req.body?.text ?? "").trim();
  const fromNodeId = String(req.body?.fromNodeId ?? world.root_node_id);
  if (!text) return res.status(400).json({ error: "text required" });
  const focus = getNode(fromNodeId) ?? getNode(world.root_node_id);
  if (!focus) return res.status(400).json({ error: "focus node missing" });

  const span = createSourceSpan(world.id, text);
  const graph = getGraph(world.id);
  const existing = graph.nodes.map((n) => n.name);
  const result = await llm.extract({ text, focus, existing });

  const norm = (v: string) =>
    v
      .toLowerCase()
      .replace(/[\s\-_·、，。,.；;：:（）()【】\[\]《》"'“”]/g, "")
      .trim();
  const aliasesOf = (n: NodeRow): string[] => {
    try {
      return JSON.parse(n.aliases || "[]") as string[];
    } catch {
      return [];
    }
  };
  const findExisting = (raw: string | undefined) => {
    const key = norm(raw ?? "");
    if (!key) return undefined;
    return graph.nodes.find(
      (n) => norm(n.name) === key || aliasesOf(n).some((a) => norm(a) === key),
    );
  };
  const sentenceFor = (term: string) =>
    text
      .split(/[。！？!?；;]/)
      .map((s) => s.trim())
      .find((s) => s.includes(term)) ?? "";

  const NODE_TYPES = new Set(["概念", "方法", "组件", "指标", "工具"]);
  const BAD_NAME =
    /^(这个|那个|它|我们|然后|可以|就是|什么|怎么|为什么|如何|是否)|[?？]$/;
  const createdNodes: NodeRow[] = [];
  const createdEdges: unknown[] = [];
  const sourceSpanId = span.id;
  const placed = graph.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));

  // 过程步骤只属于流程副本，不建节点
  const processStepNames = new Set(
    (result.processes ?? []).flatMap((p) => p.steps.map((x) => norm(x))),
  );

  for (const ent of result.entities) {
    const rawName = ent.name?.trim() ?? "";
    if (!rawName || rawName.length < 2 || rawName.length > 20) continue;
    if (BAD_NAME.test(rawName)) continue;
    const normalized = normalizeConceptName(rawName);
    const name = normalized.name;
    if (processStepNames.has(norm(rawName)) && !findExisting(rawName)) continue;
    let evidence = ent.evidence?.trim() ?? "";
    if (evidence && !text.includes(evidence)) evidence = "";
    if (!evidence) evidence = sentenceFor(name);
    if (!evidence) continue; // 原文没有的概念不落图
    const confidence = typeof ent.confidence === "number" ? ent.confidence : 0.7;
    if (confidence < 0.6) continue;
    const type = NODE_TYPES.has(ent.type ?? "") ? ent.type! : "概念";

    const existingNode = findExisting(name);
    if (existingNode) {
      updateNodeMeta(existingNode.id, {
        type: NODE_TYPES.has(existingNode.type) ? existingNode.type : type,
        definition: existingNode.definition || ent.definition || "",
        aliases: [
          ...new Set([...aliasesOf(existingNode), ...(ent.aliases ?? []), ...normalized.aliases, rawName]),
        ],
        sourceSpanId: existingNode.source_span_id ?? sourceSpanId,
      });
      continue;
    }

    const pos = placeAround(
      placed,
      { id: focus.id, x: focus.x, y: focus.y },
      { preferAngle: (placed.length * 1.7) % (Math.PI * 2) },
    );
    const node = addNode(world.id, name, pos.x, pos.y, "", {
      type,
      definition: ent.definition ?? "",
      aliases: [...new Set([...(ent.aliases ?? []), ...normalized.aliases])],
      sourceSpanId,
    });
    createdNodes.push(node);
    graph.nodes.push(node);
    placed.push({ id: node.id, x: pos.x, y: pos.y });
  }

  const PREDICATES = new Set([
    "kindOf",
    "partOf",
    "prerequisite",
    "contrast",
    "alternative",
    "related",
  ]);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const edgeExists = (src: string, dst: string, kind: string, predicate: string | null) =>
    graph.edges.some(
      (e) =>
        e.src === src && e.dst === dst && e.kind === kind && (e.predicate ?? null) === predicate,
    );

  for (const rel of result.relations) {
    const target = findExisting(rel.target);
    if (!target) continue;
    const source = (rel.source && findExisting(rel.source)) || focus;
    let evidence = rel.evidence?.trim() ?? "";
    if (evidence && !text.includes(evidence)) evidence = "";
    if (!evidence) evidence = sentenceFor(target.name);
    const confidence = clamp(typeof rel.confidence === "number" ? rel.confidence : 0.7);

    if (rel.type === "source") {
      if (source.id !== target.id && !edgeExists(source.id, target.id, "source", null)) {
        const e = addEdge(world.id, source.id, target.id, "source", rel.label || "探索来源", null, "", {
          evidence,
          confidence,
          origin: "auto",
        });
        createdEdges.push(e);
        graph.edges.push(e);
      }
      continue;
    }

    if (rel.type === "direction" || rel.question) {
      const question = rel.question?.trim() || `「${target.name}」的下一步还可以探索什么？`;
      if (question.length < 8) continue;
      addDirection(world.id, source.id, question, evidence, target.name);
      const e = addEdge(world.id, source.id, source.id, "direction", "", question, "", {
        evidence,
        confidence,
        origin: "auto",
      });
      createdEdges.push(e);
      graph.edges.push(e);
      continue;
    }

    if (source.id === target.id) continue;
    const predicate = PREDICATES.has(rel.predicate ?? "") ? rel.predicate! : "related";
    let kind: "formal" | "suggest" = rel.type === "suggest" ? "suggest" : "formal";
    if (kind === "formal" && (!evidence || confidence < 0.75)) kind = "suggest";
    // 证据充分时，模型标成 suggest 也升级为正式（由证据+置信度决定线型）
    if (kind === "suggest" && evidence && confidence >= 0.75 && predicate !== "related") {
      kind = "formal";
    }
    if (kind === "suggest" && confidence < 0.5) continue;

    // 谓词方向归一：前置按证据中出现的先后；组成把“整体→部分”换成“部分→整体”
    let srcId = source.id;
    let dstId = target.id;
    const si = evidence ? evidence.indexOf(source.name) : -1;
    const ti = evidence ? evidence.indexOf(target.name) : -1;
    if (predicate === "prerequisite" && si >= 0 && ti >= 0 && si > ti) {
      [srcId, dstId] = [dstId, srcId];
    }
    const partLabel = rel.label ?? "";
    if (predicate === "partOf" && /组成|包含|由/.test(partLabel) && !/属于/.test(partLabel)) {
      [srcId, dstId] = [dstId, srcId];
    }
    if (srcId === dstId) continue;
    if (edgeExists(srcId, dstId, kind, predicate)) continue;
    const e = addEdge(world.id, srcId, dstId, kind, rel.label || predicate, null, "", {
      predicate,
      evidence,
      confidence,
      origin: "auto",
    });
    createdEdges.push(e);
    graph.edges.push(e);
  }

  // 过程/工作流：只抽“过程本身”作为节点；步骤进入流程副本，不建节点
  const createdProcesses: { name: string; steps: string[]; buildingId?: string }[] = [];
  for (const proc of result.processes ?? []) {
    const steps = [...new Set(proc.steps.map((x) => x.trim()).filter(Boolean))];
    if (steps.length < 3 || steps.length > 6) continue;
    let procName = proc.name.trim();
    if (!procName || procName === focus.name || /^(工作流|流程|系统|体系)$/.test(procName)) {
      procName = `${focus.name}工作流`;
    }
    if (procName.length > 20) procName = procName.slice(0, 20);
    const stepNames = steps.map((x) => norm(x));
    let procNode = findExisting(procName);
    if (!procNode) {
      const pos = placeAround(
        placed,
        { id: focus.id, x: focus.x, y: focus.y },
        { preferAngle: (placed.length * 1.7) % (Math.PI * 2) },
      );
      procNode = addNode(world.id, procName, pos.x, pos.y, "", {
        type: "概念",
        definition: `过程：${steps.join(" → ")}`,
        sourceSpanId,
      });
      createdNodes.push(procNode);
      graph.nodes.push(procNode);
      placed.push({ id: procNode.id, x: pos.x, y: pos.y });
    }
    const fingerprint = steps.slice().sort().join("|");
    const exists = listBuildings(world.id).some(
      (b) => b.kind === "flow" && b.fingerprint === fingerprint,
    );
    if (exists) continue;
    const building = createBuilding(
      world.id,
      "flow",
      procNode.id,
      procName,
      `流程排序 · ${steps.length} 步`,
      `## 流程副本\n\n过程：**${procName}**\n\n步骤：${steps
        .map((x, i) => `${i + 1}. ${x}`)
        .join("\n")}\n\n依据：${(proc.evidence ?? []).join("；") || "来源片段"}`,
      steps,
    );
    createdProcesses.push({ name: procName, steps, buildingId: building.id });
    ensureBuildingPositions(world.id);
    refreshAllBuildingStatus(world.id);
    // 过程节点至少有一条来源边
    if (!edgeExists(focus.id, procNode.id, "source", null) && procNode.id !== focus.id) {
      const e = addEdge(world.id, focus.id, procNode.id, "source", "本轮探索来源", null, "", {
        evidence: proc.evidence?.[0] ?? sentenceFor(procName),
        confidence: 0.9,
        origin: "auto",
      });
      createdEdges.push(e);
      graph.edges.push(e);
    }
  }

  // 每个新节点都必须有探索来路（孤岛禁令）
  for (const n of createdNodes) {
    if (!edgeExists(focus.id, n.id, "source", null) && n.id !== focus.id) {
      const e = addEdge(world.id, focus.id, n.id, "source", "本轮探索来源", null, "", {
        evidence: sentenceFor(n.name),
        confidence: 0.9,
        origin: "auto",
      });
      createdEdges.push(e);
      graph.edges.push(e);
    }
  }

  // 每个节点至少一条方向（数据层）；优先用 LLM，失败再模板兜底
  const dirTargets = [focus, ...createdNodes];
  const haveDirection = new Set(listDirections(world.id).map((d) => d.node_id));
  const pending = dirTargets.filter((n) => !haveDirection.has(n.id));
  if (pending.length) {
    try {
      const suggestions = await llm.suggestDirections({
        nodes: pending.map((n) => ({
          name: n.name,
          definition: n.definition,
          evidence: sentenceFor(n.name),
          neighbors: graph.edges
            .filter((e) => e.src === n.id || e.dst === n.id)
            .map((e) => graph.nodes.find((x) => x.id === (e.src === n.id ? e.dst : e.src))?.name ?? "")
            .filter(Boolean)
            .slice(0, 6),
        })),
      });
      for (const sug of suggestions) {
        const n = pending.find((x) => x.name === sug.node);
        if (!n || haveDirection.has(n.id)) continue;
        addDirection(world.id, n.id, sug.question, sug.reason, null);
        haveDirection.add(n.id);
      }
    } catch (err) {
      console.warn("[extract] 方向生成失败，使用模板：", err);
    }
  }
  for (const n of pending) {
    if (haveDirection.has(n.id)) continue;
    addDirection(world.id, n.id, `「${n.name}」还可以往哪一步深入？`, `围绕「${n.name}」的下一步`, null);
  }

  // 新节点自动生成题库（后台，最多 3 个，避免一次刷太多模型调用）
  for (const n of createdNodes.slice(0, 3)) {
    if (listQuizzes(n.id).length) continue;
    const material = `定义：${n.definition || "（暂无）"}\n来源：${sentenceFor(n.name)}\n笔记：${n.free_md}`;
    void llm
      .generateQuiz({ name: n.name, md: material })
      .then((items) => {
        if (!listQuizzes(n.id).length) createQuizzes(n.id, items.slice(0, 15));
      })
      .catch((err) => console.warn("[quiz] 自动生成失败：", err));
  }

  computeFrontier(world.id);
  refreshStaleBuildings(world.id);
  await detectBuildingsLLM(world.id, focus);
  materializeDirectionEdges(world.id);
  detectBuildingsV2(world.id, focus, graph.nodes);
  ensureDirectionFrontiers(world.id);
  const fresh = getGraph(world.id);
  const buildings = listBuildings(world.id);
  res.json({
    createdNodes,
    createdEdges,
    nodes: fresh.nodes.map((n) => ({
      ...n,
      passed: countPassed(n.id),
      tier: computeTier(n.id),
    })),
    edges: fresh.edges,
    buildings,
    directions: listDirections(world.id),
    processes: createdProcesses,
    provider: llm.name,
  });
});

/** 副本候选检测（MVP 简化规则；真实实现由模型在后端任务里判定） */
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

/**
 * 副本生成 v2：AI/规则只提候选，这里用硬校验（流程唯一序、每步来源、领域共同依据）。
 * 规则细节见 docs/design/dungeon-generation-rules.md。
 */
function detectBuildingsV2(worldId: string, _focus: NodeRow, _all: NodeRow[]) {
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
async function detectBuildingsLLM(worldId: string, focus: NodeRow) {
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
function refreshStaleBuildings(worldId: string) {
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
function refreshAllBuildingStatus(worldId: string) {
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

app.patch("/api/nodes/:id", (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: "node not found" });
  if (typeof req.body?.freeMd === "string") updateNodeMd(node.id, req.body.freeMd);
  if (typeof req.body?.hidden === "boolean") {
    setNodeHidden(node.id, req.body.hidden ? 1 : 0);
  }
  res.json({ ok: true });
});

app.get("/api/nodes/:id/quiz", async (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: "node not found" });
  let quizzes = listQuizzes(node.id);
  if (!quizzes.length) {
    try {
      const items = await llm.generateQuiz({
        name: node.name,
        md: `定义：${node.definition}\n笔记：${node.free_md}`,
      });
      createQuizzes(node.id, items.slice(0, 15));
      quizzes = listQuizzes(node.id);
    } catch (err) {
      console.warn("[quiz] 打开节点时生成失败：", err);
    }
  }
  res.json({
    quizzes: quizzes.map(({ answer, ...q }) => q),
    passed: countPassed(node.id),
    tier: computeTier(node.id),
    status: quizzes.length ? "ready" : "idle",
  });
});

app.post("/api/nodes/:id/quiz/generate", async (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: "node not found" });
  if (!listQuizzes(node.id).length) {
    const items = await llm.generateQuiz({
      name: node.name,
      md: `定义：${node.definition || "（暂无）"}\n笔记：${node.free_md}`,
    });
    createQuizzes(node.id, items);
  }
  res.json({
    quizzes: listQuizzes(node.id).map(({ answer, ...q }) => q),
    passed: countPassed(node.id),
    tier: computeTier(node.id),
    provider: llm.name,
  });
});

app.post("/api/quiz/:id/answer", async (req, res) => {
  const quiz = db.prepare("SELECT * FROM quizzes WHERE id=?").get(req.params.id) as
    | { id: string; node_id: string; prompt: string; answer: string }
    | undefined;
  if (!quiz) return res.status(404).json({ error: "quiz not found" });
  const answer = String(req.body?.answer ?? "");
  const judged = await llm.judge({
    prompt: quiz.prompt,
    answer,
    reference: quiz.answer,
  });
  const result = recordAttempt(quiz.id, judged.correct);
  res.json({
    correct: judged.correct,
    feedback: judged.feedback,
    tier: result?.tier ?? 0,
    passed: countPassed(quiz.node_id),
  });
});

app.post("/api/edges/:id/accept", async (req, res) => {
  const edge = db.prepare("SELECT * FROM edges WHERE id=?").get(req.params.id) as
    | { id: string; kind: string; src: string; dst: string; label: string; evidence: string; predicate: string | null }
    | undefined;
  if (!edge) return res.status(404).json({ error: "edge not found" });
  if (edge.kind !== "suggest") return res.status(400).json({ error: "只能接受虚线建议" });
  const a = getNode(edge.src);
  const b = getNode(edge.dst);
  if (a && b) {
    const suggestion = await llm.suggestRelation({
      a: { name: a.name, definition: a.definition, md: a.free_md },
      b: { name: b.name, definition: b.definition, md: b.free_md },
      evidence: edge.evidence,
    });
    updateEdgeKind(edge.id, "formal");
    db.prepare("UPDATE edges SET label=?, md=?, predicate=?, evidence=? WHERE id=?").run(
      suggestion.label,
      suggestion.md,
      suggestion.predicate,
      edge.evidence || suggestion.md,
      edge.id,
    );
  } else {
    updateEdgeKind(edge.id, "formal");
  }
  res.json({ ok: true, edge: db.prepare("SELECT * FROM edges WHERE id=?").get(edge.id) });
});

/** 用户手动连线：两个已有概念之间建立正式关系（AI 给谓词/名称/说明） */
app.post("/api/worlds/:id/relations", async (req, res) => {
  const world = getWorld(req.params.id);
  if (!world) return res.status(404).json({ error: "world not found" });
  const from = getNode(String(req.body?.fromNodeId ?? ""));
  const to = getNode(String(req.body?.toNodeId ?? ""));
  if (!from || !to) return res.status(400).json({ error: "两个节点都必须存在" });
  if (from.id === to.id) return res.status(400).json({ error: "不能连接同一个节点" });
  if (from.world_id !== world.id || to.world_id !== world.id)
    return res.status(400).json({ error: "节点不属于当前世界" });
  const evidence = String(req.body?.evidence ?? "").slice(0, 500);
  let predicate = String(req.body?.predicate ?? "");
  let label = String(req.body?.label ?? "").trim();
  let md = String(req.body?.md ?? "").trim();
  const allowed = ["kindOf", "partOf", "prerequisite", "contrast", "alternative", "related"];
  if (!allowed.includes(predicate) || !label) {
    const suggestion = await llm.suggestRelation({
      a: { name: from.name, definition: from.definition, md: from.free_md },
      b: { name: to.name, definition: to.definition, md: to.free_md },
      evidence,
    });
    predicate = allowed.includes(predicate) ? predicate : suggestion.predicate;
    label = label || suggestion.label;
    md = md || suggestion.md;
  }
  const dup = db
    .prepare("SELECT id FROM edges WHERE world_id=? AND src=? AND dst=? AND predicate=? AND kind='formal'")
    .get(world.id, from.id, to.id, predicate) as { id: string } | undefined;
  if (dup) return res.status(409).json({ error: "这两个概念之间已有同类正式关系" });
  const edge = addEdge(world.id, from.id, to.id, "formal", label, null, md, {
    predicate,
    evidence,
    confidence: 0.9,
    origin: "manual",
  });
  computeFrontier(world.id);
  materializeDirectionEdges(world.id);
  res.json({ ok: true, edge });
});

/* ---------------- 关系编辑 / WFC 布局 ---------------- */
app.patch("/api/edges/:id", (req, res) => {
  const edge = db.prepare("SELECT * FROM edges WHERE id=?").get(req.params.id) as
    | { id: string; md: string; label: string }
    | undefined;
  if (!edge) return res.status(404).json({ error: "edge not found" });
  const md = typeof req.body?.md === "string" ? req.body.md : edge.md;
  const label = typeof req.body?.label === "string" ? req.body.label : undefined;
  updateEdgeMd(edge.id, md, label);
  res.json({ ok: true });
});

app.post("/api/worlds/:id/layout", async (req, res) => {
  const world = getWorld(req.params.id);
  if (!world) return res.status(404).json({ error: "world not found" });
  const { nodes, edges } = getGraph(world.id);
  const preferred = String(req.body?.engine ?? "wfc");
  let placed;
  let engine = preferred;
  try {
    placed = preferred === "elk" ? await elkLayout(nodes, edges) : wfcGraphLayout(nodes, edges);
  } catch (err) {
    console.warn(`[layout] ${preferred} 失败，回退另一种`, err);
    engine = preferred === "elk" ? "wfc" : "elk";
    placed = engine === "elk" ? await elkLayout(nodes, edges) : wfcGraphLayout(nodes, edges);
  }
  for (const p of placed) setNodePosition(p.id, p.x, p.y);
  ensureBuildingPositions(world.id);
  ensureDirectionFrontiers(world.id);
  refreshAllBuildingStatus(world.id);
  const fresh = getGraph(world.id);
  res.json({
    ok: true,
    engine,
    nodes: fresh.nodes.map((n) => ({
      ...n,
      passed: countPassed(n.id),
      tier: computeTier(n.id),
    })),
  });
});

/** 压测：生成一个 N 节点世界，用于检查布局是否重叠 */
app.post("/api/dev/world", (req, res) => {
  const n = Math.max(5, Math.min(60, Number(req.body?.n ?? 30)));
  const world = createWorld(String(req.body?.name ?? `${n} 节点压测`), "N0");
  const ids: string[] = [world.root_node_id];
  for (let i = 1; i < n; i++) ids.push(addNode(world.id, `N${i}`, 0, 0).id);
  for (let i = 0; i < n - 1; i++) {
    addEdge(world.id, ids[i], ids[i + 1], i % 7 === 0 ? "source" : "formal", `step ${i}`);
  }
  for (let k = 0; k < Math.floor(n * 0.6); k++) {
    const a = ids[Math.floor(Math.random() * n)];
    const b = ids[Math.floor(Math.random() * n)];
    if (a === b) continue;
    addEdge(world.id, a, b, "suggest", "可能关联");
  }
  res.json({ ok: true, world });
});

/** 探索模拟（增量放置版）：新节点围绕焦点现场算位置，不做全局重排 */
app.post("/api/dev/explore", async (req, res) => {
  const rounds = Math.max(6, Math.min(60, Number(req.body?.rounds ?? 24)));
  const result = await simulateExplore(rounds, detectBuildingsV2);
  ensureBuildingPositions(result.world.id);
  ensureDirectionFrontiers(result.world.id);
  res.json(result);
});

/** 旧版探索模拟（保留占位） */
app.post("/api/dev/explore", async (req, res) => {
  const rounds = Math.max(6, Math.min(60, Number(req.body?.rounds ?? 24)));
  const world = createWorld(`探索模拟 · ${rounds} 轮`, "起点");
  const ids: string[] = [world.root_node_id];
  const frontier: string[] = [world.root_node_id];
  const vocab = [
    "检索", "重排", "评测", "记忆", "工具调用", "多模态", "推理", "规划",
    "幻觉", "上下文窗口", "向量库", "索引", "分块", "微调", "对齐", "蒸馏",
    "Agent", "工作流", "提示词", "召回", "精排", "生成", "事实性", "延迟",
  ];
  let mi = 0;
  for (let r = 0; r < rounds; r++) {
    const focus = frontier.length ? frontier.shift()! : ids[Math.floor(Math.random() * ids.length)];
    const k = 1 + (r % 2);
    for (let j = 0; j < k; j++) {
      const name = vocab[mi % vocab.length] + (mi >= vocab.length ? `·${mi}` : "");
      mi++;
      const node = addNode(world.id, name, 0, 0);
      ids.push(node.id);
      // 探索来源/正式关系
      addEdge(world.id, focus, node.id, j === 0 ? "formal" : "source", "探索延伸");
      // 跨链接：模拟"发现关联"
      if (ids.length > 3) {
        const other = ids[Math.floor(Math.random() * ids.length)];
        if (other !== node.id) {
          addEdge(world.id, node.id, other, r % 3 === 0 ? "suggest" : "formal", "发现关联");
        }
      }
      frontier.push(node.id);
    }
    frontier.push(focus);
    // 偶发方向线：下一步往哪探索
    if (r % 6 === 0) {
      addEdge(world.id, focus, focus, "direction", "下一步可以探索什么？");
    }
  }

  // 结构化两条链 + 一个簇：让副本检测能命中（流程/领域）
  const chain = [];
  for (let i = 0; i < 4; i++) chain.push(addNode(world.id, `流程步骤${i + 1}`, 0, 0).id);
  for (let i = 0; i < 3; i++) addEdge(world.id, chain[i], chain[i + 1], "formal", "步骤");
  const cluster = addNode(world.id, "领域中心", 0, 0).id;
  for (let i = 0; i < 5; i++) {
    const n = addNode(world.id, `领域节点${i + 1}`, 0, 0).id;
    addEdge(world.id, cluster, n, "formal", "属于");
    if (i > 0) addEdge(world.id, n, cluster, "formal", "关联");
  }

  const graph = getGraph(world.id);
  let engine = "elk";
  let placed;
  try {
    placed = await elkLayout(graph.nodes, graph.edges);
  } catch {
    engine = "wfc";
    placed = wfcLayout(graph.nodes, graph.edges);
  }
  for (const p of placed) setNodePosition(p.id, p.x, p.y);

  const nodes = getGraph(world.id).nodes;
  detectBuildings(world.id, nodes[0], nodes);

  // 重叠检查（屏幕坐标：x*1.28，节点 190×170）
  const W = 190, H = 170, SP = 1.28;
  let overlaps = 0;
  let minGap = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = Math.abs(nodes[i].x - nodes[j].x) * SP;
      const dy = Math.abs(nodes[i].y - nodes[j].y) * SP;
      if (dx < W && dy < H) overlaps++;
      minGap = Math.min(minGap, Math.max(dx - W, dy - H));
    }
  }
  const buildings = listBuildings(world.id);
  res.json({
    ok: true,
    world,
    layoutEngine: engine,
    stats: {
      nodes: nodes.length,
      edges: getGraph(world.id).edges.length,
      rounds,
      overlaps,
      minGap: Number.isFinite(minGap) ? Math.round(minGap) : null,
      buildings: buildings.length,
      buildingKinds: buildings.map((b) => b.kind),
    },
  });
});

/** DEV：锚点优先垂直切片（A 方案），只用于测试 */
app.post("/api/dev/anchor-first", async (req, res) => {
  try {
    const world = getWorld(String(req.body?.worldId ?? ""));
    if (!world) return res.status(404).json({ error: "world not found" });
    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "text required" });
    const result = await runAnchorFirst({
      worldId: world.id,
      anchorId: req.body?.anchorId ? String(req.body.anchorId) : undefined,
      text,
      candidates: Array.isArray(req.body?.candidates)
        ? req.body.candidates.map((c: any) => ({ name: String(c?.name ?? "") }))
        : [],
      variant: req.body?.variant === "A2" ? "A2" : "A1",
      apply: Boolean(req.body?.apply),
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

/** 正式流式链路：稳定文本 → provisional 节点/关系 */
app.post("/api/worlds/:id/stream/segment", async (req, res) => {
  try {
    const world = getWorld(req.params.id);
    if (!world) return res.status(404).json({ error: "world not found" });
    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "text required" });
    const result = await ingestSegment(
      world.id,
      text,
      req.body?.focusId ? String(req.body.focusId) : null,
      llm,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

/** 正式流式链路：句/段 final → commit */
app.post("/api/worlds/:id/stream/commit", (req, res) => {
  try {
    const world = getWorld(req.params.id);
    if (!world) return res.status(404).json({ error: "world not found" });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : undefined;
    res.json(commitStream(world.id, ids));
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

/** 流式实体检测：只抽候选，不判关系、不落图 */
app.post("/api/worlds/:id/stream/detect", async (req, res) => {
  try {
    const world = getWorld(req.params.id);
    if (!world) return res.status(404).json({ error: "world not found" });
    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "text required" });
    const graph = getGraph(world.id);
    const anchor = getNode(String(req.body?.anchorId ?? "")) ?? graph.nodes[0];
    if (!anchor) return res.status(400).json({ error: "anchor required" });
    const t = Date.now();
    const result = await llm.extract({
      text,
      focus: { id: anchor.id, name: anchor.name },
      existing: graph.nodes.map((n) => n.name),
    });
    const existing = new Set(graph.nodes.map((n) => n.name));
    const candidates = result.entities
      .map((e) => ({ name: e.name.trim(), evidence: e.evidence ?? "", type: e.type ?? "" }))
      .filter((e) => e.name && !existing.has(e.name));
    res.json({ text, candidates, totalMs: Date.now() - t });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

/** 流式预览：只返回 ghost/决策，不落图 */
app.post("/api/worlds/:id/stream/preview", async (req, res) => {
  try {
    const world = getWorld(req.params.id);
    if (!world) return res.status(404).json({ error: "world not found" });
    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "text required" });
    const result = await runAnchorFirst({
      worldId: world.id,
      anchorId: req.body?.anchorId ? String(req.body.anchorId) : undefined,
      text,
      candidates: [],
      variant: "A2",
      apply: false,
    });
    const existing = new Set(getGraph(world.id).nodes.map((n) => n.name));
    const ghosts = result.decisions
      .filter((d) => !existing.has(d.name) && ["commit_relation", "commit_topic_pending", "candidate"].includes(d.action))
      .map((d) => ({
        name: d.name,
        role: d.role,
        action: d.action,
        label: d.label,
        predicate: d.predicate,
        confidence: d.confidence,
        pairVerdict: d.pairVerdict,
      }));
    res.json({ text, ghosts, totalMs: result.totalMs, timeline: result.timeline });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

/** 开发用：构造一个必然触发流程/领域副本的世界，便于验证生成与位置 */
app.post("/api/dev/dungeon-fixture", (_req, res) => {
  const world = createWorld("副本测试世界", "RAG");
  const add = (name: string, x: number, y: number) => addNode(world.id, name, x, y);

  const p1 = add("文档分块", 0, 0);
  const p2 = add("向量检索", 300, 0);
  const p3 = add("重排", 600, 0);
  const p4 = add("生成回答", 900, 0);
  addEdge(world.id, p1.id, p2.id, "formal", "先把文档切成分块，再做向量检索");
  addEdge(world.id, p2.id, p3.id, "formal", "检索出候选后，然后做重排");
  addEdge(world.id, p3.id, p4.id, "formal", "最后把重排结果交给生成回答");

  const parent = add("检索技术", 350, 500);
  const members = ["BM25", "向量召回", "混合检索", "精排"].map((name, i) =>
    add(name, i * 260, 720),
  );
  for (const m of members) addEdge(world.id, m.id, parent.id, "formal", "归类");

  const graph = getGraph(world.id);
  detectBuildingsV2(world.id, graph.nodes[0], graph.nodes);
  const buildings = listBuildings(world.id);
  res.json({
    ok: true,
    world,
    buildings,
    positions: buildings.map((b) => ({ kind: b.kind, x: b.x, y: b.y })),
    nodes: graph.nodes.map((n) => ({ name: n.name, x: n.x, y: n.y })),
  });
});

/* ---------------- 隐藏 / 撤回 / 导出 ---------------- */
app.post("/api/worlds/:id/hide/preview", (req, res) => {
  const result = hidePreview(req.params.id, String(req.body?.nodeId ?? ""));
  if ("error" in result) return res.status(400).json(result);
  res.json(result);
});

app.post("/api/worlds/:id/hide", (req, res) => {
  const result = applyHide(req.params.id, String(req.body?.nodeId ?? ""));
  if ("error" in result) return res.status(400).json(result);
  refreshStaleBuildings(req.params.id);
  res.json(result);
});

app.post("/api/worlds/:id/hide/undo", (req, res) => {
  const result = undoLastHide(req.params.id);
  if ("error" in result) return res.status(400).json(result);
  refreshStaleBuildings(req.params.id);
  res.json(result);
});

app.get("/api/worlds/:id/export", (req, res) => {
  const data = exportWorld(req.params.id);
  if (!data) return res.status(404).json({ error: "world not found" });
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="knowledge-world-${req.params.id.slice(0, 8)}.json"`,
  );
  res.json(data);
});

/** 方向探索被消费：标记 consumed，前端隐藏该方向标记 */
app.post("/api/edges/:id/consume", (req, res) => {
  const e = db.prepare("SELECT * FROM edges WHERE id=?").get(req.params.id) as
    | { world_id: string; src: string; kind: string; question: string | null }
    | undefined;
  const ok = consumeDirection(req.params.id);
  if (!ok) return res.status(400).json({ error: "不是可消费的方向线" });
  if (e?.kind === "direction") {
    db.prepare(
      "UPDATE directions SET status='consumed' WHERE world_id=? AND node_id=? AND question=?",
    ).run(e.world_id, e.src, e.question ?? "");
  }
  res.json({ ok });
});

/* ---------------- 副本 ---------------- */
app.get("/api/buildings/:id", (req, res) => {
  const b = getBuilding(req.params.id);
  if (!b) return res.status(404).json({ error: "building not found" });
  res.json({ building: b });
});

app.post("/api/buildings/:id/challenge", async (req, res) => {
  const b = getBuilding(req.params.id);
  if (!b) return res.status(404).json({ error: "building not found" });
  if (b.status === "locked" || b.status === "detected" || b.status === "stale") {
    res.status(409).json({ error: "尚未解锁：相关节点达到第一档后可挑战" });
    return;
  }
  if (b.kind === "flow") {
    const rawSteps: string[] = JSON.parse(b.steps || "[]");
    const names = rawSteps.map((x) => getNode(x)?.name ?? x);
    const shuffled = [...names].sort(() => Math.random() - 0.5);
    return res.json({
      kind: "flow",
      title: b.title,
      md: b.md,
      steps: shuffled,
      status: b.status,
    });
  }

  // 领域副本：按用户+世界+领域+自然日的 10 道混合题（填空/判断/解答）
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  let questions = listDomainQuestions(b.id, day);
  if (questions.length === 0) {
    const steps: string[] = JSON.parse(b.steps || "[]");
    const members = steps
      .map((id) => getNode(id))
      .filter(Boolean) as NodeRow[];
    const pool = members.length ? members : ([getNode(b.anchor)].filter(Boolean) as NodeRow[]);
    const items: {
      kind: "fill" | "judge" | "answer";
      prompt: string;
      answer: string;
      aliases?: string[];
    }[] = [];
    for (let i = 0; i < 10; i++) {
      const n = pool[i % Math.max(1, pool.length)];
      if (!n) break;
      const def = n.definition || `${n.name} 的相关知识`;
      const kind = (["fill", "judge", "answer"] as const)[i % 3];
      if (kind === "fill") {
        items.push({ kind, prompt: `「${n.name}」的核心定义是什么？`, answer: def });
      } else if (kind === "judge") {
        const other = pool[(i + 1) % Math.max(1, pool.length)];
        const trueClaim = i % 2 === 0;
        items.push({
          kind,
          prompt: trueClaim
            ? `「${n.name}」是指 ${def}。`
            : `「${n.name}」是指 ${other?.definition || "与本领域无关的概念"}。`,
          answer: trueClaim ? "对" : "错",
        });
      } else {
        items.push({ kind, prompt: `用自己的话解释「${n.name}」。`, answer: def });
      }
    }
    createDomainQuestions(b.id, day, items);
    questions = listDomainQuestions(b.id, day);
  }
  res.json({
    kind: "domain",
    title: b.title,
    md: b.md,
    daily: { used: questions.length, limit: 10 },
    questions: questions.map((q) => ({ id: q.id, prompt: q.prompt, kind: q.kind })),
    status: b.status,
  });
});

app.post("/api/buildings/:id/submit", async (req, res) => {
  const b = getBuilding(req.params.id);
  if (!b) return res.status(404).json({ error: "building not found" });
  if (b.status !== "playable" && b.status !== "cleared") {
    return res.status(409).json({ error: "副本尚未解锁，不能提交" });
  }
  if (b.kind === "flow") {
    const expected: string[] = (JSON.parse(b.steps || "[]") as string[]).map(
      (x) => getNode(x)?.name ?? x,
    );
    const order: string[] = (Array.isArray(req.body?.order) ? req.body.order : []).map(
      (x: string) => getNode(x)?.name ?? x,
    );
    const correct =
      order.length === expected.length && order.every((x, i) => x === expected[i]);
    if (correct) setBuildingStatus(b.id, "cleared");
    return res.json({ correct, expected, status: correct ? "cleared" : b.status });
  }

  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const questions = listDomainQuestions(b.id, day);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answers: { id: string; answer: string }[] = Array.isArray(req.body?.answers)
    ? req.body.answers
    : [];
  const norm = (v: string) =>
    v.toLowerCase().replace(/[\s，。,.；;：:（）()]/g, "").trim();
  let ok = 0;
  for (const a of answers) {
    const q = byId.get(a.id);
    if (!q) continue;
    if (q.kind === "answer") {
      const judged = await llm.judge({ prompt: q.prompt, answer: a.answer, reference: q.answer });
      if (judged.correct) ok++;
    } else {
      const accepted = [q.answer, ...(JSON.parse(q.aliases || "[]") as string[])].map(norm);
      const got = norm(a.answer);
      const hit =
        accepted.some((x) => x === got || (got.length >= 2 && x.includes(got)) || got.includes(x)) ||
        (() => {
          const ref = new Set(accepted[0]?.split("") ?? []);
          const chars = new Set(got.split(""));
          if (!ref.size) return false;
          let n = 0;
          for (const ch of chars) if (ref.has(ch)) n++;
          return n / ref.size >= 0.6;
        })();
      if (hit) ok++;
    }
  }
  const passed = answers.length > 0 && ok / answers.length >= 0.6;
  if (passed) setBuildingStatus(b.id, "cleared");
  return res.json({
    correct: passed,
    score: `${ok}/${answers.length}`,
    status: passed ? "cleared" : b.status,
  });
});

app.patch("/api/buildings/:id", (req, res) => {
  const b = getBuilding(req.params.id);
  if (!b) return res.status(404).json({ error: "building not found" });
  const md = typeof req.body?.md === "string" ? req.body.md : b.md;
  const steps = Array.isArray(req.body?.steps) ? req.body.steps : undefined;
  updateBuildingMd(b.id, md, steps);
  res.json({ ok: true });
});

const server = createServer(app);

/* ---------------- 实时语音（豆包流式预留位） ---------------- */
const wss = new WebSocketServer({ server, path: "/ws/asr" });
wss.on("connection", (ws: WebSocket) => {
  let session: ReturnType<typeof asr.open> | null = null;
  ws.on("message", (data) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "start" || msg.type === "mock") {
      const provider = msg.type === "mock" ? mockASR : asr;
      session = provider.open({
        onPartial: (text) => ws.send(JSON.stringify({ type: "partial", text })),
        onSegment: (text) => ws.send(JSON.stringify({ type: "segment", text })),
        onFinal: (text) => {
          ws.send(JSON.stringify({ type: "final", text }));
          session = null;
        },
        onError: (message) => ws.send(JSON.stringify({ type: "error", message })),
      }, {
        hotwords: Array.isArray(msg.hotwords) ? msg.hotwords.map(String) : [],
        context: Array.isArray(msg.context) ? msg.context.map(String) : [],
      });
      ws.send(JSON.stringify({ type: "ready", provider: provider.name }));
    } else if (msg.type === "stop") {
      session?.end();
    } else if (msg.type === "audio" && msg.chunk) {
      session?.push(Buffer.from(msg.chunk, "base64"));
    }
  });
  ws.on("close", () => session?.end());
});

server.listen(env.port, () => {
  console.log(`[blouck] server http://localhost:${env.port}  llm=${llm.name} asr=${asr.name}`);
});
