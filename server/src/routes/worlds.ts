import { Router } from "express";
import {
  computeFrontier,
  computeTier,
  countPassed,
  createWorld,
  db,
  deleteWorld,
  getGraph,
  getWorld,
  listBuildings,
  listDirections,
  listWorlds,
} from "../db.js";
import { ensureBuildingPositions, ensureDirectionFrontiers } from "../assetops.js";
import { materializeDirectionEdges } from "../services/directions.js";

/** 世界列表/创建/读取/删除（读取时补齐 source_quote 与 frontier） */
export const worldsRouter = Router();

worldsRouter.get("/api/worlds", (_req, res) => {
  res.json({ worlds: listWorlds() });
});

worldsRouter.post("/api/worlds", (req, res) => {
  const { name, rootName } = req.body ?? {};
  if (!name || !rootName) {
    return res.status(400).json({ error: "需要世界名与初始节点名" });
  }
  const world = createWorld(String(name), String(rootName));
  res.json({ world });
});

worldsRouter.delete("/api/worlds/:id", (req, res) => {
  deleteWorld(req.params.id);
  res.json({ ok: true });
});

worldsRouter.get("/api/worlds/:id", (req, res) => {
  const world = getWorld(req.params.id);
  if (!world) return res.status(404).json({ error: "world not found" });
  ensureBuildingPositions(world.id);
  // frontier 是派生数据；老世界（如种子示例）可能从未算过，导致方向线全部不渲染
  computeFrontier(world.id);
  ensureDirectionFrontiers(world.id);
  materializeDirectionEdges(world.id);
  const graph = getGraph(world.id);
  const buildings = listBuildings(world.id);
  // 节点 MD 的“来源”引用：把来源片段文本/时间一起下发（只读，供节点文档展示）
  const spanRows = db
    .prepare("SELECT id, text, created_at FROM source_spans WHERE world_id=?")
    .all(world.id) as { id: string; text: string; created_at: number }[];
  const spanById = new Map(spanRows.map((s) => [s.id, s]));
  const nodes = graph.nodes.map((n) => {
    const span = n.source_span_id ? spanById.get(n.source_span_id) : undefined;
    return {
      ...n,
      passed: countPassed(n.id),
      tier: computeTier(n.id),
      source_text: span?.text ?? null,
      source_at: span?.created_at ?? null,
    };
  });
  res.json({ world, nodes, edges: graph.edges, buildings, directions: listDirections(world.id) });
});
