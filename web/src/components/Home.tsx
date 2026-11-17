import { useEffect, useMemo, useState } from "react";
import { get } from "../api";
import { useStore } from "../store";

type Overview = {
  id: string;
  tasks: number;
  lowQuality: number;
  attempts: number;
  correctRate: number;
  avgExplanationScore: number;
  cleared: number;
  dungeons: number;
  nodeCards: number;
  directions: number;
};

export default function Home() {
  const worlds = useStore((s) => s.worlds);
  const loadWorlds = useStore((s) => s.loadWorlds);
  const createWorld = useStore((s) => s.createWorld);
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [overviewList, setOverviewList] = useState<Overview[]>([]);
  const [sort, setSort] = useState<"recent" | "tasks" | "accuracy">("recent");
  const [q, setQ] = useState("");

  useEffect(() => {
    loadWorlds();
  }, [loadWorlds]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      get<{ worlds: Overview[] }>(
        `/api/learning/overview?sort=${sort}&q=${encodeURIComponent(q)}`,
      )
        .then((r) => setOverviewList(r.worlds))
        .catch(() => setOverviewList([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [sort, q, worlds.length]);

  const overviewById = useMemo(
    () => Object.fromEntries(overviewList.map((o) => [o.id, o])),
    [overviewList],
  );
  const orderedWorlds = useMemo(() => {
    if (!overviewList.length) return worlds;
    const byId = new Map(worlds.map((w) => [w.id, w]));
    return overviewList.map((o) => byId.get(o.id)).filter(Boolean) as typeof worlds;
  }, [overviewList, worlds]);

  return (
    <div className="home">
      <h1>知识世界</h1>
      <div className="sub">
        把口头理解变成可探索、可编辑、可挑战的知识地图 · MVP
      </div>
      <div className="world-controls">
        <input
          placeholder="搜索世界…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="搜索世界"
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="recent">最近创建</option>
          <option value="tasks">任务最多</option>
          <option value="accuracy">正确率最高</option>
        </select>
      </div>
      <div className="world-grid">
        {orderedWorlds.map((w) => (
          <div className="world-card" key={w.id} onClick={() => useStore.getState().openWorld(w.id)}>
            <h3>
              {w.name}
              {w.is_demo ? <span className="demo">示例数据</span> : null}
            </h3>
            <div className="meta">
              {new Date(w.created_at).toLocaleString()} · 点击进入
            </div>
            {overviewById[w.id] && (
              <div className="hintline" style={{ marginTop: 4 }}>
                任务 {overviewById[w.id].tasks} · 正确率{" "}
                {Math.round(overviewById[w.id].correctRate * 100)}% · 通关{" "}
                {overviewById[w.id].cleared}/{overviewById[w.id].dungeons}
                {overviewById[w.id].lowQuality > 0
                  ? ` · 低质量 ${overviewById[w.id].lowQuality}`
                  : ""}
              </div>
            )}
          </div>
        ))}
        <div className="create-card">
          <input
            placeholder="世界名称（例如：AI 产品学习）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            placeholder="初始节点名称（例如：RAG）"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
          />
          <button
            onClick={async () => {
              if (!name.trim() || !root.trim()) return;
              await createWorld(name.trim(), root.trim());
              setName("");
              setRoot("");
            }}
          >
            新建世界
          </button>
        </div>
      </div>
      <p className="hintline" style={{ marginTop: 26 }}>
        空世界从初始节点开始；说或写一段理解，节点会自动落图。示例世界用于演示，
        不代表空世界的发现率。
      </p>
    </div>
  );
}
