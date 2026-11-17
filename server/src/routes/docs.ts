import { Router } from "express";
import { getNode } from "../db.js";
import { db } from "../db.js";
import { setNodeDocNotes, setRelationDocNotes } from "../db/docs.js";
import { ensureNodeDoc, ensureRelationDoc } from "../services/contentDocs.js";
import { llm } from "../providers/active.js";

/** 节点/关系理解卡：懒生成 + 笔记编辑。生成失败由 service 兜底，不 500。 */
export const docsRouter = Router();

docsRouter.get("/api/nodes/:id/doc", async (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: "node not found" });
  const payload = await ensureNodeDoc(node.id, llm);
  res.json(payload);
});

docsRouter.post("/api/nodes/:id/doc/regenerate", async (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: "node not found" });
  const payload = await ensureNodeDoc(node.id, llm, true);
  res.json(payload);
});

docsRouter.patch("/api/nodes/:id/doc/notes", (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: "node not found" });
  setNodeDocNotes(node.id, String(req.body?.notes ?? ""));
  res.json({ ok: true });
});

docsRouter.get("/api/edges/:id/doc", async (req, res) => {
  const edge = db.prepare("SELECT * FROM edges WHERE id=?").get(req.params.id) as
    | { id: string }
    | undefined;
  if (!edge) return res.status(404).json({ error: "edge not found" });
  const payload = await ensureRelationDoc(edge.id, llm);
  res.json(payload);
});

docsRouter.post("/api/edges/:id/doc/regenerate", async (req, res) => {
  const edge = db.prepare("SELECT * FROM edges WHERE id=?").get(req.params.id) as
    | { id: string }
    | undefined;
  if (!edge) return res.status(404).json({ error: "edge not found" });
  const payload = await ensureRelationDoc(edge.id, llm, true);
  res.json(payload);
});

docsRouter.patch("/api/edges/:id/doc/notes", (req, res) => {
  const edge = db.prepare("SELECT * FROM edges WHERE id=?").get(req.params.id) as
    | { id: string }
    | undefined;
  if (!edge) return res.status(404).json({ error: "edge not found" });
  setRelationDocNotes(edge.id, String(req.body?.notes ?? ""));
  res.json({ ok: true });
});
