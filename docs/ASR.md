# 真实语音（豆包 Seed ASR Streaming 2.0）

## 结论（已实测）

| 项目 | 状态 |
| --- | --- |
| 鉴权（Access Token + 资源 ID） | ✅ 握手通过 |
| 二进制帧协议（首帧 / 音频帧 / 终帧） | ✅ 服务端接受，返回 `type=9` |
| 实时 partial 字幕 | ✅ 逐字返回 |
| 最终 final 文本 | ✅ 关闭时返回完整句子 |
| 浏览器麦克风 → WS → 豆包 | ✅ Chrome 假麦克风跑通整链路 |
| 真实麦克风真人说话 | ⚠️ 需本地实测（无头环境无法验证） |

实测样例（服务端直传 TTS 音频）：

```
PARTIAL: 检索出来之后还要重排一下，Rerun 会按相关度重新排序，所以召回率和精排是两件事
FINAL:   检索出来之后还要重排一下，Rerun 会按相关度重新排序，所以召回率和精排是两件事。
```

> "Rerank" 被识别为 "Rerun"，属于口音/术语识别问题，可后续加热词（当前 bigmodel_async 文档说明不支持 hints，需要换接口或前端文本纠错）。

## 协议要点

- 端点：`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`
- 请求头：
  - `X-Api-Key: <Access Token>`
  - `X-Api-Resource-Id: volc.seedasr.sauc.duration`
  - `X-Api-Request-Id: <uuid>`
  - `X-Api-Sequence: -1`
- 首帧 JSON（gzip）：`user.uid` + `audio{format:pcm, codec:raw, rate:16000, bits:16, channel:1}` + `request{model_name:bigmodel, show_utterances:true, result_type:full}`
- 帧格式：`4B header(0x11, type|flags, 0x11, 0x00) | 4B sequence | 4B payload_size | payload(gzip)`
  - 首帧：type=1, flags=1
  - 音频：type=2, flags=1，正序号递增
  - 终帧：type=2, flags=3，负序号
- 服务端响应：type=9 正常（payload 可能 gzip），type=15 错误（带 error_code）

## 浏览器链路

`web/src/components/InputBar.tsx`：

1. `getUserMedia({audio: {channelCount:1, echoCancellation:true, noiseSuppression:true}})`
2. `AudioContext({sampleRate:16000})` + AudioWorklet（Blob 注入），把 Float32 转 Int16 PCM
3. 若实际采样率不是 16k，做线性重采样
4. 攒满 6400 字节（200ms）通过 `/ws/asr` 发 `{type:"audio", chunk: base64}`
5. 服务端 `providers/doubao.ts` 转成豆包二进制帧转发，partial/final 回推前端
6. final 触发 `extract(text)` 落图

麦克风失败时输入台会显示原因，并提供"用模拟语音体验"按钮（走 mock 脚本，仅用于演示）。

## 本地验证方法

1. 用 Chrome/Edge 打开 `http://localhost:5173`（localhost 属于安全上下文，可授权麦克风）；
2. 点输入台左侧 🎙，允许麦克风；
3. 说一段中文，观察 `.partial` 实时字幕；停止后应出现 final 并自动落图；
4. 若失败：看浏览器控制台是否有 `getUserMedia` 错误，以及服务端日志是否有 `[asr] 豆包连接失败，降级 mock`。

部署到线上时必须是 HTTPS，否则浏览器不允许麦克风。
