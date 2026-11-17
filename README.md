# [👉 打开本地应用：http://localhost:5173](http://localhost:5173)

**前端** http://localhost:5173 ｜ **后端** http://localhost:8787 ｜ **麦克风/ASR 自检** http://localhost:5173/mic-test.html

---

# 知识世界（blouck）

把语音/文字输入变成可探索、可编辑、可挑战的 3D 知识地图。

## 文档

- **实现事实（找 bug 只看这个）**：[docs/03-implemented.md](docs/03-implemented.md)
- 之前讨论过的设想：[docs/01-ideas.md](docs/01-ideas.md)（历史，不是实现依据）
- 之前尝试/推断过的措施：[docs/02-reasoning.md](docs/02-reasoning.md)（历史，不是实现依据）
- 使用问题与探索记录：[docs/04-problems.md](docs/04-problems.md)（过程记录，不是实现依据）
- 线系统设计草稿：[docs/05-line-system-draft.md](docs/05-line-system-draft.md)（早期研究，不是当前口径）
- **四类线体验与设计口径（v2.0，未实现）**：[docs/06-four-line-system.md](docs/06-four-line-system.md)（只写用户感受/视觉/交互/设计思路，含关系 MD、节点 MD、副本体验，Q1–Q7 待确认）
- **四类线实现笔记（当前代码/迁移选项）**：[docs/07-line-implementation-notes.md](docs/07-line-implementation-notes.md)（不是需求）
- **锚点优先/关系准入验证 Q&A**：[docs/08-relation-gate-qa.md](docs/08-relation-gate-qa.md)（dev 验证、当前模型重跑、真实链路与坑）
- **新工程师认知成本与简化方案**：[docs/10-onboarding-cognitive-load.md](docs/10-onboarding-cognitive-load.md)（命名/职责/状态/文档问题，P0/P1/P2）
- 索引：[docs/00-index.md](docs/00-index.md)

> `01/02` 是历史记录，`04` 是问题/方案探索过程，`05` 是早期设计草稿，`06` 是需求口径，`07` 是实现笔记；代码里有没有某个能力，只以 `03-implemented.md` 和源码为准。

## 当前实际链路

```text
麦克风
→ AudioWorklet 原生采样率 + 16k 重采样
→ /ws/asr（豆包 partial/segment/final）
→ /api/worlds/:id/stream/segment（provisional）
→ /api/worlds/:id/stream/commit（committed + formal 关系）
```

文字输入仍走：

```text
POST /api/worlds/:id/extract
```

## 快速开始

```bash
pnpm install
cp server/.env.example server/.env   # 可选；不配置自动 mock
pnpm dev
```

- 前端：http://localhost:5173
- 服务端：http://localhost:8787
- 麦克风/ASR 自检：http://localhost:5173/mic-test.html

## 开发命令

```bash
pnpm typecheck
pnpm build
pnpm --filter @blouck/server eval
pnpm --filter @blouck/server eval:dungeons
```

技术栈、接口、DB 字段、focus/关系/音频实现细节都在 [docs/03-implemented.md](docs/03-implemented.md)。
