# 03 · 当前真正实现并在用的措施

> 这是唯一实现依据。找 bug 以本文和源码为准。
> 本文不写未来计划；没写的行为就不要假设存在。

## 0. 项目与启动

桌面 Web 知识地图：

```text
语音/文字 → 抽取 → 节点/关系 → 3D 地图 → 题目/副本/方向
```

```bash
pnpm install
cp server/.env.example server/.env   # 可选，不配 key 自动 mock
pnpm dev
```

- 前端：http://localhost:5173
- 服务端：http://localhost:8787
- 麦克风自检：http://localhost:5173/mic-test.html

技术栈：

- React 18 + TypeScript + Vite + Zustand；
- three.js + @react-three/fiber + drei；
- Node.js + Express + ws；
- `node:sqlite`（WAL）；
- DeepSeek Chat Completions；
- 豆包 Seed ASR Streaming 2.0（`bigmodel_async`）。

## 1. 两条输入链路

### 语音链路（当前正式链路）

```text
InputBar
→ getUserMedia
→ AudioContext（浏览器原生采样率，通常 48k）
→ AudioWorklet PCMWorklet：连续相位重采样到 16k，输出 Int16
→ /ws/asr 发送 PCM
→ 豆包 ASR：partial / segment / final
→ segment 调 /api/worlds/:id/stream/segment
→ provisional 节点/suggest 关系
→ 用户停止 → /api/worlds/:id/stream/commit
→ committed 节点 + formal 关系
```

### 文字链路（旧批量）

```text
输入框 → POST /api/worlds/:id/extract
→ 直接建 committed 节点/关系 + 规则方向/副本候选
```

两条链路不要混改。语音链路核心在 `server/src/stream/session.ts`，文字链路在 `server/src/index.ts`。

## 2. 音频采集事实

- `InputBar` 不强制 AudioContext 16k；使用原生采样率。
- `AudioWorkletNode` 通过 `processorOptions.sampleRate` 拿到输入采样率。
- Worklet 内部用连续相位线性插值重采样到 16k。
- 主线程只接收 Int16，不再做 Float32 重采样。
- 每块 3200 samples（PCM16 = 6400 字节，约 200ms）发送。
- 停止时先 flush 尾部不足 3200 的 PCM，再发 300ms 静音，再发 `stop`。
- WS 打开时先发 100ms 静音，避免豆包等第一包超时。
- 1.5 秒没有音频时补 100ms 静音 keepalive。
- 豆包返回 `45000081`（等待下一包音频超时）时，服务端按会话结束处理并发 final；前端 `final` 后如果仍在录音则自动重连。

## 3. WebSocket `/ws/asr`

客户端：

```json
{ "type": "start", "hotwords": ["检索", "增强生成"] }
{ "type": "audio", "chunk": "<base64 PCM16LE 16k mono>" }
{ "type": "stop" }
```

服务端：

```json
{ "type": "ready", "provider": "doubao" }
{ "type": "partial", "text": "..." }
{ "type": "segment", "text": "..." }
{ "type": "final", "text": "..." }
{ "type": "error", "message": "..." }
```

语义：

- `partial`：当前不稳定文本；
- `segment`：这一句确认，**不结束录音**；
- `final`：当前 ASR 会话结束；录音页据此 commit 或重连。

## 4. 语音建图接口

### POST `/api/worlds/:id/stream/segment`

请求：

```json
{ "text": "混合检索属于检索。", "focusId": "<node id>" }
```

处理：

1. 读取 `focus_stack`；
2. 本地匹配文本提到的已有节点；
3. 解析“它/这个/前者/后者/它们”；
4. 调 DeepSeek 抽取实体/关系；
5. 新节点写 `status=provisional`；
6. parent 按关系端点、本句已有节点、focus 栈选择；
7. 关系写 `kind=suggest`；
8. 写 source 边；
9. 更新 `focus_stack`。

返回 `focusId, focusStack, createdNodes, nodes, edges`。

### POST `/api/worlds/:id/stream/commit`

请求 `{}` 或 `{ids:[...]}`。

处理：

- 目标 provisional 节点 → `committed`；
- `origin='stream'` 且 `kind='suggest'` 且 evidence 非空的关系 → `formal`；
- `computeFrontier`；
- 不重建节点、不改坐标。

