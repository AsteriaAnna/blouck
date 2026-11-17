import { Router } from "express";
import { ensureDungeonSequence, completeDungeonSequence } from "../services/dungeonSequence.js";
import { llm } from "../providers/active.js";

export const dungeonSequenceRouter = Router();

dungeonSequenceRouter.get("/api/buildings/:id/sequence", async (req, res) => {
  res.json(await ensureDungeonSequence(req.params.id, llm));
});

dungeonSequenceRouter.post("/api/buildings/:id/sequence/complete", (req, res) => {
  const edgeId = req.body?.edgeId ? String(req.body.edgeId) : undefined;
  res.json(completeDungeonSequence(req.params.id, edgeId));
});
