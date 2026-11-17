# [👉 打开本地应用：http://localhost:5173](http://localhost:5173)

**前端** http://localhost:5173 ｜ **后端** http://localhost:8787 ｜ **麦克风/ASR 自检** http://localhost:5173/mic-test.html

---

# 知识世界（blouck）

把语音/文字输入变成可探索、可编辑、可挑战的 3D 知识地图。

## 文档

文档已按“工程 / 产品 / 历史 / 原设计基线 / 市场”分区，入口见 [docs/00-index.md](docs/00-index.md)。

- **实现事实（找 bug 只看这个）**：[docs/engineering/implemented.md](docs/engineering/implemented.md)
- **工程总览**：[docs/engineering/README.md](docs/engineering/README.md)（架构、术语、状态机、实验代码）
- **产品/体验口径**：[docs/product/four-line-system.md](docs/product/four-line-system.md)（四类线体验 v2.0，未实现）
- **线实现笔记**：[docs/engineering/line-implementation-notes.md](docs/engineering/line-implementation-notes.md)（当前 4 种 kind、迁移选项）
- **关系准入验证 Q&A**：[docs/engineering/relation-gate-qa.md](docs/engineering/relation-gate-qa.md)（dev 验证、当前模型重跑、真实链路坑）
- **新人认知成本与简化方案**：[docs/engineering/onboarding-cognitive-load.md](docs/engineering/onboarding-cognitive-load.md)（P0/P1/P2）
- **原设计基线（清理前）**：[docs/baseline/README.md](docs/baseline/README.md)
- **历史记录**：[docs/history/README.md](docs/history/README.md)
- **市场/官网 Brief**：[docs/marketing/web-bp-brief.md](docs/marketing/web-bp-brief.md)

> 代码里有没有某个能力，只以 `docs/engineering/implemented.md` 和源码为准；旧设计只作为“原来设计过什么”的来源。

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
pnpm test
pnpm build
pnpm --filter @blouck/server eval
pnpm --filter @blouck/server eval:dungeons
```

技术栈、接口、DB 字段、focus/关系/音频实现细节都在 [docs/engineering/implemented.md](docs/engineering/implemented.md)。
