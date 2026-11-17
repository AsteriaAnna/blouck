import { useEffect, useRef, useState } from "react";
import { pickNewSentences, useStore } from "../store";

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

/**
 * 麦克风/WS/分段提交状态机。
 * 组件只负责 UI；这里负责 AudioWorklet、重连、segment 去重、串行 commit。
 */
export function useVoiceInput() {
  const nodes = useStore((s) => s.nodes);
  const worldId = useStore((s) => s.world?.id);
  const setPartial = useStore((s) => s.setPartial);
  const setMentions = useStore((s) => s.setMentions);
  const setGhosts = useStore((s) => s.setGhosts);
  const setStage = useStore((s) => s.setStage);
  const clearStream = useStore((s) => s.clearStream);

  const [rec, setRec] = useState(false);
  const [state, setState] = useState("待输入");
  const [micError, setMicError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const mentionIdsRef = useRef<string[]>([]);
  const segmentQueueRef = useRef<Promise<void>>(Promise.resolve());
  /** 本次录音已送去 /stream/segment 的句子 key（跨 ASR 重连仍有效，防止累计文本重复落图） */
  const ingestedSentencesRef = useRef<Set<string>>(new Set());
  /** 串行 commit 链：兜底 commit 与迟到 final 的补 commit 不得并发 */
  const commitChainRef = useRef<Promise<void>>(Promise.resolve());
  const recordingRef = useRef(false);
  const stoppingRef = useRef(false);
  const finishOnceRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const stopFallbackTimerRef = useRef<number | null>(null);
  const pendingAudioRef = useRef<string[]>([]);
  const flushTailRef = useRef<null | (() => void)>(null);
  const lastAudioAtRef = useRef(0);
  const keepAliveRef = useRef<number | null>(null);
  const asrErrorCountRef = useRef(0);

  useEffect(() => {
    // React StrictMode（dev）会 mount → cleanup → mount：cleanup 会把状态机置为“已结束”，
    // 新 mount 若不在这里复位，stoppingRef/finishOnceRef 会一直是 true → 麦克风/试听按钮
    // 的 guard 直接 return，表现为点了没反应（生产 build 不双调用 effect，故只在 dev 暴露）。
    recordingRef.current = false;
    stoppingRef.current = false;
    finishOnceRef.current = false;
    return () => {
      // 卸载后不得再重连/再 commit：先关状态机，再清定时器与连接
      recordingRef.current = false;
      stoppingRef.current = true;
      finishOnceRef.current = true;
      clearKeepAlive();
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (stopFallbackTimerRef.current) {
        window.clearTimeout(stopFallbackTimerRef.current);
        stopFallbackTimerRef.current = null;
      }
      pendingAudioRef.current = [];
      wsRef.current?.close();
      wsRef.current = null;
      stopTracks();
    };
  }, []);

  function clearKeepAlive() {
    if (keepAliveRef.current) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }

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
    // 新的一轮录音：上一轮的状态机/队列/去重集合全部复位（否则第二次录音 finishOnce 会直接短路）
    finishOnceRef.current = false;
    stoppingRef.current = false;
    recordingRef.current = false;
    asrErrorCountRef.current = 0;
    pendingAudioRef.current = [];
    ingestedSentencesRef.current = new Set();
    segmentQueueRef.current = Promise.resolve();
    mentionIdsRef.current = [];
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (stopFallbackTimerRef.current) {
      window.clearTimeout(stopFallbackTimerRef.current);
      stopFallbackTimerRef.current = null;
    }
    clearKeepAlive();
    setMentions([]);
    setGhosts([]);
    setStage("listening");
  }

  /**
   * 豆包 segment/final 的 text 是“本次 ASR 会话累计文本”（不是增量），累计文本里
   * 已经 ingest 过的句子必须跳过，否则同一句会重复落图（F1）。切句与去重规则在
   * store.ts 的 splitCumulativeText / pickNewSentences 里，便于单独自测。
   */
  function enqueueSentence(sentence: string, key: string) {
    segmentQueueRef.current = segmentQueueRef.current.then(async () => {
      try {
        await useStore.getState().ingestSegment(sentence);
      } catch {
        // toast 由 store 负责；key 回滚，后续累计文本再次到达时这一句还能重试
        ingestedSentencesRef.current.delete(key);
      }
    });
  }

  /** 返回本次新入队的句子数（0 = 这段累计文本全是已 ingest 内容） */
  function ingestNewText(cumulative: string, final = false): number {
    if (!cumulative || !useStore.getState().world) return 0;
    const fresh = pickNewSentences(cumulative, ingestedSentencesRef.current, final);
    for (const s of fresh) enqueueSentence(s.text, s.key);
    return fresh.length;
  }

  /** 等 segment 队列彻底排空（等待期间可能又有 segment/final 追加） */
  async function drainSegmentQueue() {
    let seen: Promise<void>;
    do {
      seen = segmentQueueRef.current;
      await seen;
    } while (seen !== segmentQueueRef.current);
  }

  /** 串行 commit：先排空队列再提交，避免并发 commit 与早提交丢尾句 */
  function commitSerialized() {
    commitChainRef.current = commitChainRef.current.then(async () => {
      await drainSegmentQueue();
      try {
        await useStore.getState().commitStream();
      } catch {
        // store 已 toast，这里保证 commit 链不因失败断掉
      }
    });
    return commitChainRef.current;
  }

  async function finishSession() {
    if (finishOnceRef.current) return;
    finishOnceRef.current = true;
    recordingRef.current = false;
    stoppingRef.current = true; // 保持到 commit 完成：期间 startMic/startMock 会被拒，避免两轮录音状态机重叠
    clearKeepAlive();
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (stopFallbackTimerRef.current) {
      window.clearTimeout(stopFallbackTimerRef.current);
      stopFallbackTimerRef.current = null;
    }
    await commitSerialized();
    stoppingRef.current = false;
    setRec(false);
  }

  /** stopRec 2.5s 兜底 commit 之后才到的 final：只补新尾句 + 再 commit，不回退 UI 状态 */
  function commitLateFinal() {
    void commitSerialized();
  }

  function connectWS(mock: boolean) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/asr`);
    wsRef.current = ws;
    let wsEverOpened = false;
    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      wsEverOpened = true;
      // F2：录音会话真正建立后才置 true —— keepalive / onclose 自动重连 / onerror 提示都以它为准
      recordingRef.current = true;
      asrErrorCountRef.current = 0;
      const hotwords = nodes.map((n) => n.name).filter(Boolean).slice(0, 80);
      ws.send(JSON.stringify({ type: mock ? "mock" : "start", hotwords }));
      // 立即发一点静音，避免 ASR 在等第一包音频时超时
      const silence = toBase64(new Int16Array(1600).buffer);
      ws.send(JSON.stringify({ type: "audio", chunk: silence }));
      lastAudioAtRef.current = Date.now();
      // 补发 WS ready 之前的早期音频
      const queued = pendingAudioRef.current.splice(0);
      for (const chunk of queued) ws.send(JSON.stringify({ type: "audio", chunk }));
      clearKeepAlive();
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
        if (finishOnceRef.current) return; // 收尾后迟到的 partial 不覆盖已完成状态
        setPartial(msg.text);
        setStage("detecting");
        const ids = matchMentions(msg.text);
        mentionIdsRef.current = ids;
        setMentions(ids);
        setState("识别中…");
      } else if (msg.type === "segment") {
        setStreamTextFinal(msg.text);
        setPartial("");
        const added = ingestNewText(msg.text);
        if (finishOnceRef.current) {
          // 收尾后迟到的 segment：只补 ingest 新句（必要时补 commit），不回退 UI 状态
          if (added > 0) commitLateFinal();
          return;
        }
        setStage("confirming");
        setState("本句已确认 · 继续说话，或再点一次结束");
      } else if (msg.type === "final") {
        setPartial("");
        setStreamTextFinal(msg.text);
        const added = ingestNewText(msg.text, true);
        if (finishOnceRef.current) {
          // stopRec 2.5s 兜底已经 commit 过：不回退 UI，只补 ingest 新尾句再 commit 一次
          if (added > 0) commitLateFinal();
          try {
            ws.close();
          } catch {}
          return;
        }
        setStage("confirming");
        if (stoppingRef.current || mock) {
          setState("整段已确认 · 正在落图");
          void finishSession();
        } else {
          // ASR 认为当前 utterance 结束：只结算这一句，然后重连继续录音（不留重复音频）
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
      clearKeepAlive();
      if (recordingRef.current && !stoppingRef.current) {
        // ASR 在句末关闭：保持录音，重连继续
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          if (recordingRef.current && !stoppingRef.current) connectWS(mock);
        }, 250);
        return;
      }
      // 从未连上就断开（服务端未起/网络失败）：给用户可见提示，不要静默卡住
      if (!wsEverOpened && !stoppingRef.current && !finishOnceRef.current) {
        setMicError("语音连接失败，请重试");
        setState("语音连接失败");
        setRec(false);
        stopTracks();
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
    // 上一轮还在收尾（等 final / commit）时不重复开新会话，避免两轮状态机互相踩
    if (recordingRef.current || stoppingRef.current) return;
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
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    // F2：停止采集即退出“录音中”，keepalive / 自动重连立即失效；收尾统一由 finishSession 负责
    recordingRef.current = false;
    clearKeepAlive();
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
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
    // final 迟迟不来时的兜底 commit；迟到的 final 由 finishOnceRef 分支补尾句 + 再 commit
    if (!finishOnceRef.current) {
      if (stopFallbackTimerRef.current) window.clearTimeout(stopFallbackTimerRef.current);
      stopFallbackTimerRef.current = window.setTimeout(() => {
        stopFallbackTimerRef.current = null;
        if (stoppingRef.current) {
          void finishSession().then(() => {
            try {
              wsRef.current?.close();
            } catch {}
          });
        }
      }, 2500);
    }
  }

  function startMock() {
    if (recordingRef.current || stoppingRef.current) return;
    setMicError("");
    clearStream();
    resetStream();
    connectWS(true);
  }

  return { rec, state, micError, startMic, stopRec, startMock, matchMentions, setState };
}
