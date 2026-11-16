import { useEffect, useRef, useState } from "react";
import { send } from "../api";
import { useStore } from "../store";

/** AudioWorklet：把麦克风 Float32 采样转成 Int16 PCM 块 */
const WORKLET_SRC = `
class PCMWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.inRate = (options.processorOptions && options.processorOptions.sampleRate) || 48000;
    this.outRate = 16000;
    this.ratio = this.inRate / this.outRate;
    this.carry = new Float32Array(0);
    this.pos = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !ch.length) return true;
    const merged = new Float32Array(this.carry.length + ch.length);
    merged.set(this.carry, 0);
    merged.set(ch, this.carry.length);
    const out = [];
    let pos = this.pos;
    while (pos + 1 < merged.length) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      out.push(merged[i0] * (1 - frac) + merged[i0 + 1] * frac);
      pos += this.ratio;
    }
    const drop = Math.floor(pos);
    this.carry = merged.slice(drop);
    this.pos = pos - drop;
    if (out.length) {
      const pcm = new Int16Array(out.length);
      for (let i = 0; i < out.length; i++) {
        const s = Math.max(-1, Math.min(1, out[i]));
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
  const segmentsRef = useRef(0);
  const segmentQueueRef = useRef<Promise<void>>(Promise.resolve());
  const recordingRef = useRef(false);
  const stoppingRef = useRef(false);
  const finishOnceRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const pendingAudioRef = useRef<string[]>([]);
  const flushTailRef = useRef<null | (() => void)>(null);
  const lastAudioAtRef = useRef(0);
  const keepAliveRef = useRef<number | null>(null);
  const asrErrorCountRef = useRef(0);

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

  function enqueueSegment(text: string) {
    if (!text.trim()) return;
    segmentsRef.current += 1;
    segmentQueueRef.current = segmentQueueRef.current
      .then(() => useStore.getState().ingestSegment(text))
      .catch(() => null);
  }

  async function finishSession() {
    if (finishOnceRef.current) return;
    finishOnceRef.current = true;
    await segmentQueueRef.current;
    await useStore.getState().commitStream();
    recordingRef.current = false;
    stoppingRef.current = false;
    setRec(false);
  }

  function connectWS(mock: boolean) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/asr`);
    wsRef.current = ws;
    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      const hotwords = nodes.map((n) => n.name).filter(Boolean).slice(0, 80);
      ws.send(JSON.stringify({ type: mock ? "mock" : "start", hotwords }));
      // 立即发一点静音，避免 ASR 在等第一包音频时超时
      const silence = toBase64(new Int16Array(1600).buffer);
      ws.send(JSON.stringify({ type: "audio", chunk: silence }));
      lastAudioAtRef.current = Date.now();
      // 补发 WS ready 之前的早期音频
      const queued = pendingAudioRef.current.splice(0);
      for (const chunk of queued) ws.send(JSON.stringify({ type: "audio", chunk }));
      if (keepAliveRef.current) window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = window.setInterval(() => {
        if (wsRef.current?.readyState !== WebSocket.OPEN || !recordingRef.current) return;
        if (Date.now() - lastAudioAtRef.current < 1500) return;
        const chunk = toBase64(new Int16Array(1600).buffer);
        wsRef.current.send(JSON.stringify({ type: "audio", chunk }));
        lastAudioAtRef.current = Date.now();
      }, 1000);
      setRec(true);
      setState(mock ? "模拟语音中…" : "录音中…（再点一次结束）");
    };
    ws.onmessage = async (ev) => {
      if (wsRef.current !== ws) return;
      const msg = JSON.parse(ev.data);
      if (msg.type === "partial") {
        setPartial(msg.text);
        setStage("detecting");
        const ids = matchMentions(msg.text);
        mentionIdsRef.current = ids;
        setMentions(ids);
        setState("识别中…");
      } else if (msg.type === "segment") {
        setStreamTextFinal(msg.text);
        setPartial("");
        setStage("confirming");
        setState("本句已确认 · 继续说话，或再点一次结束");
        enqueueSegment(msg.text);
      } else if (msg.type === "final") {
        setPartial("");
        setStreamTextFinal(msg.text);
        setStage("confirming");
        if (stoppingRef.current || mock) {
          enqueueSegment(msg.text);
          setState("整段已确认 · 正在落图");
          void finishSession();
        } else {
          // ASR 认为当前 utterance 结束：只结算这一句，然后继续录音
          enqueueSegment(msg.text);
          setState("本句已确认 · 继续说话，或再点一次结束");
          try {
            ws.close();
          } catch {}
        }
      } else if (msg.type === "error") {
        if (recordingRef.current && !stoppingRef.current) {
          asrErrorCountRef.current += 1;
          if (asrErrorCountRef.current <= 2) {
            setState("语音会话超时，正在重连…");
            try { ws.close(); } catch {}
            return;
          }
        }
        setMicError(String(msg.message ?? "语音识别失败"));
        setState("识别失败");
        setStage("idle");
        recordingRef.current = false;
        stopTracks();
      } else if (msg.type === "ready") {
        asrErrorCountRef.current = 0;
        setState((prev) => (prev.includes("录音中") ? prev : `已连接（${msg.provider}）`));
      }
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      if (keepAliveRef.current) {
        window.clearInterval(keepAliveRef.current);
        keepAliveRef.current = null;
      }
      if (recordingRef.current && !stoppingRef.current) {
        // ASR 在句末关闭：保持录音，重连继续
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          if (recordingRef.current && !stoppingRef.current) connectWS(mock);
        }, 250);
      }
    };
    ws.onerror = () => {
      if (!recordingRef.current || stoppingRef.current) return;
      setState("语音连接中断，正在重连…");
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

    // 不强制 16k：原生采样率采集，AudioWorklet 内部重采样到 16k
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    await ctx.resume();
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
    const node = new AudioWorkletNode(ctx, "pcm-worklet", {
      processorOptions: { sampleRate: ctx.sampleRate },
    });
    nodeRef.current = node;
    source.connect(node);

    connectWS(false);

    node.port.onmessage = (ev) => {
      flush(new Int16Array(ev.data));
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
        const chunk = toBase64(buf.buffer);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "audio", chunk }));
          lastAudioAtRef.current = Date.now();
        } else if (pendingAudioRef.current.length < 100) {
          pendingAudioRef.current.push(chunk);
        }
      }
    }
    flushTailRef.current = () => {
      if (pendingLen > 0) {
        const tail = new Int16Array(pendingLen);
        let filled = 0;
        while (pending.length) {
          const head = pending.shift()!;
          tail.set(head.subarray(0, head.length), filled);
          filled += head.length;
        }
        pendingLen = 0;
        const chunk = toBase64(tail.buffer);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "audio", chunk }));
          lastAudioAtRef.current = Date.now();
        } else if (pendingAudioRef.current.length < 100) {
          pendingAudioRef.current.push(chunk);
        }
      }
      for (const chunk of pendingAudioRef.current.splice(0)) {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "audio", chunk }));
        }
      }
    };
  }

  function stopRec() {
    stoppingRef.current = true;
    setState("正在等待最终结果…");
    setStage("confirming");
    flushTailRef.current?.();
    try {
      nodeRef.current?.disconnect();
    } catch {}
    // 停止前补 300ms 静音，给 ASR 收尾时间
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: "audio", chunk: toBase64(new Int16Array(4800).buffer) }),
      );
    }
    stopTracks();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
    } else {
      void finishSession();
    }
    setRec(false);
    window.setTimeout(() => {
      if (stoppingRef.current) void finishSession();
    }, 2500);
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
