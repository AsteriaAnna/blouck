# 流式 ASR

### 7.1 ASR 识别质量差

真实测试现象：

- 语气词、没说清楚的地方识别不稳；
- "语义检索" → "羽翼检索"，"向量检索" → "项梁检索"（同音/近音）；
- "召回率" 被粘成 "检索召回率"；
- 对比微信输入法，明显更差。

根因：

1. 首帧请求没有传 `hotwords` / `context_data`；
2. 只使用 partial，没有用 final 修正；
3. 没有领域词纠错；
4. 微信输入法是"大模型 + 上下文/词库 + 录音后/离线"路线，不是同一条低延迟 streaming。

### 7.2 ASR 自动结束 / 正式结果不对

现象：用户还没按停止，识别就结束，正式图不完整。

根因：provider 把 `utterances[].definite` 和 `frame.flags & 2` 当成"整段结束"，直接 `onFinal` 并关闭连接。  
实际上它们只是"当前这一句结束"。

### 7.3 处理方案（已实现/已验证）

1. **首帧加 hotwords + context**：
   ```json
   request.corpus.context = {
     hotwords: [{word:"语义检索"}, ...],
     context_type: "dialog_ctx",
     context_data: [{text:"最近一轮用户话"}]
   }
   ```
2. **区分 utterance final 和整段 final**：
   - `definite` → `onSegment`；
   - 客户端 stop/end → `onFinal`；
   - 不再因为一句结束就关连接。
3. **partial 只做 UI**；segment final 用于建图/修正。
4. **前端开始录音时**把当前图谱节点名作为 hotwords 传给 ASR。

真实语音验证（4 句）：

- hotwords 后"语义检索/向量检索"识别正确（之前是羽翼/项梁）；
- 多句 final 能收全（之前只回第一句）；
- 关系绑定：混合检索 kindOf 检索；语义/向量 partOf 混合检索；
- 仍有一个问题：句子间停顿不够时，ASR 可能把"检索 + 召回率"粘成"检索召回率"，导致关系端点错。需要 VAD/句末停顿或前端纠错。

### 7.4 其他接入问题（部分已解决，保留为风险记录）

最小测试只在"单会话、内存图、干净分句、无下游"成立。接主链路会出现：

| 问题 | 具体表现 | 严重度 |
| --- | --- | --- |
| provisional 没地方存 | 节点表没有 provisional 状态；写进去会被当正式节点 | 高 |
| final 重新建节点 | `/extract` 不认识 provisional ID，重复建/覆盖 | 高 |
| 主 prompt 没有 parent | 测试的 `mentions.parent` 在主链路不存在，退回单 focus | 高 |
| 下游污染 | provisional 被出题/副本/方向/frontier 使用 | 高 |
| 前端整包替换 | `store.extract` 用返回覆盖 nodes/edges，冲掉 provisional | 高 |
| ASR partial 重复 | 同一句反复抽，重复节点、父节点跳变 | 中 |
| 本地匹配误配 | 短名/别名/多命中，父节点错 | 中 |
| 父节点线索过拟合 | 只覆盖"分为/包括"，换说法就错 | 中 |
| 焦点不持久 | extract 后 focusId 不推进，跨句/交互丢焦点 | 高 |
| 位置/动画冲突 | provisional 先出现、final 换父/换布局，节点跳 | 中 |
| 并发/乱序 | 旧 detect/extract 返回覆盖新焦点 | 中 |
| 评测不兼容 | 旧 eval 只认 entities/relations | 中 |

**接之前必须先定：**

1. provisional 存哪（服务端会话 / DB 表 / 前端）；
2. final 是否还调 `/extract`（调就必须按 provisional ID 合并，不能重建）；
3. provisional 是否禁用下游（题目/副本/方向/正式统计）。

---



---

## 8. 音频采集链路（2026-11-16 收口）

### 8.1 现象

- 自检页 final 文字基本完整正确；
- 但下载的 PCM WAV 有明显“炸麦/电音”；
- 关闭 AEC/降噪/AGC 后仍然存在；
- 原始 MediaRecorder 录音正常。

### 8.2 根因

1. 麦克风轨道原生 48000，之前强制 `AudioContext({sampleRate:16000})`；
2. 在主线程按 128 帧逐块重采样，块间相位断开，产生周期性断裂；
3. 48k→16k 没有抗混叠低通，句尾气音/齿音会折叠成金属感；
4. 停止时尾部 PCM 不足一个 1600 采样块，没有 flush，最后一句会缺。

### 8.3 已实现

- `AudioContext` 不再强制 16k，使用原生采样率；
- 重采样移入 AudioWorklet，连续相位线性插值；
- 停止前 flush 尾部 PCM，并补 300ms 静音；
- 自检页保留原始 MediaRecorder 回放；
- 自检页可关闭 AEC/降噪/AGC 对比。

参考实现：

- [openqht/doubao-s2s-example audio-processor.js](https://github.com/openqht/doubao-s2s-example/blob/master/static/audio-processor.js)
- [AvatarChatbot 修复：不强制 16k，worklet 重采样](https://huggingface.co/spaces/wishartgroup/AvatarChatbot/commit/13295a63a459ca66fd4de9d7d788e8b5037f506f)
- [libsamplerate-js](https://github.com/aolsenjazz/libsamplerate-js)

### 8.4 验证与决策

- 修复后 PCM WAV 明显改善，ASR 实时/final 文字完整正确；
- 仍有偶发句尾短瞬态；对比原始 webm 同一位置也有一瞬态，高质量浏览器重采样后仍存在，判断为源采集流本身，不是重采样；
- 线性插值不做抗混叠，句尾气音仍会比原始略“炸”，但不影响识别；
- 决策：**不再为 PCM WAV 音质加复杂度**。PCM 只是 ASR 输入；如果未来要存证/回放，保留原始 MediaRecorder 录音，或再加 7.5kHz 低通/高质量重采样。
