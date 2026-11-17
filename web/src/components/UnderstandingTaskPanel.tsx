import { useState } from "react";
import { get, send } from "../api";
import { track } from "../telemetry";

type TaskPayload = {
  status: string;
  message?: string;
  task: {
    id: string;
    stem: string;
    misconception: string;
    choices: { id: string; text: string }[];
    rubric: string[];
    evidence_quote: string;
    follow_up: string;
  } | null;
};

/** 通用辨析任务面板：关系卡/节点卡共用；无源不出事实题。 */
export default function UnderstandingTaskPanel({
  endpoint,
  worldId,
  targetId,
}: {
  endpoint: string;
  worldId?: string | null;
  targetId: string;
}) {
  const [payload, setPayload] = useState<TaskPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [choice, setChoice] = useState("");
  const [explanation, setExplanation] = useState("");
  const [feedback, setFeedback] = useState("");
  const [variant, setVariant] = useState("boundary");

  async function load(nextVariant = "boundary") {
    setLoading(true);
    setFeedback("");
    setVariant(nextVariant);
    setChoice("");
    setExplanation("");
    try {
      const p = await get<TaskPayload>(`${endpoint}?variant=${nextVariant}`);
      setPayload(p);
      track("understanding_task_start", {
        worldId,
        targetId,
        payload: { status: p.status, variant: nextVariant },
      });
    } catch {
      setPayload({ status: "failed", message: "任务生成失败", task: null });
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    const task = payload?.task;
    if (!task || !choice) return;
    const r = await send<{ correct: boolean; feedback: string; follow_up: string }>(
      `/api/understanding/${task.id}/answer`,
      "POST",
      { choice, explanation },
    );
    setFeedback(
      `${r.correct ? "判断正确" : "再想想"}：${r.feedback}${r.follow_up ? `\n追问：${r.follow_up}` : ""}`,
    );
    track("understanding_task_answer", { worldId, targetId: task.id, payload: { correct: r.correct } });
  }

  return (
    <div className="section">
      <h4>辨析任务</h4>
      {!payload ? (
        <button className="secondary" onClick={() => load("boundary")} disabled={loading}>
          生成一个辨析任务
        </button>
      ) : payload.status === "source_required" ? (
        <div className="hintline">{payload.message}</div>
      ) : payload.status !== "ready" || !payload.task ? (
        <div className="hintline">{payload.message ?? "任务生成失败"}</div>
      ) : (
        <>
          <div className="hintline" style={{ marginBottom: 6 }}>
            目标：辨析类型/边界，而不是背定义。
          </div>
          {payload.task.misconception && (
            <div className="hintline">易错点：{payload.task.misconception}</div>
          )}
          {payload.task.evidence_quote && <blockquote>依据：{payload.task.evidence_quote}</blockquote>}
          <div className="q" style={{ marginTop: 6 }}>
            {payload.task.stem}
          </div>
          {payload.task.choices.map((c) => (
            <label key={c.id} className="hintline" style={{ display: "block", marginTop: 4 }}>
              <input
                type="radio"
                name={`choice-${payload.task!.id}`}
                checked={choice === c.id}
                onChange={() => setChoice(c.id)}
              />{" "}
              {c.text}
            </label>
          ))}
          <textarea
            className="md-edit"
            style={{ marginTop: 6 }}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="用原文说明理由、边界，为什么不是相邻类型…"
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="primary" onClick={submit} disabled={!choice || explanation.trim().length < 4}>
              提交辨析
            </button>
          </div>
          <div className="row" style={{ marginTop: 6, gap: 6 }}>
            <button className="secondary" onClick={() => load("counterexample")} disabled={loading}>
              换个反例题
            </button>
            <button className="secondary" onClick={() => load("error_correction")} disabled={loading}>
              换个纠错题
            </button>
            <button className="secondary" onClick={() => load("transfer")} disabled={loading}>
              换个迁移题
            </button>
            <span className="hintline">当前：{variant}</span>
          </div>
          {feedback && (
            <div className="hintline" style={{ whiteSpace: "pre-wrap" }}>
              {feedback}
            </div>
          )}
        </>
      )}
    </div>
  );
}
