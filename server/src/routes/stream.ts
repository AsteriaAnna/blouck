import { Router } from "express";
import { getGraph, getNode, getWorld } from "../db.js";
import { ingestSegment, commitStream } from "../stream/session.js";
import { runAnchorFirst } from "../experiments/anchorFirst.js";
import { llm } from "../providers/active.js";

/**
 * /api/worlds/:id/stream/*
 * segment/commit 是正式链路；detect/preview 是实验/未使用 API，保留但见 experimental.md。
 */
export const streamRouter = Router();

streamRouter.post("/:id/stream/segment", async (req, res) => {
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

streamRouter.post("/:id/stream/commit", (req, res) => {
  try {
    const world = getWorld(req.params.id);
    if (!world) return res.status(404).json({ error: "world not found" });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : undefined;
    res.json(commitStream(world.id, ids));
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

streamRouter.post("/:id/stream/detect", async (req, res) => {
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

streamRouter.post("/:id/stream/preview", async (req, res) => {
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
