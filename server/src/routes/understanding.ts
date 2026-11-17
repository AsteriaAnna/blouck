import { Router } from "express";
import { db } from "../db.js";
import { answerUnderstandingTask, ensureUnderstandingTask } from "../services/understanding.js";
import { llm } from "../providers/active.js";

export const understandingRouter = Router();

understandingRouter.get("/api/edges/:id/understanding", async (req, res) => {
  const edge = db.prepare("SELECT id,kind FROM edges WHERE id=?").get(req.params.id) as
    | { id: string; kind: string }
    | undefined;
  if (!edge) return res.status(404).json({ error: "edge not found" });
  if (edge.kind !== "formal" && edge.kind !== "suggest") {
    return res.status(400).json({ error: "只有语义关系可以做辨析" });
  }
  res.json(await ensureUnderstandingTask(edge.id, llm));
});

understandingRouter.post("/api/understanding/:id/answer", async (req, res) => {
  const result = await answerUnderstandingTask(
    req.params.id,
    String(req.body?.choice ?? ""),
    String(req.body?.explanation ?? ""),
    llm,
  );
  if (!result) return res.status(404).json({ error: "task not found" });
  res.json(result);
});
