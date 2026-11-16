# 契约与规则

只写当前代码真实使用的契约。字段以 `server/src/db.ts` 为准。

## 1. 数据表与字段

### worlds

`id, name, root_node_id, is_demo, created_at`

### nodes

```text
id, world_id, name, x, y, free_md, hidden, tier,
type, definition, aliases(JSON string),
source_span_id, frontier,
status: provisional | committed,
created_at
```

规则：

- `x/y` 是服务端布局坐标；前端不要自己再算一套 provisional 坐标。
- `status=provisional` 只由语音链路 `/stream/segment` 创建。
- `commit` 只改 `status`，不重建节点、不改坐标。
- `aliases` 是 JSON 数组字符串。
- `frontier` 由 `computeFrontier` 计算，不能手写。

### edges

```text
id, world_id, src, dst, kind, label, md, question,
frontier_x, frontier_y, consumed,
predicate, evidence, confidence, origin,
claim_status, revision, created_at
```

`kind` 只有四种：

```text
formal | source | suggest | direction
```

规则：

- `source`：本轮探索来源，父节点 → 新节点；
- `suggest`：provisional 知识关系，commit 时由 `commitStreamEdges` 升级为 `formal`；
- `formal`：正式知识关系；
- `direction`：探索方向，只给 frontier 节点渲染。

### focus_stack

```text
world_id TEXT PRIMARY KEY
stack TEXT  -- 节点 ID 数组 JSON，最多 12 个，栈顶是当前 focus
updated_at INTEGER
```

### 其他表

`buildings, quizzes, attempts, source_spans, directions, domain_questions, hide_batches, daily_domain` 按 `server/src/db.ts` 使用；不要绕过现有函数直接写库。

## 2. 语音 WebSocket 契约

服务端：`/ws/asr`

客户端发给服务端：

```json
{ "type": "start", "hotwords": ["检索", "增强生成"] }
{ "type": "audio", "chunk": "<base64 PCM16LE 16k mono>" }
{ "type": "stop" }
```

服务端发给客户端：

```json
{ "type": "ready", "provider": "doubao" }
{ "type": "partial", "text": "..." }
{ "type": "segment", "text": "..." }
{ "type": "final", "text": "..." }
{ "type": "error", "message": "..." }
```

规则：

- `segment` 是“这一句确认”，**不结束录音**；
- `final` 是“当前 ASR 会话结束”，录音页据此决定 commit 或重连；
- 前端停止后必须发 300ms 静音再发 `stop`；
- 前端在 1.5s 没有音频时补静音 keepalive，避免豆包 45000081 超时；
- 豆包返回 45000081 时服务端按会话结束处理，不当作致命错误。

## 3. 语音建图 HTTP 契约

### POST `/api/worlds/:id/stream/segment`

请求：

```json
{ "text": "混合检索属于检索。", "focusId": "<node id>" }
```

返回：

```json
{
  "focusId": "...",
  "focusStack": ["..."],
  "createdNodes": [ ... ],
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

行为：

- 本地匹配已有节点；
- 新节点写成 `status=provisional`；
- parent 由 focus 栈 + 本句已有节点 + 关系端点选择；
- 关系写成 `kind=suggest`；
- 更新 `focus_stack`；
- 不触发方向/题目/副本。

### POST `/api/worlds/:id/stream/commit`

请求：`{}` 或 `{ "ids": ["..."] }`

行为：

- 目标 provisional 节点 → `committed`；
- `origin='stream'` 且 `kind='suggest'` 的关系 → `formal`；
- `computeFrontier`；
- 不重建节点、不改坐标。

## 4. 文字链路契约

`POST /api/worlds/:id/extract`：

- 输入稳定文本；
- 直接建 committed 节点和关系；
- 仍走旧批量逻辑，不是语音 provisional 链路；
- 不要把 `stream/session.ts` 的 provisional 逻辑搬到这里，除非整体重构并更新本文档。

## 5. 硬规则

1. provisional 不触发方向/题目/副本；
2. commit 不改节点 ID、不改坐标；
3. 关系不能默认 `source=focus`，要用候选集和证据；
4. `partOf` 方向目前依赖 LLM 输出；没有强制归一，不要写成已实现；
5. 已有 formal 关系不能被新关系静默覆盖；
6. 前端不要强制 `AudioContext({sampleRate:16000})`，也不要对 worklet 的 16k Int16 再重采样；
7. 不要把 `segment` 当成整段结束。
