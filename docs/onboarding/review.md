# 现在的审核方式

仓库目前**没有 CI、没有自动化单元测试框架**。审核靠下面几层。

## 1. 静态检查

```bash
pnpm typecheck          # server + web tsc --noEmit
pnpm build              # web vite build
```

## 2. API 冒烟

启动 server 后手测：

```bash
curl http://localhost:8787/api/health
curl http://localhost:8787/api/worlds
```

语音建图接口：

```text
POST /api/worlds/:id/stream/segment  {text, focusId}
POST /api/worlds/:id/stream/commit   {}
```

验收点：

- 新节点 `status=provisional`；
- commit 后同 ID 变 `committed`；
- 坐标不变；
- `suggest` 关系变 `formal`。

## 3. 浏览器验收

1. `pnpm dev`；
2. 打开 `http://localhost:5173`；
3. 点麦克风，允许权限，等“录音中…”；
4. 连续说几句，中间停顿；
5. 再点一次停止；
6. 检查 partial、final、provisional→committed、位置、focus。

独立音频/ASR 自检：

```text
http://localhost:5173/mic-test.html
```

重点看：

- `AudioContext` 是原生采样率（常见 48000）；
- 已发送字节数与说话时长匹配；
- 原始 MediaRecorder 回放正常；
- final 完整；
- 无电音/断句。

## 4. 评测脚本

```bash
pnpm --filter @blouck/server eval
pnpm --filter @blouck/server eval:dungeons
cd server && npx tsx eval/stream-voice-binding.ts
```

注意：

- `eval/report-*.json/md` 是历史结果，是否仍对应当前代码需要重跑确认；
- `stream-voice-binding` 依赖 `eval/voice-test.wav`；
- 这些脚本不是 CI，不会自动阻断合并。

## 5. 当前审核结论的边界

- 已用脚本/接口验证：typecheck、web build、stream API 的 provisional/commit、focus 多分支、关系 9.4 场景；
- 已人工验证：真实麦克风能出 partial/final（本机浏览器）；
- 未自动验证：真实麦克风连续说话、长停顿重连、48k/16k 音频质量、下游方向/题目/副本。
