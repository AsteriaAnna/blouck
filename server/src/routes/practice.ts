import { Router } from "express";
import { db } from "../db.js";
import { answerRelationPractice, ensureRelationPractice } from "../services/practice.js";
import { llm } from "../providers/active.js";

/** 关系短练习：生成/读取 3 题、提交单题。 */
export const practiceRouter = Router();

practiceRouter.get("/api/edges/:id/practice", async (req, res) => {
  const edge = db.prepare("SELECT * FROM edges WHERE id=?").get(req.params.id) as
    | { id: string; kind: string }
    | undefined;
  if (!edge) return res.status(404).json({ error: "edge not found" });
  if (edge.kind !== "formal" && edge.kind !== "suggest") {
    return res.status(400).json({ error: "只有语义关系可以做辨析练习" });
  }
  const payload = await ensureRelationPractice(edge.id, llm);
  res.json(payload);
});

practiceRouter.post("/api/practice/:id/answer", async (req, res) => {
  const result = await answerRelationPractice(
    req.params.id,
    String(req.body?.answer ?? ""),
    llm,
  );
  if (!result) return res.status(404).json({ error: "practice item not found" });
  res.json(result);
});
