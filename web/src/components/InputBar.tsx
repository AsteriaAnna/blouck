import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

/** 底部输入台：实时语音（豆包流式预留位，mock 可跑）+ 文字提交 */
export default function InputBar() {
  const extract = useStore((s) => s.extract);
  const partial = useStore((s) => s.partial);
  const setPartial = useStore((s) => s.setPartial);
  const busy = useStore((s) => s.busy);
  const worldId = useStore((s) => s.world?.id);
  const [text, setText] = useState("");
  const [rec, setRec] = useState(false);
  const [state, setState] = useState("待输入");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  function startRec() {
    if (!worldId) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/asr`);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start" }));
      setRec(true);
      setState("录音中（mock 流式）");
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "partial") {
        setPartial(msg.text);
        setState("识别中…");
      } else if (msg.type === "final") {
        setRec(false);
        setPartial("");
        setState("已稳定 · 正在抽取");
        ws.close();
        extract(msg.text);
        setText("");
      } else if (msg.type === "error") {
        setRec(false);
        setState("识别失败：" + msg.message);
      } else if (msg.type === "ready") {
        setState(`已连接（${msg.provider}）`);
      }
    };
    ws.onerror = () => {
      setRec(false);
      setState("语音连接失败");
    };
  }

  function stopRec() {
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    setRec(false);
  }

  function submit() {
    if (!text.trim() || busy) return;
    extract(text.trim());
    setText("");
    setState("已提交");
  }

  return (
    <div className="inputbar">
      {partial && <div className="partial">{partial}</div>}
      <button
        className={"mic" + (rec ? " rec" : "")}
        title={rec ? "停止" : "实时语音"}
        onClick={() => (rec ? stopRec() : startRec())}
      >
        {rec ? "■" : "🎙"}
      </button>
      <textarea
        placeholder="说点什么，或写下你此刻的理解…（Ctrl/⌘ + Enter 提交）"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      />
      <div className="state">{busy ? "处理中…" : state}</div>
      <button className="send" onClick={submit} title="提交">
        ↑
      </button>
    </div>
  );
}
