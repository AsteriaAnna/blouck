import { Router } from "express";
import {
  computeTier,
  countPassed,
  getGraph,
  getWorld,
  setNodePosition,
} from "../db.js";
import {
  applyHide,
  ensureBuildingPositions,
  ensureDirectionFrontiers,
  exportWorld,
  hidePreview,
  undoLastHide,
} from "../assetops.js";
import { elkLayout, wfcLayout } from "../layout.js";
import { wfcGraphLayout } from "../wfc.js";
import { refreshAllBuildingStatus, refreshStaleBuildings } from "../services/buildings.js";

/** /api/worlds/:id/layout、hide、export：世界级维护操作（UI 当前无入口） */
export const worldAdminRouter = Router();

worldAdminRouter.post("/api/worlds/:id/layout", async (req, res) => {
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

worldAdminRouter.post("/api/worlds/:id/hide/preview", (req, res) => {
  const result = hidePreview(req.params.id, String(req.body?.nodeId ?? ""));
  if ("error" in result) return res.status(400).json(result);
  res.json(result);
});

worldAdminRouter.post("/api/worlds/:id/hide", (req, res) => {
  const result = applyHide(req.params.id, String(req.body?.nodeId ?? ""));
  if ("error" in result) return res.status(400).json(result);
  refreshStaleBuildings(req.params.id);
  res.json(result);
});

worldAdminRouter.post("/api/worlds/:id/hide/undo", (req, res) => {
  const result = undoLastHide(req.params.id);
  if ("error" in result) return res.status(400).json(result);
  refreshStaleBuildings(req.params.id);
  res.json(result);
});

worldAdminRouter.get("/api/worlds/:id/export", (req, res) => {
  const data = exportWorld(req.params.id);
  if (!data) return res.status(404).json({ error: "world not found" });
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="knowledge-world-${req.params.id.slice(0, 8)}.json"`,
  );
  res.json(data);
});
