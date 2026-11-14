import { useEffect, useRef, useState } from "react";
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

/** 麦克风采集 → 16k PCM16 → WS；失败时可切"模拟语音" */
export default function InputBar() {
  const extract = useStore((s) => s.extract);
  const partial = useStore((s) => s.partial);
  const setPartial = useStore((s) => s.setPartial);
  const busy = useStore((s) => s.busy);
  const worldId = useStore((s) => s.world?.id);
  const [text, setText] = useState("");
  const [rec, setRec] = useState(false);
  const [state, setState] = useState("待输入");
  const [micError, setMicError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);

  useEffect(() => {
    return () => {
      stopTracks();
      wsRef.current?.close();
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

  function connectWS(mock: boolean) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/asr`);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: mock ? "mock" : "start" }));
      setRec(true);
      setState(mock ? "模拟语音中…" : "录音中…");
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "partial") {
        setPartial(msg.text);
        setState("识别中…");
      } else if (msg.type === "final") {
        setRec(false);
        setPartial("");
        setState("已稳定 · 正在落图");
        ws.close();
        extract(msg.text);
      } else if (msg.type === "error") {
        setRec(false);
        setMicError(String(msg.message ?? "语音识别失败"));
        setState("识别失败");
        stopTracks();
      } else if (msg.type === "ready") {
        setState(`已连接（${msg.provider}）`);
      }
    };
    ws.onerror = () => {
      setRec(false);
      setState("语音连接失败");
      stopTracks();
    };
    return ws;
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
    // 采集到的采样率可能不是 16k：做线性重采样，攒够 6400 字节发一包
    const inRate = ctx.sampleRate;
    const ratio = inRate / 16000;
    let carry = new Float32Array(0);
    let carryPos = 0;
    let out = new Int16Array(0);

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
      if (res.length) {
        const pcm = new Int16Array(res);
        flush(pcm);
      }
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
    try {
      nodeRef.current?.disconnect();
    } catch {}
    stopTracks();
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    setRec(false);
  }

  function startMock() {
    setMicError("");
    connectWS(true);
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
      {micError && (
        <div className="partial">
          麦克风不可用：{micError}
          <button className="secondary" style={{ marginLeft: 8 }} onClick={startMock}>
            用模拟语音体验
          </button>
        </div>
      )}
      <button
        className={"mic" + (rec ? " rec" : "")}
        title={rec ? "停止录音" : "实时语音"}
        onClick={() => (rec ? stopRec() : startMic())}
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
