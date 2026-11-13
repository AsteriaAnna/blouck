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
  const baseAngle = graph.nodes.length * 0.9;
  result.entities.forEach((ent, i) => {
    const name = ent.name.trim();
    if (!name) return;
    if (graph.nodes.some((n) => n.name.toLowerCase() === name.toLowerCase())) return;
    const angle = baseAngle + i * 0.8;
    const radius = 280 + i * 70;
    const node = addNode(
      world.id,
      name,
      focus.x + Math.cos(angle) * radius,
      focus.y + Math.sin(angle) * radius,
      ent.hint ? `## ${name}\n\n> ${ent.hint}` : "",
    );
    createdNodes.push(node);
    graph.nodes.push(node);
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

  detectBuildings(world.id, focus, graph.nodes);
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
  if (quizzes.length < 10 && anchor) {
    const items = await llm.generateQuiz({ name: anchor.name, md: anchor.free_md });
    if (!listQuizzes(anchor.id).length) createQuizzes(anchor.id, items);
    quizzes = listQuizzes(anchor.id).filter((q) => q.kind === "judge");
  }
  res.json({
    kind: "domain",
    title: b.title,
    md: b.md,
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
    if (msg.type === "start") {
      session = asr.open({
        onPartial: (text) => ws.send(JSON.stringify({ type: "partial", text })),
        onFinal: (text) => {
          ws.send(JSON.stringify({ type: "final", text }));
          session = null;
        },
        onError: (message) => ws.send(JSON.stringify({ type: "error", message })),
      });
      ws.send(JSON.stringify({ type: "ready", provider: asr.name }));
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
