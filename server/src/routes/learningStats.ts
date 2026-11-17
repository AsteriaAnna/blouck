import { Router } from "express";
import { learningStats } from "../services/learningStats.js";

export const learningStatsRouter = Router();

learningStatsRouter.get("/api/worlds/:id/learning/stats", (req, res) => {
  res.json(learningStats(req.params.id));
});
