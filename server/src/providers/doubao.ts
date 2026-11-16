import WebSocket from "ws";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";
import { env } from "../env.js";
import { mockASR } from "./mock.js";
import type { ASRProvider, ASREvents, ASRSession, ASROptions } from "./types.js";

/**
 * 豆包（火山引擎）Seed ASR Streaming 2.0 实时语音识别。
 *
 * 端点：wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
 * 鉴权：X-Api-Key（Access Token）+ X-Api-Resource-Id
 * 音频：PCM S16LE / 16kHz / 单声道
 * 二进制帧：4 字节头 + [4B sequence] + [4B event] + 4B payload_size + payload(gzip)
 *
 * 已实测：token 可握手、首帧/音频帧/终帧均被接受，partial 与 final 正常返回。
 */

const DEVAN = 0x11; // version=1, header size=4
const SERIAL_JSON_GZIP = 0x11; // serialization=JSON, compression=gzip

function makeFrame(type: number, flags: number, seq: number, payload: Buffer) {
  const head = Buffer.from([DEVAN, ((type << 4) | flags) & 0xff, SERIAL_JSON_GZIP, 0x00]);
  const seqBuf = Buffer.alloc(4);
  seqBuf.writeInt32BE(seq, 0);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(payload.length, 0);
  return Buffer.concat([head, seqBuf, sizeBuf, payload]);
}

function firstFrame(uid: string, options?: ASROptions) {
  const body = {
    user: { uid },
    audio: { format: "pcm", codec: "raw", rate: 16000, bits: 16, channel: 1 },
    request: {
      model_name: env.doubaoModel || "bigmodel",
      enable_itn: true,
      enable_punc: true,
      enable_ddc: false,
      show_utterances: true,
      enable_nonstream: false,
      result_type: "full",
      corpus: {
        context: JSON.stringify({
          hotwords: (options?.hotwords ?? []).filter(Boolean).slice(0, 80).map((word) => ({ word })),
          context_type: "dialog_ctx",
          context_data: (options?.context ?? []).filter(Boolean).slice(0, 6).map((text) => ({ text })),
        }),
      },
    },
  };
  return makeFrame(1, 1, 1, zlib.gzipSync(Buffer.from(JSON.stringify(body))));
}

function parseServerFrame(data: Buffer) {
  const type = data[1] >> 4;
  const flags = data[1] & 0xf;
  let off = 4;
  let sequence: number | null = null;
  if (flags & 1) {
    sequence = data.readInt32BE(off);
    off += 4;
  }
  let event: number | null = null;
  if (flags & 4) {
    event = data.readInt32BE(off);
    off += 4;
  }
  if (type === 15) {
    const code = off + 4 <= data.length ? data.readUInt32BE(off) : -1;
    off += 4;
    let payload: any = Buffer.alloc(0);
    if (off + 4 <= data.length) {
      const size = data.readUInt32BE(off);
      off += 4;
      payload = data.subarray(off, off + size);
    }
    return { type, flags, sequence, event, code, text: payload.toString() };
  }
  let payload: any = Buffer.alloc(0);
  if (off + 4 <= data.length) {
    const size = data.readUInt32BE(off);
    off += 4;
    payload = data.subarray(off, off + size);
  }
  let text = "";
  try {
    text = zlib.gunzipSync(payload).toString("utf8");
  } catch {
    text = payload.toString("utf8");
  }
  return { type, flags, sequence, event, code: 0, text };
}

