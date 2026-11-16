# 知识世界（blouck）

把语音/文字输入变成可探索、可编辑、可挑战的 3D 知识地图。

## 文档

- **实现事实（找 bug 只看这个）**：[docs/03-implemented.md](docs/03-implemented.md)
- 之前讨论过的设想：[docs/01-ideas.md](docs/01-ideas.md)（历史，不是实现依据）
- 之前尝试/推断过的措施：[docs/02-reasoning.md](docs/02-reasoning.md)（历史，不是实现依据）
- 使用问题与探索记录：[docs/04-problems.md](docs/04-problems.md)（过程记录，不是实现依据）
- 索引：[docs/00-index.md](docs/00-index.md)

> `01/02` 是历史记录，`04` 是问题/方案探索过程；代码里有没有某个能力，只以 `03-implemented.md` 和源码为准。

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
