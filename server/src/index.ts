import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { env, providers } from "./env.js";
import {
  addEdge,
  addNode,
  countPassed,
  computeTier,
  createBuilding,
  createQuizzes,
  createWorld,
  db,
  deleteWorld,
  getBuilding,
  getGraph,
  getNode,
  getWorld,
  listBuildings,
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
  res.json({ world, nodes, edges: graph.edges, buildings });
});

/** 语音/文字 → 实体与关系 → 落图（只对稳定文本调用） */
app.post("/api/worlds/:id/extract", async (req, res) => {
  const world = getWorld(req.params.id);
  if (!world) return res.status(404).json({ error: "world not found" });
  const text = String(req.body?.text ?? "").trim();
  const fromNodeId = String(req.body?.fromNodeId ?? world.root_node_id);
  if (!text) return res.status(400).json({ error: "text required" });
  const focus = getNode(fromNodeId) ?? getNode(world.root_node_id);
  if (!focus) return res.status(400).json({ error: "focus node missing" });

  const graph = getGraph(world.id);
  const existing = graph.nodes.map((n) => n.name);
  const result = await llm.extract({ text, focus, existing });

  const createdNodes: NodeRow[] = [];
  const createdEdges: unknown[] = [];
  // 增量放置：每个新实体围绕焦点节点现场算位置（避开已有节点、朝外生长）
  const placed = graph.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  result.entities.forEach((ent) => {
    const name = ent.name.trim();
    if (!name) return;
    if (graph.nodes.some((n) => n.name.toLowerCase() === name.toLowerCase())) return;
    const pos = placeAround(
      placed,
      { id: focus.id, x: focus.x, y: focus.y },
      { preferAngle: (placed.length * 1.7) % (Math.PI * 2) },
    );
    const node = addNode(
      world.id,
      name,
      pos.x,
      pos.y,
      ent.hint ? `## ${name}\n\n> ${ent.hint}` : "",
    );
    createdNodes.push(node);
    graph.nodes.push(node);
    placed.push({ id: node.id, x: pos.x, y: pos.y });
  });

  const findNode = (name: string) =>
    graph.nodes.find((n) => n.name.toLowerCase() === name.toLowerCase());
  for (const rel of result.relations) {
    const target = findNode(rel.target);
    if (!target) continue;
    const kind: EdgeKind =
      rel.type === "direction"
        ? "direction"
        : rel.type === "suggest"
          ? "suggest"
          : rel.type === "source"
            ? "source"
            : "formal";
    const e = addEdge(
      world.id,
      kind === "direction" ? target.id : focus.id,
      kind === "direction" ? focus.id : target.id,
      kind,
      rel.label ?? "",
      rel.question ?? null,
    );
    createdEdges.push(e);
  }

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

  if (!bs.some((b) => b.kind === "domain")) {
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

  if (!bs.some((b) => b.kind === "flow")) {
    for (const candidate of detectFlowCandidates(dNodes, dEdges)) {
      const check = validateFlowCandidate(dNodes, candidate);
      if (!check.ok || !check.order) continue;
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

/** 副本解锁状态：流程看链上节点，领域看锚点邻域，均需当前 tier≥1 */
function refreshAllBuildingStatus(worldId: string) {
  for (const b of listBuildings(worldId)) {
    if (b.status === "cleared") continue;
    let ready = false;
    if (b.kind === "flow") {
      const steps = JSON.parse(b.steps || "[]") as string[];
      ready = steps.length >= 3 && steps.every((id) => (getNode(id)?.tier ?? 0) >= 1);
    } else {
      const related = getGraph(worldId).edges
        .filter((e) => e.kind === "formal" || e.kind === "source")
        .flatMap((e) => [e.src, e.dst]);
      const ids = new Set<string>([b.anchor, ...related]);
      const passed = [...ids].filter((id) => (getNode(id)?.tier ?? 0) >= 1).length;
      ready = passed >= 2;
    }
    setBuildingStatus(b.id, ready ? "playable" : "locked");
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

app.get("/api/nodes/:id/quiz", (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: "node not found" });
  const quizzes = listQuizzes(node.id);
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
    const items = await llm.generateQuiz({ name: node.name, md: node.free_md });
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

app.post("/api/edges/:id/accept", (req, res) => {
  const edge = db.prepare("SELECT * FROM edges WHERE id=?").get(req.params.id) as
    | { id: string; kind: string }
    | undefined;
  if (!edge) return res.status(404).json({ error: "edge not found" });
  if (edge.kind !== "suggest") return res.status(400).json({ error: "只能接受虚线建议" });
  updateEdgeKind(edge.id, "formal");
  res.json({ ok: true });
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
  res.json(result);
});

app.post("/api/worlds/:id/hide/undo", (req, res) => {
  const result = undoLastHide(req.params.id);
  if ("error" in result) return res.status(400).json(result);
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
  const ok = consumeDirection(req.params.id);
  if (!ok) return res.status(400).json({ error: "不是可消费的方向线" });
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
  if (b.status === "locked") {
    res.status(409).json({ error: "尚未解锁：相关节点至少 2 个达到第一档" });
    return;
  }
  if (b.kind === "flow") {
    const steps: string[] = JSON.parse(b.steps || "[]");
    const shuffled = [...steps].sort(() => Math.random() - 0.5);
    return res.json({
      kind: "flow",
      title: b.title,
      md: b.md,
      steps: shuffled,
      status: b.status,
    });
  }
  const anchor = getNode(b.anchor);
  let quizzes = anchor ? listQuizzes(anchor.id).filter((q) => q.kind === "judge") : [];
  // 领域副本：每个自然日至多 10 道新题；已有题组重开不新增额度
  const daily = bumpDomainDaily(b.world_id, b.id, 10, quizzes.length ? 0 : 10);
  if (!daily.allowed && !quizzes.length) {
    return res.status(429).json({
      error: "今日领域题目额度已用完（10 道），明天再来",
      used: daily.used,
      limit: daily.limit,
    });
  }
  if (quizzes.length < 10 && anchor && daily.allowed) {
    const items = await llm.generateQuiz({ name: anchor.name, md: anchor.free_md });
    if (!listQuizzes(anchor.id).length) createQuizzes(anchor.id, items);
    quizzes = listQuizzes(anchor.id).filter((q) => q.kind === "judge");
  }
  res.json({
    kind: "domain",
    title: b.title,
    md: b.md,
    daily: { used: daily.used, limit: daily.limit },
    questions: quizzes.slice(0, 10).map((q) => ({ id: q.id, prompt: q.prompt })),
    status: b.status,
  });
});

app.post("/api/buildings/:id/submit", async (req, res) => {
  const b = getBuilding(req.params.id);
  if (!b) return res.status(404).json({ error: "building not found" });
  if (b.kind === "flow") {
    const expected: string[] = JSON.parse(b.steps || "[]");
    const order: string[] = Array.isArray(req.body?.order) ? req.body.order : [];
    const correct =
      order.length === expected.length && order.every((x, i) => x === expected[i]);
    if (correct) setBuildingStatus(b.id, "cleared");
    return res.json({ correct, expected, status: correct ? "cleared" : b.status });
  }
  const answers: { id: string; answer: string }[] = Array.isArray(req.body?.answers)
    ? req.body.answers
    : [];
  let ok = 0;
  for (const a of answers) {
    const quiz = db.prepare("SELECT * FROM quizzes WHERE id=?").get(a.id) as
      | { prompt: string; answer: string }
      | undefined;
    if (!quiz) continue;
    const judged = await llm.judge({
      prompt: quiz.prompt,
      answer: a.answer,
      reference: quiz.answer,
    });
    if (judged.correct) ok++;
    // 领域题按 MVP 文档「先不计节点三档」，这里不做 recordAttempt
  }
  const passed = answers.length > 0 && ok / answers.length >= 0.6;
  if (passed) setBuildingStatus(b.id, "cleared");
  return res.json({ correct: passed, score: `${ok}/${answers.length}`, status: passed ? "cleared" : b.status });
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
        onFinal: (text) => {
          ws.send(JSON.stringify({ type: "final", text }));
          session = null;
        },
        onError: (message) => ws.send(JSON.stringify({ type: "error", message })),
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
