# 最近的成果

截至 2026-11-16。

## 1. 语音链路已贯通

主页面：

```text
麦克风 → AudioWorklet 16k → /ws/asr → 豆包 partial
→ segment → /stream/segment → provisional
→ 停止 → /stream/commit → committed
```

已修：

- 48k→16k worklet 重采样（不再主线程二次重采样）；
- 句尾 PCM flush + 300ms 静音；
- 1.5s 无音频 keepalive；
- 豆包 45000081 自动重连；
- 主页面 Int16/Float32 二次解释导致“没有 partial、卡 final”的 bug。

提交：`bab29a7`、`3a16777`、`3d16a8c`。

## 2. provisional / commit

- 节点新增 `status`；
- `/stream/segment` 建 provisional；
- `/stream/commit` 同 ID 升级，不改坐标；
- provisional 节点在 3D 里显示“候选 ·”。

## 3. focus / 多焦点

已验证：

```text
RAG 包括检索和增强生成 → 都挂 RAG
检索分为稀疏/稠密 → 都挂检索
前者/后者 → 分别挂稀疏/稠密
混合检索属于检索 → 挂检索
RAG 还包括重排 → 挂 RAG
```

提交：`af82ce0`。

## 4. 关系

9.4 场景实测：

```text
混合检索 kindOf 检索
召回率 related 增强生成
语义检索/向量检索 partOf 混合检索
commit 后 suggest → formal
```

完整 relation ID/lifecycle/冲突规则**未实现**。

## 5. 已验证方式

- `pnpm typecheck` 通过；
- `pnpm build` 通过；
- 主页面用 48k 假麦克风端到端验证：partial 出现、provisional 创建、停止后 commit；
- 真实麦克风：本机能出 partial/final（人工）。

## 6. 已知缺口

- 启动预暖：`getUserMedia` 之前仍无法采集；
- 文本重写：卡壳逗号、近似词未系统纠正；
- 完整指代/省略恢复；
- commit 后不触发方向/题目/副本；
- PCM WAV 句尾轻微瞬态，已判定不影响 ASR，不再改；
- 无 CI/自动化测试。
