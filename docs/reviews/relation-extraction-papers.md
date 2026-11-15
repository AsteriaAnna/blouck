# 实体关系判断：论文与资料清单

日期：2026-11-16
用途：为"两个节点之间是否有关系、是什么关系、方向如何"提供研究依据；不是实现方案。
相关：`docs/design/discussion-conclusions-2026-11-16.md`

---

## 0. 先给结论

关系判断不是"LLM 会不会"的问题，而是"任务怎么定义、证据从哪来、如何拒答、如何校验"的问题。相关研究可以分成六类：

1. **综述**：关系抽取/生成式信息抽取的整体地图；
2. **零样本关系分类**：不给标注数据，直接判断关系标签；
3. **生成式关系抽取**：把三元组当文本生成；
4. **LLM 的坑**：虚假关联、负例干扰、方向/标签不稳定；
5. **教育概念图/先修关系**：最接近我们教学语义的领域；
6. **基准与评测**：DocRED/FewRel/TACRED 等。

---

## 1. 综述：先建立地图

### 1.1 Large Language Models for Generative Information Extraction: A Survey

- 链接：https://arxiv.org/abs/2312.17617
- 内容（摘要）：系统梳理 LLM 在信息抽取（含关系抽取）中的生成式方法，按子任务/技术分类，总结趋势与方向。
- 对我们：理解"生成式抽取"的能力边界与常见做法；知道为什么单次 prompt 容易"抽到就建"。
- 局限：综述，不提供现成判定器。

### 1.2 A Survey of Generative Information Extraction（COLING 2025）

- 链接：https://aclanthology.org/2025.coling-main.324.pdf
- 内容：生成式 IE 的另一篇系统综述。
- 对我们：可对照不同生成式 schema/prompt 策略。

### 1.3 A systematic review of relation extraction task since the emergence of Transformers

- 链接：https://arxiv.org/html/2511.03610v2
- 内容：Transformer 以来关系抽取任务/方法/数据集的系统回顾。
- 对我们：快速了解 RE 的任务形式（分类/三元组/文档级）与评测。

### 1.4 A survey on cutting-edge relation extraction techniques based on language models

- 链接：https://ar5iv.org/abs/2411.18157
- 内容：基于语言模型的关系抽取技术综述。
- 对我们：可选补充阅读。

---

## 2. 零样本关系分类：不训练也能判断关系

### 2.1 GLiREL — Generalist Model for Zero-Shot Relation Extraction

- 论文：https://arxiv.org/abs/2501.03172
- 代码：https://github.com/jackboyla/glirel
- 内容（摘要）：零样本关系分类；一次前向预测多个实体间的关系标签；在 FewRel / WikiZSL 上达到 SOTA；提供合成数据协议。
- 对我们：**最接近"给定实体对 + 关系标签，判断关系"的开源模型**；可作为成对判定的候选生成/分类器。
- 注意：代码许可证是 **CC BY-NC-SA 4.0（非商业）**，商用需谨慎；中文效果需实测。

### 2.2 GLiNER — 零样本 NER

- 论文：https://arxiv.org/abs/2311.08526
- 代码：https://github.com/urchade/GLiNER
- 内容：零样本命名实体识别，可指定任意实体类型。
- 对我们：候选实体生成，不解决关系/方向。
- 许可：Apache-2.0。

### 2.3 UniversalNER — 开放 NER 的定向蒸馏

- 论文：https://arxiv.org/abs/2308.03279
- 内容：从 LLM 蒸馏到小模型的开放命名实体识别。
- 对我们：候选实体抽取的另一种路径。
- 局限：NER，不是关系判断。

### 2.4 InstructUIE — 统一信息抽取的指令微调

- 论文：https://arxiv.org/abs/2304.08085
- 内容：多任务指令微调统一 NER/RE/事件抽取等。
- 对我们：说明"统一 schema + 指令"可以覆盖多任务；可参考其任务定义。
- 局限：需要训练/微调，不是零样本判定器。

---

## 3. 生成式关系抽取：把三元组当文本生成

### 3.1 REBEL — Relation Extraction By End-to-end Language generation

- 论文：https://aclanthology.org/2021.findings-emnlp.204/
- 内容（摘要）：用 seq2seq（BART）把关系三元组当文本生成，端到端抽取 200+ 关系类型；在多个 RE/RC 基准上 SOTA。
- 对我们：生成式抽取的代表；说明"关系标签体系"可以很大，但仍需 schema/方向约定。
- 局限：开放域关系，不保证教学语义/方向。

### 3.2 LLM with Relation Classifier for Document-Level Relation Extraction

- 论文：https://arxiv.org/abs/2408.13889
- 内容（摘要）：发现 LLM 在文档级 RE 中会被"无关系实体对"分散注意力；提出先用分类器筛出可能有关系的实体对，再交给 LLM 做最终关系分类。
- 对我们：**直接支持"先剪枝候选对，再让 LLM 判定"**；也说明"无关对"是性能关键。
- 局限：文档级 RE，不是教学关系。

---

## 4. LLM 的坑：为什么它会"硬找关系"

### 4.1 Unexpected Phenomenon: LLMs' Spurious Associations in Information Extraction

