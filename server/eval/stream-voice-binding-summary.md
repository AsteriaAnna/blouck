# 真实流式语音关系绑定测试

日期：2026-11-16
链路：`/ws/asr`（豆包 Seed ASR Streaming 2.0）← 16k PCM WAV（Windows Huihui TTS）
图初始节点：RAG、检索、增强生成
脚本：`server/eval/stream-voice-binding.ts`
音频：`server/eval/voice-test.wav`

---

## 1. 单句：混合检索属于检索

ASR：

```text
[partial] 混合
[partial] 混合检索
[partial] 混合检索属于
[partial] 混合检索属于检索
[partial] 混合检索属于检索。
[final] 混合检索属于检索。
```

结果：

```text
[provisional] n4 混合检索
[relation] 混合检索 --kindOf--> 检索
[commit] n4 混合检索 ← 检索
```

✅ 通过：新节点绑定到已有节点"检索"，没有挂到 RAG。

---

## 2. 单句：召回率衡量增强生成

ASR：

```text
[partial] 召回率
[partial] 召回率衡量
[partial] 召回率衡量增强生成
[final] 召回率衡量增强生成。
```

结果：

```text
[provisional] n4 召回率
[relation] 召回率 --related--> 增强生成
[commit] n4 召回率 ← 增强生成
```

✅ 通过：新节点绑定到已有节点"增强生成"。

---

## 3. 无关句

ASR：

```text
[final] 今天天气不错，楼下咖啡店排队很长。
```

结果：

```text
[skip] 无新概念
```

✅ 通过：没有建节点，焦点不变。

---

## 4. 多新节点句：混合检索由语义检索和向量检索组合而成

ASR：

```text
[partial] 混合检索有羽翼检索和项梁检索组合而成
[final] 混合检索有羽翼检索和项梁检索组合而成。
```

结果：

```text
[provisional] n4 混合检索
[provisional] n5 羽翼检索
[provisional] n6 项梁检索
[relation] 羽翼检索 --partOf--> 混合检索
[relation] 项梁检索 --partOf--> 混合检索
[relation] 混合检索 --kindOf--> 检索
[commit] n4 混合检索 ← 检索
[commit] n5 羽翼检索 ← 混合检索
[commit] n6 项梁检索 ← 混合检索
```

结构上正确：两个新节点都挂到混合检索。
但 ASR 把"语义检索/向量检索"识别成"羽翼检索/项梁检索"，**实体名错误**。

---

## 5. 多句连续语音：失败

把四句合成一段音频时：

- ASR partial 把多句粘在一起；
- final 只返回第一句；
- 第二、三句丢失或被拼成乱码。

原因：当前豆包 ASR final/分段处理不适合"一段音频多句"；provider 的 final 语义需要继续修。

---

## 6. 结论

✅ 已验证：

- `/ws/asr` 真实流式语音链路可用；
- 单句里新节点可以绑定到已有节点；
- 无关句可以跳过；
- 结构绑定（新→已有、新→新）可行。

❌ 未通过：

- 多句连续语音的分段/final；
- 中文术语识别（语义/向量 → 羽翼/项梁）；
- 多句一次性建图。

**卡点不是关系绑定算法，而是 ASR 文本质量与分段。**
下一步要么换支持热词/术语纠正的 ASR 接口，要么在前端做领域词纠错，再谈多句连续测试。
