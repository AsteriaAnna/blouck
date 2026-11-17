import { useState } from "react";
import { useStore } from "../store";
import { useVoiceInput } from "../hooks/useVoiceInput";

const STEPS = [
  { key: "listening", label: "聆听" },
  { key: "detecting", label: "检测" },
  { key: "confirming", label: "确认" },
  { key: "generating", label: "生成" },
] as const;

function stageIndex(stage: string) {
  if (stage === "idle") return -1;
  if (stage === "done") return STEPS.length;
  return STEPS.findIndex((s) => s.key === stage);
}

/** 输入条：文本提交 + 语音状态展示；音频/WS 状态机在 useVoiceInput。 */
export default function InputBar() {
  const extract = useStore((s) => s.extract);
  const partial = useStore((s) => s.partial);
  const streamText = useStore((s) => s.streamText);
  const mentions = useStore((s) => s.mentions);
  const ghosts = useStore((s) => s.ghosts);
  const stage = useStore((s) => s.stage);
  const nodes = useStore((s) => s.nodes);
  const busy = useStore((s) => s.busy);
  const setMentions = useStore((s) => s.setMentions);
  const clearStream = useStore((s) => s.clearStream);
  const { rec, state, micError, startMic, stopRec, startMock, matchMentions, setState } =
    useVoiceInput();
  const [text, setText] = useState("");

  function submit() {
    if (!text.trim() || busy) return;
    clearStream();
    setMentions(matchMentions(text.trim()));
    void extract(text.trim());
    setText("");
    setState("已提交");
  }

  const active = stageIndex(stage);
  const showStream = stage !== "idle" || Boolean(streamText) || ghosts.length > 0 || mentions.length > 0;

  return (
    <div className="inputbar">
      {showStream && (
        <div className="stream-panel">
          <div className="stream-steps">
            {STEPS.map((s, i) => (
              <div key={s.key} className={"stream-step" + (i < active ? " done" : i === active ? " active" : "")}>
                <span className="dot" />
                {s.label}
              </div>
            ))}
          </div>
          {streamText && (
            <div className="stream-caption">
              {streamText}
              {rec && <span className="caret" />}
            </div>
          )}
          {(mentions.length > 0 || ghosts.length > 0) && (
            <div className="stream-entities">
              {mentions.map((id) => {
                const n = nodes.find((x) => x.id === id);
                return n ? (
                  <span key={id} className="entity-chip known">
                    <i />已识别 · {n.name}
                  </span>
                ) : null;
              })}
              {ghosts.map((g, i) => (
                <span key={`${g.name}-${i}`} className="entity-chip ghost">
                  <i />候选 · {g.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {partial && <div className="partial">{partial}</div>}
      {micError && (
        <div className="partial">
          麦克风不可用：{micError}
          <button className="secondary" style={{ marginLeft: 8 }} onClick={startMock}>
            用模拟语音体验
          </button>
        </div>
      )}
      <button className={"mic" + (rec ? " rec" : "")} title={rec ? "停止录音" : "实时语音"} onClick={() => (rec ? stopRec() : startMic())}>
        {rec ? "■" : "🎙"}
      </button>
      <button className="mock-btn" onClick={startMock} title="模拟一段语音，体验流式生成">
        试听
      </button>
      <textarea
        placeholder="说点什么，或写下你此刻的理解…（Ctrl/⌘ + Enter 提交）"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      />
      <div className="state">{busy ? "生成中…" : state}</div>
      <button className="send" onClick={submit} title="提交">
        ↑
      </button>
    </div>
  );
}

