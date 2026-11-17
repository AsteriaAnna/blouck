import { Router } from "express";
import {
  addDirection,
  addEdge,
  addNode,
  computeFrontier,
  computeTier,
  countPassed,
  createBuilding,
  createDomainQuestions,
  createQuizzes,
  createSourceSpan,
  db,
  getBuilding,
  getGraph,
  getNode,
  getWorld,
  listBuildings,
  listDomainQuestions,
  listDirections,
  listQuizzes,
  recordAttempt,
  setBuildingStatus,
  updateNodeMeta,
  type BuildingRow,
  type EdgeKind,
  type EdgeRow,
  type NodeRow,
} from "../db.js";
import { llm } from "../providers/active.js";
import { placeAround } from "../placement.js";
import { materializeDirectionEdges } from "../services/directions.js";
import { detectBuildingsLLM, detectBuildingsV2, refreshAllBuildingStatus, refreshStaleBuildings } from "../services/buildings.js";
import {
  detectDomainCandidates,
  detectFlowCandidates,
  toDungeonEdges,
  toDungeonNodes,
  validateDomainCandidate,
  validateFlowCandidate,
} from "../dungeons.js";
import {
  bumpDomainDaily,
  consumeDirection,
  ensureBuildingPositions,
  ensureDirectionFrontiers,
} from "../assetops.js";

export const graphRouter = Router();

/** 节点名只去掉首尾空白；“是不是一个概念”由抽取阶段的过程/步骤区分决定，不再做字符串补后缀 */
function normalizeConceptName(raw: string): { name: string; aliases: string[] } {
  return { name: raw.trim(), aliases: [] };
}

