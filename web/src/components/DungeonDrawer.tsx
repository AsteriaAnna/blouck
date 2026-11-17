import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useStore } from "../store";

/** 副本抽屉：领域副本（每日 10 题）/ 流程副本（排序连线），MD 可编辑 */
export default function DungeonDrawer() {
  const drawer = useStore((s) => s.drawer);
  const buildings = useStore((s) => s.buildings);
  const challenge = useStore((s) => s.challenge);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const submitFlow = useStore((s) => s.submitFlow);
  const submitDomain = useStore((s) => s.submitDomain);
  const startChallenge = useStore((s) => s.startChallenge);

  const building = buildings.find((b) => b.id === (drawer?.kind === "building" ? drawer.id : ""));
  const [order, setOrder] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [md, setMd] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    setOrder([]);
    setAnswers({});
    setSaved("");
  }, [drawer?.id]);

  useEffect(() => {
    if (building) setMd(building.md ?? "");
  }, [building?.id, building?.md]);

  if (!building) return null;
  const steps: string[] = challenge?.steps ?? [];
  const questions: { id: string; prompt: string }[] = challenge?.questions ?? [];
  const daily = challenge?.daily as { used: number; limit: number } | undefined;
  const statusText =
    building.status === "cleared"
      ? "已通关"
      : building.status === "playable"
        ? "可挑战"
        : building.status === "stale"
          ? "依据待更新"
          : "已出现 · 未解锁";

  async function saveMd() {
    if (!building) return;
    const r = await fetch(`/api/buildings/${building.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ md }),
    });
    if (r.ok) {
      useStore.setState({
        buildings: buildings.map((b) => (b.id === building.id ? { ...b, md } : b)),
      });
      setSaved("已保存 " + new Date().toLocaleTimeString());
    } else {
      setSaved("保存失败");
    }
  }

  function toggleStep(id: string) {
    setOrder((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="drawer">
      <header>
        <div className="k">
          建筑 · {building.kind === "flow" ? "流程副本" : "领域副本"} · {statusText}
        </div>
        <h2>{building.title}</h2>
        <div className="hintline">{building.sub}</div>
        <button className="close" onClick={closeDrawer}>
          ×
        </button>
      </header>
      <div className="body">
        {(building.status === "locked" || building.status === "detected" || building.status === "stale") && (
          <div className="section">
            <div className="hintline">
              未解锁：{building.kind === "flow" ? "流程链上节点" : "锚点邻域"}至少 2 个当前达到第一档后可挑战。
            </div>
          </div>
        )}

        {building.status === "playable" && challenge?.error && (
          <div className="section">
            <div className="hintline">{challenge.error}</div>
          </div>
        )}

        {challenge && !challenge.error && building.kind === "flow" && (
          <div className="section">
            <h4>按正确顺序点击步骤</h4>
            <div className="steps">
              {steps.map((id) => {
                const node = useStore.getState().nodes.find((n) => n.id === id);
                const idx = order.indexOf(id);
                return (
                  <button
                    key={id}
                    className={"step-btn" + (idx >= 0 ? " on" : "")}
                    onClick={() => toggleStep(id)}
                  >
                    {idx >= 0 ? `${idx + 1}. ` : ""}
                    {node?.name ?? id}
                  </button>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="primary"
                disabled={order.length !== steps.length}
                onClick={() => submitFlow(building.id, order)}
              >
                提交顺序
              </button>
              <span className="hintline">共 {steps.length} 步</span>
            </div>
          </div>
        )}

        {challenge && !challenge.error && building.kind === "domain" && (
          <div className="section">
            <h4>
              今日题组 {daily ? `（${daily.used}/${daily.limit}）` : ""}
            </h4>
            {questions.map((q) => (
              <div key={q.id} className="quiz">
                <div className="q">{q.prompt}</div>
                <textarea
                  className="md-edit"
                  placeholder="填写/判断/解答"
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                />
              </div>
            ))}
            <div className="row">
              <button
                className="primary"
                onClick={() =>
                  submitDomain(
                    building.id,
                    Object.entries(answers).map(([id, answer]) => ({ id, answer })),
                  )
                }
              >
                提交
              </button>
              <button className="secondary" onClick={() => startChallenge(building.id)}>
                刷新题目
              </button>
            </div>
            <div className="hintline">领域题不改变节点三档，只记录副本通关。</div>
          </div>
        )}

        <div className="section">
          <h4>副本 MD（可编辑）</h4>
          <textarea
            className="md-edit"
            value={md}
            onChange={(e) => setMd(e.target.value)}
            placeholder="副本的背景、规则、来源…"
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={saveMd}>
              保存
            </button>
            <span className="hintline">{saved}</span>
          </div>
          {md.trim() && (
            <div className="md-preview" style={{ marginTop: 10 }}>
              <ReactMarkdown>{md}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