- 论文：https://aclanthology.org/2024.findings-acl.545/
- 内容（摘要）：LLM 在关系抽取等任务中会出现"虚假关联"——即使给定关系标签与原文语义无关，模型仍能识别出实体对并套上标签；中英文、不同模型规模都出现。作者用 forward label extension / backward label validation 来发现并利用这些标签，F1 有提升。
- 对我们：**关系判定必须允许 `unrelated`、必须做标签验证、不能只信模型输出的"有关系"**。
- 局限：研究现象与缓解策略，不是产品判定器。

### 4.2 方向性

- REBEL/DocRED/FewRel 等把关系视为有向三元组（head, relation, tail），但"方向"由数据集/标签定义，模型通常只学"head→tail 标签"；
- 没有通用的"partOf 必须部分→整体"约定；教学方向约定是我们产品自定义的；
- 所以：**方向不能只靠模型，必须用谓词定义 + 证据 + 程序校验。**

---

## 5. 教育概念图 / 先修关系：最接近我们教学语义

### 5.1 Automated Concept Map Extraction from Text（ACL 2025）

- 论文：https://aclanthology.org/2025.ldk-1.10/
- 内容（摘要）：概念图 = 文本中概念关系的语义图摘要；提出神经符号管线 + GPT-3.5 方法；模块化开源架构；在 WIKI 数据集上 F1 25.7/28.5，METEOR/ROUGE-2 有提升；代码开放。
- 对我们：**最接近"从文本抽概念+关系"的公开工作**；F1 25–28 说明任务本身很难，别期待一次到位。
- 局限：文档向，不是实时语音；不处理比喻/步骤/方向约定。

### 5.2 Knowledge Spaces（KST 开源实现）

- 仓库：https://github.com/vanderbilt-data-science/knowledge-spaces
- 内容：knowledge items、概念图/competences、QUERY 先修关系、knowledge states、outer fringe、BLIM 评估；MIT。
- 对我们：先修关系/可挑战/外边缘的理论与数据结构；不解决"从话里判断关系"。
- 相关理论：Doignon & Falmagne 的 Knowledge Space Theory；QUERY 算法（Koppen & Doignon, 1990）。

---

## 6. 基准与评测：怎么量"关系判断"好不好

| 数据集/基准 | 用途 | 链接 |
| --- | --- | --- |
| **DocRED** | 文档级关系抽取，实体对+关系+证据句 | https://arxiv.org/abs/1906.06127 |
| **FewRel** | 少样本关系分类 | https://arxiv.org/abs/1810.10147 |
| **TACRED** | 句子级关系分类（人物/组织等） | 经典数据集，论文 "Position-aware Attention and Supervised Data Improve Slot Filling"（EMNLP 2017） |
| **WikiZSL** | 零样本关系分类（GLiREL 使用） | 见 GLiREL 论文 |

评测指标（我们应自建）：

- 谓词准确率（六类 + unrelated）；
- 方向合法率；
- 无关判断的 precision/recall（尤其"本来无关却硬建关系"）；
- 证据覆盖率（关系是否有原文支持）；
- 每条判定的延迟/成本。

**注意**：DocRED/FewRel 的关系标签体系与我们的教学谓词不同，不能直接拿来当验收；只能借任务形式/指标。

---

## 7. 这些论文对我们的决策意味着什么

| 论文/资料 | 支持的决策 |
| --- | --- |
| GLiREL | 零样本关系分类可行；可做候选判定器（但许可非商业） |
| REBEL | 生成式关系抽取可行；schema 可以较大 |
| 生成式 IE 综述 | 单次抽取是主流，但需要 schema/校验 |
| LLM 虚假关联（ACL 2024） | **必须允许无关、必须做标签验证、不能盲信** |
| LLM+关系分类器（DocRE） | **先剪枝实体对，再让 LLM 判定** |
| ACL 2025 概念图 | 概念图抽取是研究级难题（F1 25–28），需要评测与人工兜底 |
| Knowledge Spaces | 先修关系/可挑战/外边缘可用 KST 建模 |
| DocRED/FewRel | 借任务形式与评测指标，不直接借标签体系 |

---

## 8. 关系识别方案（仍未定）

| 方案 | 依据 | 优点 | 风险 |
| --- | --- | --- | --- |
| A 生成式单次抽取 | REBEL、生成式 IE 综述 | 简单、快 | 无法拒答、虚假关联、方向不稳 |
| B 成对 LLM 判定 | 虚假关联论文、DocRE 分类器+LLM | 可控、可解释、可输出无关 | 需要证据/剪枝/批量；仍可能错 |
| C 零样本 RE 分类器 + LLM 校验 | GLiREL | 关系分类可能更稳 | 非商业许可、中文待验、方向弱 |
| D 混合（候选小模型 + LLM 判定 + 程序校验） | 以上综合 | 平衡 | 工程复杂，需要评测 |

**建议：先做 100 对离线对比（A/B/C），指标含谓词、方向、无关、证据、延迟；再决定。**

---

## 9. 推荐阅读顺序

1. **LLM 虚假关联（ACL 2024）** — 先知道坑；
2. **LLM+关系分类器（DocRE）** — 为什么要先剪枝；
3. **GLiREL** — 零样本关系分类能做到什么；
4. **REBEL** — 生成式关系抽取；
5. **概念图抽取（ACL 2025）** — 教育场景的难度；
6. **Knowledge Spaces** — 先修/可挑战/外边缘；
7. 综述按需查。

---

*本清单只做资料索引与关联分析；关系识别方案尚未拍板，需实验数据决定。*