/** 从“探索方向”落图：方向生成时已经计划好延伸节点，这里直接创建它（不再拿问题当文本抽取） */
graphRouter.post("/api/worlds/:id/explore", async (req, res) => {
  const world = getWorld(req.params.id);
  if (!world) return res.status(404).json({ error: "world not found" });
  const edgeId = String(req.body?.edgeId ?? "");
  if (!edgeId) return res.status(400).json({ error: "edgeId required" });
  const edge = db.prepare("SELECT * FROM edges WHERE id=? AND world_id=?").get(edgeId, world.id) as
    | EdgeRow
    | undefined;
  if (!edge || edge.kind !== "direction") return res.status(404).json({ error: "direction edge not found" });
  if (edge.consumed) return res.status(409).json({ error: "这个方向已经探索过了" });
  const src = getNode(edge.src);
  if (!src) return res.status(404).json({ error: "source node not found" });

  let graph = getGraph(world.id);
  let directionRow = listDirections(world.id).find(
    (d) => d.node_id === edge.src && d.question === (edge.question ?? "") && d.status === "open",
  );
  const readPlan = () => {
    const name = edge.target_name ?? directionRow?.target_name ?? null;
    if (!name) return null;
    return {
      name,
      type: edge.target_type ?? directionRow?.target_type ?? "概念",
      definition: edge.target_definition ?? directionRow?.target_definition ?? "",
      aliasesRaw: edge.target_aliases ?? directionRow?.target_aliases ?? "[]",
      predicate: edge.target_predicate ?? directionRow?.target_predicate ?? "related",
      label: edge.target_label ?? directionRow?.target_label ?? "延伸",
    };
  };

  // 老方向没有计划：现场规划一次并写回，之后直接落图
  let plan = readPlan();
  if (!plan) {
    const existing = graph.nodes.map((n) => n.name);
    const neighbors = graph.edges
      .filter((e) => e.src === src.id || e.dst === src.id)
      .map((e) => graph.nodes.find((x) => x.id === (e.src === src.id ? e.dst : e.src))?.name ?? "")
      .filter(Boolean)
      .slice(0, 6);
    try {
      const suggestions = await llm.suggestDirections({
        nodes: [{ name: src.name, definition: src.definition, neighbors }],
        existing,
      });
      const sug = suggestions[0];
      if (sug?.target?.name) {
        plan = {
          name: sug.target.name,
          type: sug.target.type ?? "概念",
          definition: sug.target.definition ?? "",
          aliasesRaw: JSON.stringify(sug.target.aliases ?? []),
          predicate: sug.predicate ?? "related",
          label: sug.label ?? "延伸",
        };
        const aliases = plan.aliasesRaw;
        if (directionRow) {
          db.prepare(
            "UPDATE directions SET target_name=?, target_type=?, target_definition=?, target_aliases=?, target_predicate=?, target_label=? WHERE id=?",
          ).run(plan.name, plan.type, plan.definition, aliases, plan.predicate, plan.label, directionRow.id);
        }
        db.prepare(
          "UPDATE edges SET target_name=?, target_type=?, target_definition=?, target_aliases=?, target_predicate=?, target_label=? WHERE id=?",
        ).run(plan.name, plan.type, plan.definition, aliases, plan.predicate, plan.label, edgeId);
      }
    } catch (err) {
      console.warn("[explore] 方向规划失败：", err);
    }
  }

  if (!plan) {
    const payload = getGraph(world.id);
    return res.json({
      nodes: payload.nodes,
      edges: payload.edges,
      buildings: listBuildings(world.id),
      directions: listDirections(world.id),
      createdNodes: [],
      warning: "这个方向还没有规划出延伸节点，方向已保留；请稍后重试或换一个方向。",
    });
  }

  let aliases: string[] = [];
  try {
    aliases = JSON.parse(plan.aliasesRaw || "[]");
  } catch {
    aliases = [];
  }
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_·、，。,.；;：:（）()【】\[\]《》"'“”]/g, "").trim();
  const existingNode = graph.nodes.find(
    (n) => norm(n.name) === norm(plan!.name) || (() => {
      try {
        return (JSON.parse(n.aliases || "[]") as string[]).some((a) => norm(a) === norm(plan!.name));
      } catch {
        return false;
      }
    })(),
  );

  const fx = edge.frontier_x ?? src.x + 312;
  const fy = edge.frontier_y ?? src.y;
  const angle = Math.atan2(fy - src.y, fx - src.x);
  const placed = graph.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  const createdNodes: NodeRow[] = [];
  const createdEdges: unknown[] = [];

  if (existingNode) {
    // 计划节点已经存在：只建立关系并消费方向
    if (!graph.edges.some((e) => e.src === src.id && e.dst === existingNode.id && e.kind === "formal")) {
      createdEdges.push(
        addEdge(world.id, src.id, existingNode.id, "formal", plan.label, null, "", {
          predicate: plan.predicate,
          evidence: edge.question ?? "",
          confidence: 0.75,
          origin: "direction",
        }),
      );
    }
  } else {
    const pos = placeAround(placed, { id: "__explore_anchor", x: fx, y: fy }, { preferAngle: angle });
    const span = createSourceSpan(world.id, edge.question || plan.definition || plan.name);
    const node = addNode(world.id, plan.name, pos.x, pos.y, "", {
      type: plan.type,
      definition: plan.definition,
      aliases,
      sourceSpanId: span.id,
    });
    createdNodes.push(node);
    createdEdges.push(
      addEdge(world.id, src.id, node.id, "source", "本轮探索来源", null, "", {
        evidence: edge.question ?? "",
        confidence: 0.9,
        origin: "direction",
      }),
    );
    createdEdges.push(
      addEdge(world.id, src.id, node.id, "formal", plan.label || "延伸", null, "", {
        predicate: plan.predicate || "related",
        evidence: edge.question ?? "",
        confidence: 0.75,
        origin: "direction",
      }),
    );

    // 新节点也要有下一步方向（保持探索链不断）
    try {
      const existing = [...graph.nodes, node].map((n) => n.name);
      const sugg = await llm.suggestDirections({
        nodes: [{ name: node.name, definition: node.definition, neighbors: [src.name] }],
        existing,
      });
      const s = sugg[0];
      if (s?.target?.name) {
        addDirection(world.id, node.id, s.question, s.reason, {
          name: s.target.name,
          type: s.target.type,
          definition: s.target.definition,
          aliases: s.target.aliases,
          predicate: s.predicate ?? null,
          label: s.label,
        });
      } else {
        addDirection(world.id, node.id, `「${node.name}」还可以往哪一步深入？`, `围绕「${node.name}」的下一步`, null);
      }
    } catch {
      addDirection(world.id, node.id, `「${node.name}」还可以往哪一步深入？`, `围绕「${node.name}」的下一步`, null);
    }
  }

  consumeDirection(edgeId);
  if (directionRow) db.prepare("UPDATE directions SET status='consumed' WHERE id=?").run(directionRow.id);
  computeFrontier(world.id);
  materializeDirectionEdges(world.id);
  const payload = getGraph(world.id);
  const warning = createdNodes.length ? undefined : "这个方向的目标节点已经存在，已只建立关系。";
  res.json({
    nodes: payload.nodes,
    edges: payload.edges,
    buildings: listBuildings(world.id),
    directions: listDirections(world.id),
    createdNodes,
    warning,
  });
});

/** 语音/文字 → 概念/关系/方向 → 落图（关系与节点 v2） */
graphRouter.post("/api/worlds/:id/extract", async (req, res) => {
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
      let targetAliases: string[] = [];
      try {
        targetAliases = JSON.parse(target.aliases || "[]");
      } catch {
        targetAliases = [];
      }
      addDirection(world.id, source.id, question, evidence, {
        name: target.name,
        type: target.type,
        definition: target.definition,
        aliases: targetAliases,
        predicate: rel.predicate ?? null,
        label: rel.label,
      });
      // 方向边是 directions 表的投影，由 materializeDirectionEdges 统一生成；
      // 这里不再直接 addEdge(kind='direction')，避免双写。
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
        existing: graph.nodes.map((n) => n.name),
      });
      for (const sug of suggestions) {
        const n = pending.find((x) => x.name === sug.node);
        if (!n || haveDirection.has(n.id)) continue;
        addDirection(world.id, n.id, sug.question, sug.reason, sug.target
          ? {
              name: sug.target.name,
              type: sug.target.type,
              definition: sug.target.definition,
              aliases: sug.target.aliases,
              predicate: sug.predicate ?? null,
              label: sug.label,
            }
          : null);
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
