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
# Windows: Copy-Item server/.env.example server/.env
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

两条链路各自独立，不要混改。

### 语音链路（当前正式链路）

```text
InputBar
→ getUserMedia
→ AudioContext（浏览器原生采样率，通常 48k）
→ AudioWorklet PCMWorklet：连续相位重采样到 16k，输出 Int16
→ /ws/asr 发送 PCM
→ 豆包 ASR：partial / segment / final
→ 前端按句去重后，segment 调 /api/worlds/:id/stream/segment
→ provisional 节点/suggest 关系
→ 用户停止 → /api/worlds/:id/stream/commit
→ committed 节点 + formal 关系
```

### 文字链路（旧批量）

```text
输入框 → POST /api/worlds/:id/extract
→ 直接建 committed 节点/关系 + 规则方向/副本候选
```

语音链路核心在 `server/src/stream/session.ts`，文字链路在 `server/src/routes/graph.ts`。

## 2. 音频采集事实

- `web/src/hooks/useVoiceInput.ts` 不强制 AudioContext 16k；使用原生采样率。
- `AudioWorkletNode` 通过 `processorOptions.sampleRate` 拿到输入采样率。
- Worklet 内部用连续相位线性插值重采样到 16k。
- 主线程只接收 Int16，不再做 Float32 重采样。
- 每块 3200 samples（PCM16 = 6400 字节，约 200ms）发送。
- 停止时先 flush 尾部不足 3200 的 PCM，再发 300ms 静音，再发 `stop`。
- WS 打开时先发 100ms 静音，避免豆包等第一包音频超时。
- 录音中 1.5 秒没有音频时补 100ms 静音 keepalive（前端以 `recordingRef` 判定是否在录音）。
- 豆包返回 `45000081`（等待下一包音频超时）时，服务端按会话结束处理并发 final；前端收到 `final` 且仍在录音时关闭当前 WS，250ms 后自动重连继续录音。
- ASR 出错时前端最多自动重连 2 次；仍失败则提示「识别失败」并停止录音。
- 点停止后 2.5 秒内还没收到 final，前端先 commit 当前 provisional；之后迟到的 final 只补 ingest 新尾句并再 commit 一次，不回退 UI 状态。
- 组件卸载时清理 keepalive、重连、兜底 commit 定时器与 WS；dev 下 React StrictMode 会 mount→cleanup→mount，挂载 effect 开始时复位录音状态机（否则按钮 guard 会一直拦住）。

## 3. WebSocket `/ws/asr`

客户端：

```json
{ "type": "start", "hotwords": ["检索", "增强生成"] }
{ "type": "mock", "hotwords": ["..."] }
{ "type": "audio", "chunk": "<base64 PCM16LE 16k mono>" }
{ "type": "stop" }
```

`mock` 是前端「试听」按钮用的：服务端直接走 mock ASR 脚本，不连接豆包。

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
- `segment`：这一句确认，**不结束录音**；文本是当前 ASR 会话里“已确定文本的累计值”（豆包把全部 definite utterance 拼接后返回，不是增量）；
- `final`：当前 ASR 会话结束；文本是当前会话的累计全文（可能为空）。
- 未配置豆包 App ID/token 时服务端直接用 mock ASR；已配置但豆包连接/鉴权失败时，服务端会发 `error` 并在内部降级到 mock ASR（此时 `ready.provider` 仍显示 `doubao`）。

前端落图规则：把 segment/final 文本按句切分（`。！？!?；;` 与换行），只把本次录音内**还没送过**的句子串行 POST 到 `/stream/segment`；`final` 里没有句末标点的尾句也会送；ASR 重连后新会话重新累积的旧句子不会重复送。

## 4. 语音建图接口

### POST `/api/worlds/:id/stream/segment`

请求：

```json
{ "text": "混合检索属于检索。", "focusId": "<node id>" }
```

处理：

