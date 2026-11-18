import { Router } from "express";
import {
  addEdge,
  addNode,
  createWorld,
  getGraph,
  getWorld,
  listBuildings,
  repairDemoWorld,
} from "../db.js";
import { ensureBuildingPositions, ensureDirectionFrontiers } from "../assetops.js";
import { simulateExplore } from "../experiments/exploreSim.js";
import { runAnchorFirst } from "../experiments/anchorFirst.js";
import { detectBuildingsV2 } from "../services/buildings.js";

/** /api/dev/*：压测、探索模拟、锚点优先原型、副本 fixture。不是产品链路。 */
export const devRouter = Router();

devRouter.post("/api/dev/world", (req, res) => {
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

devRouter.post("/api/dev/explore", async (req, res) => {
  const rounds = Math.max(6, Math.min(60, Number(req.body?.rounds ?? 24)));
  const result = await simulateExplore(rounds, detectBuildingsV2);
  ensureBuildingPositions(result.world.id);
  ensureDirectionFrontiers(result.world.id);
  res.json(result);
});

devRouter.post("/api/dev/anchor-first", async (req, res) => {
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

devRouter.post("/api/dev/reseed-demo", (_req, res) => {
  res.json({ ok: true, world: repairDemoWorld() });
});

devRouter.post("/api/dev/dungeon-fixture", (_req, res) => {
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
  detectBuildingsV2(world.id, graph.nodes[0], graph.nodes, true);
  const buildings = listBuildings(world.id);
  res.json({
    ok: true,
    world,
    buildings,
    positions: buildings.map((b) => ({ kind: b.kind, x: b.x, y: b.y })),
    nodes: graph.nodes.map((n) => ({ name: n.name, x: n.x, y: n.y })),
  });
});
