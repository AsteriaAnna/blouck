import { useEffect, useRef, useState } from "react";
import { send } from "../api";
import { useStore } from "../store";

/** AudioWorklet：把麦克风 Float32 采样转成 Int16 PCM 块 */
const WORKLET_SRC = `
class PCMWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      const pcm = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PCMWorklet);
`;

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

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

/** 麦克风采集 → 16k PCM16 → WS；失败时可切"模拟语音" */
export default function InputBar() {
  const extract = useStore((s) => s.extract);
  const partial = useStore((s) => s.partial);
  const setPartial = useStore((s) => s.setPartial);
  const streamText = useStore((s) => s.streamText);
  const mentions = useStore((s) => s.mentions);
  const ghosts = useStore((s) => s.ghosts);
  const stage = useStore((s) => s.stage);
  const setMentions = useStore((s) => s.setMentions);
  const setGhosts = useStore((s) => s.setGhosts);
  const setStage = useStore((s) => s.setStage);
  const clearStream = useStore((s) => s.clearStream);
  const nodes = useStore((s) => s.nodes);
  const busy = useStore((s) => s.busy);
  const worldId = useStore((s) => s.world?.id);
  const focusId = useStore((s) => s.focusId);
  const [text, setText] = useState("");
  const [rec, setRec] = useState(false);
  const [state, setState] = useState("待输入");
  const [micError, setMicError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const previewTimer = useRef<number | null>(null);
  const lastDetectLenRef = useRef(0);
  const previewBusyRef = useRef(false);
  const mentionIdsRef = useRef<string[]>([]);
  const sessionRef = useRef(0);

  useEffect(() => {
    return () => {
      stopTracks();
      wsRef.current?.close();
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    };
  }, []);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      nodeRef.current?.disconnect();
      ctxRef.current?.close();
    } catch {}
    nodeRef.current = null;
    ctxRef.current = null;
  }

  function matchMentions(input: string) {
    const found: { id: string; name: string }[] = [];
    for (const n of nodes) {
      const names = [n.name];
      try {
        const aliases = JSON.parse(n.aliases || "[]");
        if (Array.isArray(aliases)) names.push(...aliases.map(String));
      } catch {}
      for (const name of names) {
        if (name && name.length >= 2 && input.includes(name)) {
          found.push({ id: n.id, name });
          break;
        }
      }
    }
    found.sort((a, b) => b.name.length - a.name.length);
    return [...new Set(found.map((x) => x.id))];
  }

  function resetStream() {
    sessionRef.current += 1;
    setMentions([]);
    setGhosts([]);
    setStage("listening");
    mentionIdsRef.current = [];
    lastDetectLenRef.current = 0;
    previewBusyRef.current = false;
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = null;
  }

  async function requestPreview(spoken: string, force = false) {
    if (!worldId || (!force && spoken.length < 10)) return;
    if (previewBusyRef.current) {
      if (!force) return;
      for (let i = 0; i < 80 && previewBusyRef.current; i++) {
        await new Promise((r) => window.setTimeout(r, 50));
      }
      if (previewBusyRef.current) return;
    }
    previewBusyRef.current = true;
    const session = sessionRef.current;
    setStage("detecting");
    try {
      const r = await send<{ candidates: { name: string; evidence?: string }[] }>(
        `/api/worlds/${worldId}/stream/detect`,
        "POST",
        { text: spoken, anchorId: focusId },
      );
      if (session !== sessionRef.current) return;
      const state = useStore.getState();
      if (!force && !state.busy && state.stage !== "detecting" && state.stage !== "confirming") return;
      const existingNames = new Set(useStore.getState().nodes.map((n) => n.name));
      const incoming = (r.candidates ?? []).filter((c) => c.name && !existingNames.has(c.name));
      const merged = new Map(useStore.getState().ghosts.map((g) => [g.name, g]));
      for (const c of incoming) {
        if (!merged.has(c.name)) {
          merged.set(c.name, { name: c.name, role: "", action: "detected", label: "实体检测" });
        }
      }
      setGhosts([...merged.values()]);
      if (merged.size) setStage("confirming");
    } catch {
      // 检测失败不阻塞主链路
    } finally {
      previewBusyRef.current = false;
    }
  }

  function schedulePreview(spoken: string) {
    if (spoken.length < 10 || previewBusyRef.current) return;
    if (spoken.length - lastDetectLenRef.current < 6) return;
    if (previewTimer.current) return;
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;
      lastDetectLenRef.current = spoken.length;
      void requestPreview(spoken);
    }, 150);
  }

  function connectWS(mock: boolean) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/asr`);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: mock ? "mock" : "start" }));
      setRec(true);
      setState(mock ? "模拟语音中…" : "录音中…");
    };
    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "partial") {
        setPartial(msg.text);
        setStage("detecting");
        const ids = matchMentions(msg.text);
        mentionIdsRef.current = ids;
        setMentions(ids);
        schedulePreview(msg.text);
        setState("识别中…");
      } else if (msg.type === "final") {
        setRec(false);
        setPartial("");
        setStreamTextFinal(msg.text);
        setStage("confirming");
        setState("已稳定 · 正在确认");
        ws.close();
        if (previewTimer.current) window.clearTimeout(previewTimer.current);
        previewTimer.current = null;
        const ids = matchMentions(msg.text);
        mentionIdsRef.current = ids;
        setMentions(ids);
        void (async () => {
          await requestPreview(msg.text, true);
          await extract(msg.text);
        })();
      } else if (msg.type === "segment") {
        setStreamTextFinal(msg.text);
        setStage("confirming");
        setState("本句已确认 · 继续说话，或再点一次结束");
      } else if (msg.type === "error") {
        setRec(false);
        setMicError(String(msg.message ?? "语音识别失败"));
        setState("识别失败");
        setStage("idle");
        stopTracks();
      } else if (msg.type === "ready") {
        setState((prev) => (prev.includes("录音中") ? prev : `已连接（${msg.provider}）`));
      }
    };
    ws.onerror = () => {
      setRec(false);
      setState("语音连接失败");
      setStage("idle");
      stopTracks();
    };
    return ws;
  }

  function setStreamTextFinal(text: string) {
    useStore.getState().setStreamText(text);
  }

  async function startMic() {
    if (!worldId) return;
    setMicError("");
    setState("请求麦克风…");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err: any) {
      setMicError(err?.message ?? "无法访问麦克风");
      setState("无法录音");
      return;
    }
    streamRef.current = stream;
    clearStream();
    resetStream();

    const ctx = new AudioContext({ sampleRate: 16000 });
    ctxRef.current = ctx;
    try {
      const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setMicError("AudioWorklet 初始化失败：" + (err?.message ?? ""));
      stopTracks();
      return;
    }

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-worklet");
    nodeRef.current = node;
    source.connect(node);

    const ws = connectWS(false);
    const inRate = ctx.sampleRate;
    const ratio = inRate / 16000;
    let carry = new Float32Array(0);
    let carryPos = 0;

    node.port.onmessage = (ev) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const block = new Float32Array(ev.data);
      if (ratio === 1) {
        const pcm = new Int16Array(block.length);
        for (let i = 0; i < block.length; i++) {
          const s = Math.max(-1, Math.min(1, block[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        flush(pcm);
        return;
      }
      const merged = new Float32Array(carry.length + block.length);
      merged.set(carry, 0);
      merged.set(block, carry.length);
      carry = merged;
      const res: number[] = [];
      let idx = carryPos;
      while (idx + 1 < carry.length) {
        const i0 = Math.floor(idx);
        const frac = idx - i0;
        const s = carry[i0] * (1 - frac) + carry[i0 + 1] * frac;
        res.push(Math.max(-32768, Math.min(32767, s * 32767)));
        idx += ratio;
      }
      carryPos = idx;
      const drop = Math.floor(carryPos);
      if (drop > 0) {
        carry = carry.slice(drop);
        carryPos -= drop;
      }
      if (res.length) flush(new Int16Array(res));
    };

    let pending: Int16Array[] = [];
    let pendingLen = 0;
    function flush(pcm: Int16Array) {
      pending.push(pcm);
      pendingLen += pcm.length;
      while (pendingLen >= 3200) {
        const buf = new Int16Array(3200);
        let filled = 0;
        while (filled < 3200) {
          const head = pending[0];
          const take = Math.min(head.length, 3200 - filled);
          buf.set(head.subarray(0, take), filled);
          filled += take;
          if (take === head.length) pending.shift();
          else pending[0] = head.subarray(take);
        }
        pendingLen -= 3200;
        ws.send(JSON.stringify({ type: "audio", chunk: toBase64(buf.buffer) }));
      }
    }
  }

  function stopRec() {
    setState("正在等待最终结果…");
    setStage("confirming");
    try {
      nodeRef.current?.disconnect();
    } catch {}
    stopTracks();
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    setRec(false);
  }

  function startMock() {
    setMicError("");
    clearStream();
    resetStream();
    connectWS(true);
  }

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