1. 读取 `focus_stack`；
2. 本地匹配文本提到的已有节点（按节点名/别名在文本中最后一次出现的位置排序）；
3. 解析“它/这个/前者/后者/它们”；
4. 调 DeepSeek 抽取实体/关系（单次调用 20s 超时）；
5. 新节点写 `status=provisional`；实体必须有原文证据（精确或忽略空白/标点后匹配），问句/代词/纯疑问词名会被过滤；
6. parent 按关系端点、本句提到的已有节点、focus 栈选择；
7. 关系写 `kind=suggest`；同一 `(src,dst,kind,predicate)` 只写一条（suggest 与 formal 视为同一条关系的两个阶段，重复 segment/final 或模型重复输出不会再叠边），source 边同样幂等；
8. 写 source 边；
9. 更新 `focus_stack`。

DeepSeek 抽取失败/超时时：本段不落图，返回空结果并在响应里带 `warning`（前端 toast 提示），**不降级 mock**（mock 的正则兜底会把“这个/然后”等写进图里）。

返回 `focusId, focusStack, createdNodes, nodes, edges`，失败时另有可选 `warning`。

### POST `/api/worlds/:id/stream/commit`

请求 `{}` 或 `{ids:[...]}`。

处理：

- 目标 provisional 节点（默认全世界的 provisional，可用 ids 限定）→ `committed`；
- `origin='stream'` 且 `kind='suggest'` 且 evidence 非空的关系 → `formal`；
- `computeFrontier`；
- 不重建节点、不改坐标。

## 5. 数据库事实

`server/src/db/schema.ts` 中实际存在的表：

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

