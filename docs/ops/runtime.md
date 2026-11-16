# 运行说明

最后更新：2026-11-16

---

## 1. 本地服务

```bash
# 根目录
pnpm dev
# server 8787, web 5173
```

- Web：`http://localhost:5173`
- API：`http://localhost:8787/api/health`
- 未配置 key 时自动 mock；配置 `DEEPSEEK_API_KEY`、`DOUBAO_ASR_*` 后切真实。

---

## 2. 语音（豆包 Seed ASR Streaming 2.0）

### 状态（已实测）

| 项 | 状态 |
| --- | --- |
| 鉴权（Access Token + Resource ID） | ✅ |
| 二进制帧协议（首帧/音频/终帧） | ✅ |
| partial 字幕 | ✅ 逐字返回 |
| final 文本 | ✅ |
| 浏览器麦克风 → WS → 豆包 | ✅ Chrome 假麦克风跑通 |
| 真人麦克风 | ⚠️ 需本地授权实测 |

已知：`Rerank` 可能被识别成 `Rerun`；当前接口不支持热词，需换接口或前端纠错。

### 协议要点

- 端点：`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`
- 请求头：`X-Api-Key`、`X-Api-Resource-Id`、`X-Api-Request-Id`、`X-Api-Sequence: -1`
- 首帧 JSON（gzip）：`user.uid` + `audio{format:pcm, codec:raw, rate:16000, bits:16, channel:1}` + `request{model_name:bigmodel, show_utterances:true, result_type:full}`
- 帧：4B header / 4B sequence / 4B payload_size / gzip payload；首帧 type=1 flags=1；音频 type=2 flags=1；终帧 flags=3 负序号
- 响应：type=9 正常，type=15 错误

### 浏览器链路

`web/src/components/InputBar.tsx`：

1. `getUserMedia`；
2. `AudioContext({sampleRate:16000})` + AudioWorklet 转 PCM16；
3. 重采样到 16k；
4. 每 200ms 通过 `/ws/asr` 发 base64；
5. 服务端 `providers/doubao.ts` 转豆包帧，partial/final 回推；
6. final 触发流式检测 + `/extract` 落图。

麦克风失败时可用"试听"走 mock；线上必须 HTTPS。

---

## 3. 3D 资产

```
web/public/assets3d/
  island_*.glb      21 个浮岛（平台 + 地标）
  gate_domain.glb   领域副本入口
  gate_flow.glb     流程副本入口
  manifest.json     资产清单

prototype/
  knowledge-world-visual-v3.3-glb.html
  tools/            生成资产的 Blender 脚本
```

节点 → 模型：`web/src/models3d.ts` 先按关键词匹配，匹配不到用节点 id 哈希稳定取岛；副本用 gate 模型。

加载：`World3D.tsx` 的 `Model` 计算包围盒，按 `min(120/占地, 135/高度)` 缩放，底部对齐 y=0，按节点调色板调色。

重新生成（需 Blender 4.2）：

```bash
blender -b -P prototype/tools/build_assets.py -- <输出目录>
```

---

## 4. 评测

```bash
cd server
pnpm eval                 # 直连 provider
pnpm eval -- --provider=mock
pnpm eval -- --api        # 走真实 API（含副本检测），服务需启动
pnpm eval:dungeons        # 副本正负例，无需服务
```

输出到 `server/eval/report-<provider>.md/.json`。

### 基线

| 指标 | 值 |
| --- | --- |
| 实体 P/R | 100% / 70% |
| 关系 P/R | 32.4% / 46.0% |
| 谓词准确率 | 87.0% |
| 线型一致率 | 91.3% |
| 证据覆盖 | 46.0% |
| 副本 TP/FP/FN/TN | 2/0/0/13 |

主要短板：关系召回、证据覆盖；副本规则在小样本上可靠。

副本位置截图：[12-dungeon.png](../screenshots/12-dungeon.png)。