export const doubaoASR: ASRProvider = {
  name: "doubao",
  open(events: ASREvents, options?: ASROptions): ASRSession {
    if (!env.doubaoToken) {
      console.warn("[asr] 未配置豆包 token，使用 mock");
      return mockASR.open(events);
    }

    const uid = randomUUID();
    let ws: WebSocket | null = null;
    let ready = false;
    let ended = false;
    let seq = 2;
    let pending: Buffer | null = null;
    const queue: Buffer[] = [];
    let lastPartial = "";
    let lastDefinite = "";
    let finalSent = false;
    let fellBack = false;
    let mockSession: ASRSession | null = null;

    const fallback = (reason: string) => {
      if (fellBack || finalSent) return;
      fellBack = true;
      console.warn("[asr] 豆包连接失败，降级 mock：", reason);
      events.onError(`豆包语音连接失败：${reason}`);
      try {
        ws?.close();
      } catch {}
      mockSession = mockASR.open(events);
    };

    const sendAudio = (chunk: Buffer, last: boolean) => {
      if (!ws || ws.readyState !== WebSocket.OPEN || !ready) {
        queue.push(chunk);
        return;
      }
      const payload = zlib.gzipSync(chunk);
      if (last) {
        ws.send(makeFrame(2, 3, -seq, payload));
      } else {
        ws.send(makeFrame(2, 1, seq++, payload));
      }
    };

    try {
      ws = new WebSocket(env.doubaoWsUrl, {
        headers: {
          "X-Api-Key": env.doubaoToken,
          "X-Api-Resource-Id": env.doubaoResourceId,
          "X-Api-Request-Id": uid,
          "X-Api-Sequence": "-1",
        },
        handshakeTimeout: 8000,
      });
    } catch (err: any) {
      fallback(err?.message ?? "connect failed");
      return { push: () => {}, end: () => {} };
    }

    ws.on("open", () => {
      ready = true;
      try {
        ws!.send(firstFrame(uid, options));
        for (const c of queue.splice(0)) sendAudio(c, false);
      } catch (err: any) {
        fallback(err?.message ?? "send first frame failed");
      }
    });

    ws.on("unexpected-response", (_req, res) => {
      res.on("data", (d) => {
        const body = d.toString().slice(0, 200);
        fallback(`HTTP ${res.statusCode} ${body}`);
      });
      if (!res.readableEnded) fallback(`HTTP ${res.statusCode}`);
    });

    ws.on("message", (data) => {
      const frame = parseServerFrame(Buffer.from(data as Buffer));
      if (frame.type === 15) {
        // 45000081：等待下一包音频超时。不是致命错误，按会话结束处理，交给前端重连。
        if (frame.code === 45000081) {
          if (!finalSent) {
            finalSent = true;
            events.onFinal(lastPartial || lastDefinite || "");
          }
          try {
            ws?.close();
          } catch {}
          return;
        }
        fallback(`服务端错误 ${frame.code} ${frame.text.slice(0, 120)}`);
        return;
      }
      if (frame.type !== 9) return;
      let obj: any = null;
      try {
        obj = JSON.parse(frame.text);
      } catch {
        return;
      }
      const text: string = obj?.result?.text ?? "";
      if (text && text !== lastPartial) {
        lastPartial = text;
        events.onPartial(text);
      }
      const utterances: any[] = obj?.result?.utterances ?? [];
      const definite = utterances.filter((u) => u.definite).map((u) => String(u.text ?? "")).join("");
      if (definite && definite !== lastDefinite) {
        lastDefinite = definite;
        events.onSegment?.(definite);
      }
      // 注意：utterance 的 definite / flags&2 只表示“这一句结束”，
      // 不代表整段录音结束；整段 final 由客户端 stop/end 统一发出。
    });

    ws.on("close", () => {
      if (!finalSent && !fellBack && (lastPartial || lastDefinite)) {
        finalSent = true;
        events.onFinal(lastPartial || lastDefinite);
      }
    });

    ws.on("error", (err) => fallback(err.message));

    return {
      push(chunk: Buffer) {
        if (fellBack) {
          mockSession?.push(chunk);
          return;
        }
        if (ended) return;
        // 保留最后一块，end() 时用负序号发送
        if (pending) sendAudio(pending, false);
        pending = chunk;
      },
      end() {
        if (ended) return;
        ended = true;
        if (fellBack) {
          mockSession?.end();
          return;
        }
        const last = pending ?? Buffer.alloc(3200);
        pending = null;
        try {
          sendAudio(last, true);
        } catch (err: any) {
          fallback(err?.message ?? "send last failed");
        }
        setTimeout(() => {
          if (!finalSent && (lastPartial || lastDefinite)) {
            finalSent = true;
            events.onFinal(lastPartial || lastDefinite);
          }
          try {
            ws?.close();
          } catch {}
        }, 4000);
      },
    };
  },
};