# API（getGraph）额外派生，不存库：
line_type   = relation|sequence|hint|exploration
line_state  = confirmed|proposed|provenance|planned|consumed
```

`kind` 只有：

```text
formal | source | suggest | direction
```

### focus_stack

```text
world_id, stack(JSON 节点 ID 数组), updated_at
```

db 层最多保留 12 个 ID；语音 session 写入时最多保留 8 个。

### 删除世界

`DELETE /api/worlds/:id` 会清理该世界的 nodes/edges/buildings/quizzes（连同 attempts）/source_spans/focus_stack/directions/domain_questions/hide_batches/daily_domain，不留孤儿子表行（不改表结构）。

## 6. focus / parent 当前算法

focus 选择顺序（`ingestSegment` 实际行为）：

```text
文本中最后提到的已有节点（按最后一次出现位置）
> 指代（前者→栈第二、后者→栈顶、它们→栈第二）
> 客户端传入的 focusId
> focus 栈顶
```

parent 选择顺序（新节点挂到谁）：

```text
本句 LLM 关系里的另一端（显式关系）
> 本句最后提到的已有节点
> 当前 focus
```

行为：

- 栈顶是当前主题；
- 一个句子创建多个兄弟节点时，兄弟也入栈（最后创建的兄弟在栈顶）；
- 前者 → 栈第二，后者 → 栈顶；
- 文本重新提到已有节点时，focus 跟到文本里最后提到的那个（不是图里创建最晚的那个）；
- parent 不再默认全部挂同一个 focus。

## 7. 关系当前范围

已实现：

- 新 → 已有节点、新 → 新节点、已有 → 已有节点；
- source/target 从 focus 栈、本句已有节点、新节点解析；
- stream 关系以 `kind=suggest` 落库，evidence 为空时用 target 名兜底，因此 commit 时这些 suggest 都会升级成 formal；
- 关系幂等：同 `(src,dst,kind,predicate)` 只保留一条；suggest 与 formal 视为同一条关系的两个阶段；
- 关系方向主要来自 LLM 输出（kindOf 具体→上位、partOf 部分→整体、prerequisite 前置→后续……）；**语音链路**不做 partOf 的额外方向归一；文字链路见 §9。

没有进代码的关系能力，不要按 01/02 的设想假设存在。

## 8. 前端事实

- `web/src/components/InputBar.tsx`：输入框/提交/状态展示；`web/src/hooks/useVoiceInput.ts`：麦克风、Worklet、WS、keepalive、重连、按句去重、segment/commit、失败提示、停止后兜底 commit；“试听”按钮走 mock ASR。
- `web/src/store.ts` 只做 slices 组合；`store/streamText.ts` 是 `splitCumulativeText` / `sentenceKey` / `pickNewSentences` 纯函数（累计文本切句与去重）；`store/streamSlice.ts` 的 `ingestSegment` / `commitStream` 更新 nodes/edges/focus，失败 toast，`warning` 防御式读取后 toast；`store/worldSlice.ts` 管世界/抽屉/题目/副本。
- `web/src/components/World3D.tsx`：场景组装；`World3DScene.tsx`：岛/建筑/相机；`World3DEdges.tsx`：节点、关系、建筑、方向线。四种线按类型分美术：正式关系=深色 3D 管状实线（半径约 2.8）、探索来源=蓝灰管状实线 + 起点圆点（半径约 2.0）、待确认建议=统一色虚线 + 中点圆珠、方向=点线 + 末端「旧版木柱路牌 + 地面方向箭头」。所有线都带透明命中管，点击可打开关系/方向文档。
- 世界页顶栏只保留「← 世界列表 + 世界名」；示例数据标记、节点/关系/副本统计、LLM/ASR、3D 视图、重排、撤回隐藏、导出、操作提示均已从 UI 移除（后端对应接口仍在，MVP 无入口）。
- 点节点显示**节点文档**：标题（节点名）、正文（`definition` + `free_md`，ReactMarkdown 渲染）、来源 blockquote（来自 `source_text/source_at`）、以及「编辑」自由区；MVP 暂不展示答题/档位/关系列表/手动关联/继续探索/隐藏面板。
- 点线显示**一句话文档**（按语义类型）：正式/来源/建议线用 predicate 关系类型（归类/组成/前置/对比/替代/相关；来源线为“探索来源”）；建议线额外提供「接受为正式关系」，方向线提供「去探索」。MVP 不再展示证据/置信度/关系 MD 编辑器。
- 题目/答题：后端 quizzes 接口仍在，但 MVP 前端不展示题目区，也不展示节点 tier。
- 抽屉（.drawer）`z-index: 100`；3D HTML 标签的 `zIndexRange` 被限制在 30 以下（副本标题 20 以下），避免副本标题/节点标签穿透打开中的 MD 文档。
- 关系路牌：`suggest`（建议标签）与 `direction`（方向问题）在 3D 里有木柱路牌（旧版样式：Canvas 文字、始终面向相机、可点击）；`source` 只画起点圆点、不立牌。方向线末端用「木柱路牌 + 地面方向箭头」表示探索方向。
- `GET /api/worlds/:id` 会先 `computeFrontier` 再 `ensureDirectionFrontiers`：老世界/示例世界如果从未算过 frontier，方向线会全部不渲染；现在打开世界会修正 frontier（示例世界 17/24 个 frontier 节点）。
- 节点间距：`placeAround` 默认最小间距 282、环半径 300–936（整体约为上一版的 1.2 倍）；方向 frontier 偏移也 ×1.2（312/408/528/672，净空 216）。
- 关系线弧度：使用三次贝塞尔（bow = clamp(len×0.16, 18, 110)），比原来的二次弧更缓、两端切线更顺。
- **探索方向的生成规则**：方向生成时（`suggestDirections`）就由 LLM 计划好延伸节点 `target{name,type,definition,aliases}` 和关系 `predicate/label`；`directions` 表与 `edges` 表用 `target_name/target_type/target_definition/target_aliases/target_predicate/target_label` 存计划（老库自动补列）。点击方向不再是“拿问题当文本抽取”，而是 `POST /api/worlds/:id/explore` 直接落这个计划节点；老方向没有计划时先在 explore 端点懒规划一次并写回，再落图。生成失败/无计划时方向保留，不消费。
- 方向落点：新节点围绕该方向线的 frontier 点、沿 source→frontier 方向放置（`placeAround` + preferAngle；实测量到 frontier ≈300、角度偏差 ~22° 以内）。
- provisional 节点直接作为地图节点渲染，与 committed 同一套坐标（不用另一套 ghost 坐标）；标签显示「候选 · 名字」、虚线弱化样式与脉冲环，commit 后恢复普通标签样式。
- 相机只在进入世界（world id 变化）时自动 fit 一次，把全部节点+副本框进视野；之后新增节点不重设相机，也不给 OrbitControls 传会随每次重渲染重设的 `target` prop。
- 节点坐标到世界坐标的映射用“当前节点包围盒质心”居中（`World3D.tsx` 的 `posOf` 用 `cx/cy`），所以节点集合变化时整张地图会按新包围盒重新居中；这是既有布局行为，不是相机移动。
- 方向消费：`POST /api/edges/:id/consume` 以 `directions` 表为源，按 world/node/question 找 open 方向置 `consumed`；投影边只打 `consumed=1`。
- `direction` 边只有 frontier 节点渲染。
- `/api/worlds/:id/stream/detect` 路由仍存在，但前端不再调用；`ghosts` 现在恒为空（`GhostIsland` 渲染代码仍在，但不会出现）。
- 3D 资产在 `web/public/assets3d/`：21 个岛屿 + 2 个副本门，`manifest.json` 映射。

## 9. 文字链路与下游

`POST /api/worlds/:id/extract` 是旧的批量链路：

- DeepSeek 抽取节点/关系；
- 直接建 committed 节点；
- 规则检测流程/领域副本；
- 生成题目/方向等下游；
- 关系方向做了归一：`prerequisite` 按证据中两端出现先后交换；`partOf` 且 label 含“组成/包含/由”但不含“属于”时交换成“部分→整体”。

语音 `/stream/segment` + `/stream/commit` 当前**不会**触发出题、副本、方向；这是当前实际行为，不要假设它会自动发生。

MVP 前端目前不展示答题与 tier；后端题目接口（`/api/nodes/:id/quiz`、`/api/quiz/:id/answer`）仍保留，`/extract` 仍会为前 3 个新节点异步生成题目。

## 10. 当前验证方式

```bash
pnpm typecheck
pnpm build
```

已实际验证（2026-11-16 本轮）：

- `typecheck`、`build` 通过；
- stream API（真实豆包 ASR + 真实 DeepSeek，`server/eval/voice-test.wav`）：
  - 模拟旧前端把 segment 累计文本 + final 全文各 ingest 一次：修复前 11 条边、3 对重复关系；修复后 11 条边、重复关系=0（服务端幂等兜底）；
  - 按句去重（新前端语义）：8 条边、4 条非 source 关系、重复=0；
  - 独立语音链路断言：3 个 provisional 全部 committed、commit 前后逐节点坐标差=[]、suggest→formal（commit 后 suggest=0/formal=3）、边唯一键数=边数（6/6）；
- focus/parent：文本里最后提到的已有节点成为 focus 与 parent（脚本复现通过）；
- DeepSeek 20s 超时、失败不落图（返回 warning）、关系幂等、删除世界无孤儿行；
- 浏览器（Chrome headless + 假麦克风 `voice-test.wav`，CDP 驱动）：
  - 真实麦克风路径：provisional 节点标签「候选 ·」出现（`n3d-label provisional`），停止后 6/6 committed、commit 前后坐标差=[]、重复边=0、重复节点=0；final 后自动重连继续录音生效（13.2s 本句确认 → 13.7s 继续识别；22.8s → 23.3s）；
  - mock 试听：一次走完 4/4 committed、0 重复；文字链路 textarea + Ctrl/⌘+Enter：3 个新节点 committed、0 重复、输入框清空；
  - console 无未捕获异常（只有 THREE 版本警告/favicon/HMR 噪音）；
  - 相机矩阵实测：三条链路新增节点/commit 期间 viewMatrix 不变；用户拖拽视角后再新增节点，旧代码 1.6s 后被 CameraFit 重置（view 差 0.986），现在保持（0.001）；
- 验收期间还发现并修复两处 dev 环境问题：React StrictMode 下 InputBar 挂载 effect 双调用导致 `.mic`/`.mock-btn` 无响应（挂载 effect 复位状态机 ref）；OrbitControls 收到的 `target` prop 会在每次重渲染时把 target 设回原点（已移除该 prop，世界中心只由 CameraFit 设置）。
- 2026-11-16 MVP 前端改动（Chrome CDP + 真实 DeepSeek 验收）：四种线美术（管状/虚线/点线+信标）、线点击打开一句话关系文档、节点文档（名称/正文/来源）、MVP 隐藏答题区与 tier；正式/来源/方向文档与节点文档实测通过，建议线「接受」后 kind 变 formal，console 无异常；`pnpm typecheck`/`pnpm build` 通过。验收脚本与截图在仓库外：`_verify/probe-mvp-lines.mjs`、`_verify/probe-mvp-suggest.mjs`、`_verify/probe-line-click.mjs`、`_verify/probe-drawer-z.mjs`、`_verify/shots/mvp-*.png`。
- 2026-11-16 修复：示例世界所有节点 frontier=0 导致方向线全部不渲染（GET world 现在先 computeFrontier，示例世界修复后 frontier=17/24、未消费方向 7 条可见）；恢复建议/方向路牌（木柱牌），并把副本标题的 Html 层级压到抽屉以下（drawer z=100）。
- 2026-11-16 交互调整：节点间距与 frontier 偏移 ×1.2；关系线改三次贝塞尔缓弧；方向线末端改为「旧版木柱路牌 + 地面方向箭头」。
- 2026-11-16 探索规则修正：方向生成时预先计划延伸节点；点击方向调用 `/explore` 直接落计划节点（不再拿问题当文本抽取），落图后消费方向并给新节点继续生成计划方向。CHROME CDP 实测：方向抽屉显示“会直接生成预先规划好的节点：生成器——…”，按钮「生成「生成器」」，点击后节点落图、方向消失、toast「沿方向生成「生成器」」，console 无异常。

没有 CI、没有自动化单元测试框架；以上验证用的是临时复现/验收脚本（不在本仓库内），没有引入测试框架。LLM 失败时的前端 warning/toast 本轮只做了代码级确认，未在真实失败场景下动态验证。

## 11. 代码地图

```text
server/src/
  env.ts                 环境变量/provider
  db.ts                  barrel + world/getGraph/recordAttempt/refresh/seed
  db/                    connection/schema/repo（nodes/edges/quizzes/sources/domain/directions/buildings）
  index.ts               express/server/ws 装配 + health（约 71 行）
  routes/                graph/stream/nodes/edges/worlds/buildings/worldAdmin/dev
  services/              directions（物化/消费）、buildings（检测/刷新）
  stream/session.ts      语音 provisional/focus/关系幂等/commit
  providers/types.ts     LLM/ASR 接口（ExtractResult 可带 warning）
  providers/deepseek.ts  DeepSeek（20s 超时；抽取失败不降级 mock）
  providers/doubao.ts    豆包 ASR
  providers/mock.ts      mock
  placement.ts           placeAround
  layout.ts              elk 布局
  wfc.ts                 WFC 岛屿布局
  assetops.ts            建筑坐标/方向/隐藏/导出
  dungeons.ts            副本检测
  experiments/           anchorFirst、exploreSim（不是主链路）

web/src/
  App.tsx / main.tsx
  api.ts                 REST 类型/客户端（re-export shared DTO）
  store.ts               Zustand slices 组合（约 14 行）
  store/                 types/worldSlice/streamSlice/streamText
  hooks/useVoiceInput.ts 麦克风/WS/segment/commit 状态机
  components/InputBar.tsx
  components/World3D.tsx / World3DScene.tsx / World3DEdges.tsx
  components/Home.tsx
  components/World.tsx
  components/NodeDrawer.tsx
  components/RelationDrawer.tsx
  components/BuildingDrawer.tsx
  models3d.ts
  styles.css / styles3d.css
```
