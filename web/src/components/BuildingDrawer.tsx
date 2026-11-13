import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useStore } from "../store";

/** 副本抽屉：领域副本（每日 10 题） / 流程副本（排序连线） */
export default function BuildingDrawer() {
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

  useEffect(() => {
    setOrder([]);
    setAnswers({});
  }, [drawer?.id]);

  if (!building) return null;
  const steps: string[] = challenge?.steps ?? [];
  const questions: { id: string; prompt: string }[] = challenge?.questions ?? [];

  return (
    <div className="drawer">
      <header>
        <div className="k">
          建筑 · {building.kind === "flow" ? "流程副本" : "领域副本"} ·{" "}
          {building.status === "cleared" ? "已通关" : building.status === "locked" ? "未解锁" : "可挑战"}
        </div>
        <h2>{building.title}</h2>
        <div className="hintline">{building.sub}</div>
        <button className="close" onClick={closeDrawer}>
          ×
        </button>
      </header>
      <div className="body">
        {challenge?.error && (
          <div className="section">
            <div className="hintline">{challenge.error}</div>
            <button className="primary" style={{ marginTop: 10 }} onClick={() => startChallenge(building.id)}>
              重试
            </button>
          </div>
        )}

        {!challenge?.error && building.kind === "flow" && (
          <div className="section">
            <h4>连线题：按正确顺序点击步骤</h4>
            <div className="order">
              {order.length ? order.join(" → ") : "还没有选择步骤"}
            </div>
            <div className="steps" style={{ marginTop: 10 }}>
              {steps
                .filter((s) => !order.includes(s))
                .map((s) => (
                  <button key={s} className="step" onClick={() => setOrder([...order, s])}>
                    {s}
                  </button>
                ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" onClick={() => submitFlow(building.id, order)}>
                提交顺序
              </button>
              <button className="secondary" onClick={() => setOrder([])}>
                清空
              </button>
            </div>
          </div>
        )}

        {!challenge?.error && building.kind === "domain" && (
          <div className="section">
            <h4>每日练习（最多 10 题，判断）</h4>
            {questions.length === 0 ? (
              <div className="hintline">题目准备中或今日额度已用完。</div>
            ) : (
              questions.map((q) => (
                <div className="quiz" key={q.id}>
                  <div className="kind">判断</div>
                  <div className="q">{q.prompt}</div>
                  <div className="ans">
                    <button
                      className="secondary"
                      onClick={() => setAnswers({ ...answers, [q.id]: "对" })}
                      style={{ outline: answers[q.id] === "对" ? "2px solid #2a2620" : "none" }}
                    >
                      对
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setAnswers({ ...answers, [q.id]: "错" })}
                      style={{ outline: answers[q.id] === "错" ? "2px solid #2a2620" : "none" }}
                    >
                      错
                    </button>
                  </div>
                </div>
              ))
            )}
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
            <div className="hintline" style={{ marginTop: 8 }}>
              领域题按 MVP 建议先不计节点三档，避免重复记功。
            </div>
          </div>
        )}

        <div className="section">
          <h4>副本说明（可编辑 MD）</h4>
          <div className="md-preview">
            <ReactMarkdown>{building.md || ""}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
