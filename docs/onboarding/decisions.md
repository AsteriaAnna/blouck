# 技术决策：必须与当前代码一致

这份文档用来防止后续 AI 把“讨论过但没做”的东西当成已实现。

## 1. 语音链路与文字链路是两条

- 语音：`/ws/asr` → `/stream/segment` → `/stream/commit`；
- 文字：`/api/worlds/:id/extract`，直接建 committed 节点；
- 两条链路不要合并改，除非整体重构并更新 `contracts.md`。

## 2. provisional 采用“同 ID”

- 节点表 `status: provisional | committed`；
- segment 创建 provisional；
- commit 只改 status，不重建、不改坐标；
- 前端直接渲染 provisional 节点，不再用 ghost 坐标。

## 3. focus 是栈，不是单 focus

- `focus_stack` 存节点 ID 数组；
- 栈顶当前主题；
- 一个句子创建多个兄弟节点时，兄弟入栈；
- 前者 → 栈第二，后者 → 栈顶；
- 关系 source/target 用 focus 栈 + 本句已有节点解析。

## 4. 音频采集

已确定并落地：

- AudioContext 用原生采样率；
- AudioWorklet 内连续相位重采样到 16k；
- worklet 输出 Int16，主线程不得再按 Float32 重采样；
- 停止前 flush 尾部 + 300ms 静音；
- 1.5s 无音频补静音 keepalive。

不要再写“预留 AudioWorklet 采集”“强制 16k AudioContext”“主线程重采样”这类旧描述。

## 5. ASR final 语义

- `segment` = 一句结束，不结束录音；
- `final` = 当前 ASR 会话结束；
- 用户停止才 commit；
- 45000081 是音频包超时，按会话结束/重连，不弹致命错误。

## 6. 关系绑定：只做到当前范围

已实现：

- 候选集解析 source/target + commit `suggest→formal`；方向仍以 LLM 输出为主；
- 9.4 核心场景已验证。

未实现，不要写成已有：

- relation 稳定 ID / lifecycle；
- 同一对节点最多 2 谓词；
- formal 冲突 disputed/revised；
- top-k 邻居候选；
- 完整实体链接/消歧。

`docs/design/streaming/relation-binding.md` 9.3 已标注“未确认设计草案”，不是需求。

## 7. 下游

语音 commit **不会**触发出题、副本、方向。

如果要做，需要显式接：

```text
commit 后：detectBuildings / direction / quiz
```

不要假设 `/extract` 里的行为会自动发生在语音链路。

## 8. 实验/历史代码

- `server/src/anchorFirst.ts` 是早期实验；
- `/stream/detect`、`/stream/preview` 是旧预览/候选接口；
- `prototype/` 是 3D 原型，不参与运行。

上面这些不是当前语音正式链路，不要拿它们当主实现依据。

## 9. 当前未完成

- 启动预暖（getUserMedia 前采集不了）；
- 文本重写/标点修复；
- 完整代词/省略；
- multi-candidate 置信度；
- 下游触发；
- CI/自动化测试。
