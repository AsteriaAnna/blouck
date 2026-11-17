import { Router } from "express";
import { learningStats, learningTrend } from "../services/learningStats.js";

export const learningStatsRouter = Router();

learningStatsRouter.get("/api/worlds/:id/learning/stats", (req, res) => {
  res.json(learningStats(req.params.id));
});

learningStatsRouter.get("/api/worlds/:id/learning/trend", (req, res) => {
  const days = Number(req.query.days ?? 7);
  res.json({ days: learningTrend(req.params.id, Number.isFinite(days) ? days : 7) });
});
