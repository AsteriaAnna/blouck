import { db, getGraph } from "../db.js";

/**
 * V3 提示池：suggest 关系按置信度/新近/邻居热度打分，只给 top-k 地图显示。
 * 这是确定性的后端排序；前端不再自己猜。
 */
export function refreshHintDisplay(worldId: string, limit = 2): void {
  const rows = db
    .prepare(
      "SELECT id, confidence, created_at, src, dst FROM edges WHERE world_id=? AND kind='suggest'",
    )
    .all(worldId) as { id: string; confidence: number; created_at: number; src: string; dst: string }[];
  if (!rows.length) return;
  const graph = getGraph(worldId);
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.kind !== "formal") continue;
    degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
  }
  const now = Date.now();
  const scored = rows
    .map((e) => {
      const conf = Math.max(0, Math.min(1, e.confidence ?? 0));
      const recency = 1 / (1 + Math.max(0, now - e.created_at) / (1000 * 60 * 60 * 24 * 7));
      const heat = Math.min(1, ((degree.get(e.src) ?? 0) + (degree.get(e.dst) ?? 0)) / 8);
      return { id: e.id, score: conf * 0.65 + recency * 0.15 + heat * 0.2 };
    })
    .sort((a, b) => b.score - a.score);

  const stmt = db.prepare("UPDATE edges SET hint_score=?, hint_display=? WHERE id=?");
  db.exec("BEGIN");
  try {
    for (const r of scored) stmt.run(r.score, 0, r.id);
    const shown = scored.slice(0, Math.max(0, limit));
    for (const r of shown) db.prepare("UPDATE edges SET hint_display=1 WHERE id=?").run(r.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
