import { Router } from "express";
import {
  computeTier,
  countPassed,
  createQuizzes,
  db,
  getNode,
  listQuizzes,
  recordAttempt,
  setNodeHidden,
  updateNodeMd,
} from "../db.js";
import { llm } from "../providers/active.js";

/** /api/nodes/*、/api/quiz/*：节点编辑与节点题 */
export const nodesRouter = Router();

nodesRouter.patch("/api/nodes/:id", (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: "node not found" });
  if (typeof req.body?.freeMd === "string") updateNodeMd(node.id, req.body.freeMd);
  if (typeof req.body?.hidden === "boolean") {
    setNodeHidden(node.id, req.body.hidden ? 1 : 0);
  }
  res.json({ ok: true });
});

nodesRouter.get("/api/nodes/:id/quiz", async (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: "node not found" });
  // 只读：打开节点不再偷偷用定义生成题目。旧定义题只能在复习模式里显式生成。
  const quizzes = listQuizzes(node.id);
  res.json({
    quizzes: quizzes.map(({ answer, ...q }) => q),
    passed: countPassed(node.id),
    tier: computeTier(node.id),
    status: quizzes.length ? "ready" : "idle",
  });
});

nodesRouter.post("/api/nodes/:id/quiz/generate", async (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: "node not found" });
  if (!listQuizzes(node.id).length) {
    const items = await llm.generateQuiz({
      name: node.name,
      md: `定义：${node.definition || "（暂无）"}\n笔记：${node.free_md}`,
    });
    createQuizzes(node.id, items);
  }
  res.json({
    quizzes: listQuizzes(node.id).map(({ answer, ...q }) => q),
    passed: countPassed(node.id),
    tier: computeTier(node.id),
    provider: llm.name,
  });
});

nodesRouter.post("/api/quiz/:id/answer", async (req, res) => {
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
