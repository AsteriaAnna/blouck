import { env } from "../env.js";
import { mockASR } from "./mock.js";
import type { ASRProvider } from "./types.js";

/**
 * 豆包（火山引擎）流式 ASR 预留位。
 *
 * 真实接入步骤（保留给下一阶段，不在本 MVP 伪造已实现）：
 * 1. 在火山引擎控制台开通「流式语音识别」并创建应用，拿到 AppID / Access Token / Cluster；
 * 2. 服务端用 WebSocket 连 wss://openspeech.bytedance.com/api/v2/asr，按官方二进制协议：
 *    - 握手：携带 Authorization / AppID / Cluster 等 header；
 *    - 上行：把浏览器采集的 PCM16 / 16k 单声道分片按帧发送；
 *    - 下行：解析 partial（中间结果）与 final（稳定片段），推给前端；
 * 3. 稳定片段才触发抽取任务（与 MVP 文档的“稳定片段后抽取”一致），
 *    临时文字只更新 UI，不落库。
 *
 * 本文件目前返回 mock 会话；配置环境变量后可替换 open() 内的实现。
 */
export const doubaoASR: ASRProvider = {
  name: "doubao",
  open(events) {
    if (!env.doubaoAppId || !env.doubaoToken) {
      console.warn("[asr] 豆包未配置，使用 mock ASR");
      return mockASR.open(events);
    }
    // TODO: 接入真实 WebSocket 协议；未实现前先降级，避免静默失败。
    console.warn(
      "[asr] 豆包流式协议接入位预留（see providers/doubao.ts），当前降级 mock",
    );
    return mockASR.open(events);
  },
};
