import { Router } from "express";
import {
  calibrationReport,
  learningCsv,
  learningOverview,
  learningStats,
  learningTrend,
} from "../services/learningStats.js";

export const learningStatsRouter = Router();

learningStatsRouter.get("/api/worlds/:id/learning/calibration", (req, res) => {
  res.json(calibrationReport(req.params.id));
});

learningStatsRouter.get("/api/learning/overview", (req, res) => {
  const sortRaw = String(req.query.sort ?? "recent");
  const sort = ["recent", "tasks", "accuracy"].includes(sortRaw)
    ? (sortRaw as "recent" | "tasks" | "accuracy")
    : "recent";
  res.json({ worlds: learningOverview({ sort, q: String(req.query.q ?? "") }) });
});

learningStatsRouter.get("/api/worlds/:id/learning/stats", (req, res) => {
  res.json(learningStats(req.params.id));
});

learningStatsRouter.get("/api/worlds/:id/learning/trend", (req, res) => {
  const days = Number(req.query.days ?? 7);
  res.json({ days: learningTrend(req.params.id, Number.isFinite(days) ? days : 7) });
});

learningStatsRouter.get("/api/worlds/:id/learning/export", (req, res) => {
  const days = Number(req.query.days ?? 30);
  res.type("text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="learning-${req.params.id.slice(0, 8)}-${days}d.csv"`,
  );
  res.send(learningCsv(req.params.id, Number.isFinite(days) ? days : 30));
});
