import { useEffect, useState } from "react";
import { get } from "../api";

type Stats = {
  tasks: { total: number; lowQuality: number; byKind: Record<string, number> };
  attempts: { total: number; correct: number; rate: number; avgExplanationScore: number };
  cards: { nodeOpen: number; relationOpen: number };
  directions: number;
  dungeons: { cleared: number; playable: number; total: number };
  lowQualityTasks: { id: string; score: number; flags: string[] }[];
};

/** 学习指标：默认不占主界面，点开才看；避免把地图变成仪表盘。 */
export default function LearningStatsPanel({ worldId }: { worldId: string }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setStats(await get<Stats>(`/api/worlds/${worldId}/learning/stats`));
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open, worldId]);

  return (
    <>
      <button className="ghost-btn" style={{ marginLeft: "auto" }} onClick={() => setOpen((v) => !v)}>
        {open ? "收起指标" : "学习指标"}
      </button>
      {open && (
        <div
          className="learning-stats"
          style={{
            position: "fixed",
            top: 64,
            right: 16,
            width: 300,
            zIndex: 30,
            background: "rgba(255,253,247,.98)",
            border: "1px solid #e2d8c6",
            borderRadius: 12,
            padding: 14,
            fontSize: 12,
            color: "#5c5142",
            boxShadow: "0 8px 30px rgba(80,60,30,.12)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
            <b style={{ fontSize: 13 }}>学习指标</b>
            <button className="ghost-btn" style={{ marginLeft: "auto" }} onClick={load} disabled={loading}>
              刷新
            </button>
          </div>
          {!stats ? (
            <div className="hintline">{loading ? "读取中…" : "暂无数据"}</div>
          ) : (
            <>
              <div className="hintline">
                任务 {stats.tasks.total} · 低质量 {stats.tasks.lowQuality}
              </div>
              <div className="hintline">
                作答 {stats.attempts.total} · 正确 {stats.attempts.correct} · 正确率{" "}
                {Math.round(stats.attempts.rate * 100)}%
              </div>
              <div className="hintline">平均解释分 {stats.attempts.avgExplanationScore}/100</div>
              <div className="hintline" style={{ marginTop: 6 }}>
                卡片：节点 {stats.cards.nodeOpen} · 关系 {stats.cards.relationOpen}
              </div>
              <div className="hintline">方向探索 {stats.directions}</div>
              <div className="hintline">
                副本：通关 {stats.dungeons.cleared} · 可挑战 {stats.dungeons.playable} · 共{" "}
                {stats.dungeons.total}
              </div>
              {stats.tasks.byKind && Object.keys(stats.tasks.byKind).length > 0 && (
                <div className="hintline" style={{ marginTop: 6 }}>
                  题型：{Object.entries(stats.tasks.byKind).map(([k, v]) => `${k} ${v}`).join(" · ")}
                </div>
              )}
              {stats.lowQualityTasks.length > 0 && (
                <div className="hintline" style={{ marginTop: 6, color: "#9a4f2f" }}>
                  低质量题 {stats.lowQualityTasks.length} 条：
                  {stats.lowQualityTasks.slice(0, 3).map((t) => ` ${t.score}分(${t.flags.join("/")})`).join("；")}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
