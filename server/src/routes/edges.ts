import { Router } from "express";
import {
  addEdge,
  computeFrontier,
  db,
  getNode,
  getWorld,
  updateEdgeKind,
  updateEdgeMd,
} from "../db.js";
import { consumeDirection } from "../assetops.js";
import { llm } from "../providers/active.js";
import { consumeDirectionEdge, materializeDirectionEdges } from "../services/directions.js";

/** /api/edges/*、/api/worlds/:id/relations：关系接受/手动连线/编辑/方向消费 */
export const edgesRouter = Router();

edgesRouter.post("/api/edges/:id/accept", async (req, res) => {
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
edgesRouter.post("/api/worlds/:id/relations", async (req, res) => {
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

edgesRouter.patch("/api/edges/:id", (req, res) => {
  const edge = db.prepare("SELECT * FROM edges WHERE id=?").get(req.params.id) as
    | { id: string; md: string; label: string }
    | undefined;
  if (!edge) return res.status(404).json({ error: "edge not found" });
  const md = typeof req.body?.md === "string" ? req.body.md : edge.md;
  const label = typeof req.body?.label === "string" ? req.body.label : undefined;
  updateEdgeMd(edge.id, md, label);
  res.json({ ok: true });
});

/** 方向探索被消费：以 directions 表为源，置 consumed；投影边只打标记 */
edgesRouter.post("/api/edges/:id/consume", (req, res) => {
  const ok = consumeDirectionEdge(req.params.id);
  if (!ok) return res.status(400).json({ error: "不是可消费的方向线" });
  res.json({ ok });
});