## 5. 数据库事实

`server/src/db.ts` 中实际存在的表：

```text
worlds, nodes, edges, buildings, quizzes, attempts,
meta, source_spans, focus_stack, directions,
domain_questions, hide_batches, daily_domain
```

### nodes 关键字段

```text
id, world_id, name, x, y, free_md, hidden, tier,
type, definition, aliases(JSON), source_span_id,
frontier, status(provisional|committed), created_at
```

### edges 关键字段

```text
id, world_id, src, dst, kind, label, md, question,
frontier_x, frontier_y, consumed,
predicate, evidence, confidence, origin,
claim_status, revision, created_at
```

`kind` 只有：

```text
formal | source | suggest | direction
```

### focus_stack

```text
world_id, stack(JSON 节点 ID 数组，最多 12), updated_at
```

## 6. focus / parent 当前算法

候选顺序：

```text
显式关系（属于/包括/分为/由…组成）
> 指代（它/这个/前者/后者/它们）
> 文本提到的已有节点
> 当前 focus
> 上一句 focus
```

行为：

- 栈顶是当前主题；
- 一个句子创建多个兄弟节点时，兄弟也入栈；
- 前者 → 栈第二，后者 → 栈顶；
- 文本重新提到已有节点时，focus 跟过去；
- parent 不再默认全部挂同一个 focus。

## 7. 关系当前范围

已实现：

- 新 → 已有节点、新 → 新节点；
- source/target 从 focus 栈、本句已有节点、新节点解析；
- commit 时 `suggest → formal`；
- 关系方向主要来自 LLM 输出；`partOf` 没有强制归一。

没有进代码的关系能力，不要按 01/02 的设想假设存在。

## 8. 前端事实

- `web/src/components/InputBar.tsx`：麦克风、Worklet、WS、keepalive、重连、segment/commit。
- `web/src/store.ts`：`ingestSegment` / `commitStream` 更新 nodes/edges/focus。
- `web/src/components/World3D.tsx`：节点、关系、建筑、方向线、provisional “候选 ·”标签。
- provisional 节点直接作为地图节点渲染，不用另一套 ghost 坐标。
- `direction` 边只有 frontier 节点渲染。
- 3D 资产在 `web/public/assets3d/`：21 个岛屿 + 2 个副本门，`manifest.json` 映射。

## 9. 文字链路与下游

`POST /api/worlds/:id/extract` 是旧的批量链路：

- DeepSeek 抽取节点/关系；
- 直接建 committed 节点；
- 规则检测流程/领域副本；
- 生成题目/方向等下游。

语音 `/stream/segment` + `/stream/commit` 当前**不会**触发出题、副本、方向；这是当前实际行为，不要假设它会自动发生。

## 10. 当前验证方式

```bash
pnpm typecheck
pnpm build
```

已实际验证：

- typecheck、build 通过；
- stream API 的 provisional → committed、坐标不变、suggest → formal；
- focus 多分支、前者/后者；
- 主页面用 48k 假麦克风端到端：partial 出现、provisional 创建、停止后 commit；
- 真实麦克风本机能出 partial/final（人工）。

没有 CI、没有自动化单元测试框架。

## 11. 代码地图

```text
server/src/
  env.ts                 环境变量/provider
  db.ts                  schema/迁移/查询
  index.ts               REST + /ws/asr + 文字 extract
  stream/session.ts      语音 provisional/focus/commit
  providers/types.ts     LLM/ASR 接口
  providers/deepseek.ts  DeepSeek
  providers/doubao.ts    豆包 ASR
  providers/mock.ts      mock
  placement.ts           placeAround
  layout.ts              elk 布局
  wfc.ts                 WFC 岛屿布局
  assetops.ts            建筑坐标/方向/隐藏/导出
  dungeons.ts            副本检测
  anchorFirst.ts         anchor-first 实验，不是语音主链路

web/src/
  App.tsx / main.tsx
  api.ts                 REST 类型/客户端
  store.ts               Zustand
  components/InputBar.tsx
  components/World3D.tsx
  components/Home.tsx
  components/World.tsx
  components/NodeDrawer.tsx
  components/RelationDrawer.tsx
  components/BuildingDrawer.tsx
  models3d.ts
  styles.css / styles3d.css
```
