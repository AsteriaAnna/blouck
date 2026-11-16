# 知识世界（blouck）项目说明

把口头/文字输入变成可继续探索、可编辑、可挑战的 3D 知识地图。

这是给**没有上下文的 AI 或新协作者**的入口。只描述当前仓库真实存在、已经落地的实现；不要根据历史讨论补功能。

## 先读什么

| 文档 | 内容 |
| --- | --- |
| [contracts.md](contracts.md) | 数据契约、接口契约、状态规则 |
| [tech.md](tech.md) | 当前技术方法与真实链路 |
| [files.md](files.md) | 每个目录/文件负责什么 |
| [review.md](review.md) | 现在怎么做审核与验收 |
| [results.md](results.md) | 最近成果与已知缺口 |
| [decisions.md](decisions.md) | 讨论过且必须与代码一致的技术决策 |

## 一句话架构

```text
React + Vite + R3F 3D 前端
  → Express + ws 服务端
  → DeepSeek 抽取/出题/判题
  → 豆包 Seed ASR Streaming 2.0
  → node:sqlite 持久化
```

## 两条输入链路

1. **语音链路（正式流式）**
   `InputBar` 麦克风 → AudioWorklet 原生采样率重采样到 16k → `/ws/asr` → 豆包 partial/segment/final → `/stream/segment` → provisional 节点 → `/stream/commit` → committed。
2. **文字链路（旧批量）**
   输入框提交 → `/api/worlds/:id/extract` → 直接建 committed 节点。

不要把两条链路混成一条改。语音链路的状态在 `server/src/stream/session.ts`，文字链路在 `server/src/index.ts` 的 `/extract`。

## 快速启动

```bash
pnpm install
cp server/.env.example server/.env   # 可选；不配 key 自动 mock
pnpm dev
```

- 前端：http://localhost:5173
- 服务端：http://localhost:8787
- 麦克风自检页：http://localhost:5173/mic-test.html
- 无 key 时 LLM/ASR 自动降级 mock，仍可走通 UI。

## 当前状态（2026-11-16）

- 语音：真实豆包 ASR、partial、self-check、keepalive、45000081 重连、48k→16k worklet 重采样已接；
- provisional/commit：已接，同一 ID、同一坐标；
- focus 栈、parent 选择、前者/后者指代：已实现；
- 关系：commit 时 `suggest → formal`，核心 9.4 场景已验证；
- 未完成：启动预暖、文本重写/标点修复、完整指代、commit 后触发方向/题目/副本、完整关系生命周期。

历史设计与未确认草案见 `docs/design/`，但**以本目录和代码为准**。
