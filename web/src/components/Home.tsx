import { useEffect, useState } from "react";
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
  const [overview, setOverview] = useState<Record<string, Overview>>({});

  useEffect(() => {
    loadWorlds();
  }, [loadWorlds]);

  useEffect(() => {
    get<{ worlds: Overview[] }>("/api/learning/overview")
      .then((r) => setOverview(Object.fromEntries(r.worlds.map((w) => [w.id, w]))))
      .catch(() => setOverview({}));
  }, [worlds.length]);

  return (
    <div className="home">
      <h1>知识世界</h1>
      <div className="sub">
        把口头理解变成可探索、可编辑、可挑战的知识地图 · MVP
      </div>
      <div className="world-grid">
        {worlds.map((w) => (
          <div className="world-card" key={w.id} onClick={() => useStore.getState().openWorld(w.id)}>
            <h3>
              {w.name}
              {w.is_demo ? <span className="demo">示例数据</span> : null}
            </h3>
            <div className="meta">
              {new Date(w.created_at).toLocaleString()} · 点击进入
            </div>
            {overview[w.id] && (
              <div className="hintline" style={{ marginTop: 4 }}>
                任务 {overview[w.id].tasks} · 正确率 {Math.round(overview[w.id].correctRate * 100)}% ·
                通关 {overview[w.id].cleared}/{overview[w.id].dungeons}
                {overview[w.id].lowQuality > 0 ? ` · 低质量 ${overview[w.id].lowQuality}` : ""}
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
