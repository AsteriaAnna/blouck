import { Router } from "express";
import { summarizeEvents, trackEvent } from "../db/events.js";

/** 本地单用户指标：前端 fire-and-forget 上报，不做鉴权。 */
export const eventsRouter = Router();

eventsRouter.post("/api/events", (req, res) => {
  const raw = Array.isArray(req.body?.events) ? req.body.events : [req.body];
  const out = [];
  for (const e of raw.slice(0, 50)) {
    const type = String(e?.type ?? "").trim();
    if (!type) continue;
    out.push(
      trackEvent({
        worldId: e?.worldId ? String(e.worldId) : null,
        type,
        targetId: e?.targetId ? String(e.targetId) : null,
        payload: e?.payload ?? {},
      }),
    );
  }
  res.json({ ok: true, count: out.length });
});

eventsRouter.get("/api/worlds/:id/events/summary", (req, res) => {
  res.json(summarizeEvents(req.params.id));
});
