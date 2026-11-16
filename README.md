# 知识世界（blouck）· 桌面 Web MVP

把口头/文字输入变成可继续探索、可编辑、可挑战的 3D 知识地图。

## 📌 项目说明（给没有上下文的 AI / 新协作者）

完整入口在：

**https://github.com/AsteriaAnna/blouck/blob/main/docs/onboarding/README.md**

本地路径：

```text
docs/onboarding/
  README.md       总览、阅读顺序、当前状态
  contracts.md    数据/接口/状态契约
  tech.md         真实技术方法与链路
  files.md        每个目录/文件的作用
  review.md       现在的审核/验收方式
  results.md      最近成果与已知缺口
  decisions.md    讨论过且必须与代码一致的技术决策
```

> 先读 `docs/onboarding/`，不要把 `docs/design/` 里的历史草案当成已实现功能。

## 当前能跑什么

- 3D 知识地图：世界列表、新建、节点/关系/建筑、抽屉、题目、副本；
- 语音正式链路：
  `麦克风 → AudioWorklet 16k → /ws/asr → 豆包 partial/segment/final → /stream/segment → provisional → /stream/commit`；
- 文字链路：`/api/worlds/:id/extract` 直接建 committed 节点；
- focus 栈、parent 选择、前者/后者指代；
- 关系 `suggest → formal`；
- 无 key 自动 mock。

## 技术栈

- 前端：React 18 + TypeScript + Vite + Zustand + three.js + react-three-fiber + drei；
- 服务端：Node.js + Express + ws；
- 存储：Node 内置 `node:sqlite`（WAL）；
- LLM：DeepSeek Chat Completions；
- ASR：豆包 Seed ASR Streaming 2.0（`bigmodel_async`）。

## 快速开始

```bash
pnpm install
cp server/.env.example server/.env   # 可选；不配 key 自动 mock
pnpm dev
```

- 前端：http://localhost:5173
- 服务端：http://localhost:8787
- 麦克风/ASR 自检：http://localhost:5173/mic-test.html

## 关键入口

```text
server/src/index.ts          REST + /ws/asr
server/src/stream/session.ts 语音 provisional/focus/commit 核心
server/src/providers/doubao.ts 豆包 ASR 协议
server/src/db.ts             SQLite schema/迁移
web/src/components/InputBar.tsx 麦克风/ASR/segment/commit
web/src/components/World3D.tsx  3D 地图与 provisional 渲染
web/src/store.ts             Zustand 状态
```

## 关键接口

```text
GET  /api/health
GET  /api/worlds
POST /api/worlds
GET  /api/worlds/:id
POST /api/worlds/:id/extract             文字批量建图
POST /api/worlds/:id/stream/segment      语音段 → provisional
POST /api/worlds/:id/stream/commit       provisional → committed
POST /api/nodes/:id/quiz/generate
POST /api/quiz/:id/answer
POST /api/buildings/:id/challenge
POST /api/buildings/:id/submit
WS   /ws/asr                             start/audio/stop
```

## 已知缺口

- 启动预暖（getUserMedia 之前采集不了）；
- 文本重写/标点修复；
- 完整代词/省略；
- commit 后不触发方向/题目/副本；
- PCM WAV 句尾轻微瞬态，不影响 ASR，暂不处理；
- 无 CI/自动化测试。

详细见 [docs/onboarding/results.md](docs/onboarding/results.md) 和 [docs/onboarding/decisions.md](docs/onboarding/decisions.md)。

## 开发命令

```bash
pnpm dev
pnpm typecheck
pnpm build
pnpm --filter @blouck/server eval
pnpm --filter @blouck/server eval:dungeons
```
