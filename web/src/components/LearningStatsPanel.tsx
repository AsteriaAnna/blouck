import { useEffect, useState } from "react";
import { get } from "../api";

type Stats = {
  tasks: { total: number; lowQuality: number; byKind: Record<string, number> };
  attempts: { total: number; correct: number; rate: number; avgExplanationScore: number };
  cards: { nodeOpen: number; relationOpen: number };
  directions: number;
  dungeons: { cleared: number; playable: number; total: number };
  reviews: { good: number; bad: number };
  lowQualityTasks: { id: string; score: number; flags: string[] }[];
};

type TrendPoint = {
  day: string;
  attempts: number;
  correct: number;
  avgExplanation: number;
  tasks: number;
  nodeCards: number;
  directions: number;
};

type Calibration = {
  good: number;
  bad: number;
  avgGood: number;
  avgBad: number;
  mismatchGoodLow: number;
  mismatchBadHigh: number;
  suggestedThreshold: number;
};

/** 学习指标：默认不占主界面，点开才看；避免把地图变成仪表盘。 */
export default function LearningStatsPanel({ worldId }: { worldId: string }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [s, t, c] = await Promise.all([
        get<Stats>(`/api/worlds/${worldId}/learning/stats`),
        get<{ days: TrendPoint[] }>(`/api/worlds/${worldId}/learning/trend?days=7`),
        get<Calibration>(`/api/worlds/${worldId}/learning/calibration`),
      ]);
      setStats(s);
      setTrend(t.days ?? []);
      setCal(c);
    } catch {
      setStats(null);
      setTrend([]);
      setCal(null);
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
            <button
              className="ghost-btn"
              style={{ marginLeft: "auto", marginRight: 6 }}
              onClick={() => window.open(`/api/worlds/${worldId}/learning/export?days=30`, "_blank")}
            >
              导出 CSV
            </button>
            <button className="ghost-btn" onClick={load} disabled={loading}>
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
              {stats.reviews.good + stats.reviews.bad > 0 && (
                <div className="hintline">
                  人工反馈：好题 {stats.reviews.good} · 差题 {stats.reviews.bad}
                </div>
              )}
              {cal && cal.good + cal.bad > 0 && (
                <div className="hintline">
                  校准：好题均分 {cal.avgGood} · 差题均分 {cal.avgBad}
                  {cal.mismatchBadHigh > 0 ? ` · 高分差题 ${cal.mismatchBadHigh}` : ""}
                  {cal.mismatchGoodLow > 0 ? ` · 低分好题 ${cal.mismatchGoodLow}` : ""}
                  {` · 建议阈值 ${cal.suggestedThreshold}`}
                </div>
              )}
              {stats.tasks.byKind && Object.keys(stats.tasks.byKind).length > 0 && (
                <div className="hintline" style={{ marginTop: 6 }}>
                  题型：{Object.entries(stats.tasks.byKind).map(([k, v]) => `${k} ${v}`).join(" · ")}
                </div>
              )}
              {trend.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="hintline">近 7 日</div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      gap: 4,
                      height: 32,
                      margin: "4px 0",
                    }}
                  >
                    {trend.map((d) => {
                      const max = Math.max(1, ...trend.map((x) => x.attempts));
                      const h = d.attempts ? Math.max(3, Math.round((d.attempts / max) * 30)) : 2;
                      return (
                        <div
                          key={d.day}
                          title={`${d.day} 答题 ${d.attempts} · 卡片 ${d.nodeCards} · 方向 ${d.directions}`}
                          style={{
                            width: 18,
                            height: h,
                            background: d.attempts ? "#6f6252" : "#e6ddcf",
                            borderRadius: 3,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="hintline">
                    答题 {trend.reduce((n, d) => n + d.attempts, 0)} · 正确{" "}
                    {trend.reduce((n, d) => n + d.correct, 0)} · 卡片{" "}
                    {trend.reduce((n, d) => n + d.nodeCards, 0)} · 方向{" "}
                    {trend.reduce((n, d) => n + d.directions, 0)}
                  </div>
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
