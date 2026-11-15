# RAG/IR 领域关系体系：为什么通用词表不够，需要补什么

日期：2026-11-16
背景：通用体系（SKOS/ISO 1087/ConceptNet/OBO RO）能覆盖 kindOf/partOf/prerequisite，但**不能表达 RAG/IR 领域的功能关系**，例如：
`召回率 measures 召回`、`混合检索 combines 语义检索`、`语义检索 implementedBy 向量检索`。
结论：需要"上层结构关系 + 领域功能关系 + 过程关系 + 评价关系"的组合，**没有单一现成体系能完全覆盖**。

---

## 1. 我之前的搜索方向错在哪

| 我搜的 | 问题 |
| --- | --- |
| SKOS、ISO 1087、ConceptNet、OBO RO、WordNet | 都是**上层/通用**知识组织体系，只有 `kindOf/partOf/related` 这类结构关系 |
| 关系抽取论文（REBEL/GLiREL/DocRED） | 讲"怎么抽关系"，不定义领域关系体系 |
| 概念图/KST | 讲先修/层级，不覆盖检索、召回、指标、实现方式 |

**正确方向应该是：**

1. 领域分类体系：RAG 综述的 taxonomy、IR 教材/术语表、ACM CCS；
2. 领域词表/本体：ISO 25964（信息检索叙词表）、IR 评价指标本体；
3. 通用关系模式：Wikidata 属性、Ontology Design Patterns、SKOS/RO；
4. 领域论文：RAG survey、IR evaluation、检索架构。

---

## 2. 找到的相关资料

### 2.1 RAG 综述的 taxonomy

- **Retrieval-Augmented Generation for Large Language Models: A Survey**（[arXiv 2312.10997](https://arxiv.org/abs/2312.10997)）
- 把 RAG 拆成 **Retrieval / Generation / Augmentation** 三部分，并分 Naive/Advanced/Modular RAG。
- 对我们的价值：给出 RAG 的**结构关系**（RAG 由检索、生成、增强组成），但**不是关系词表**，没有定义 `measures/uses/combines` 等谓词。
- 结论：可以借"组件/阶段"划分，不能直接当关系体系。

### 2.2 ISO 25964（信息检索叙词表）

- ISO 25964-1:2011/2025，信息与文献——叙词表与互操作，面向**信息检索**的叙词表标准（[ISO/DIS 25964-1 draft](https://www.dinmedia.de/en/draft-standard/iso-dis-25964-1/392705730)）。
- 关系类型：**等价关系、层级关系（属种/整体-部分）、关联关系**。
- 对我们的价值：领域词表的"标准关系三分"，比 SKOS 更贴近 IR；但仍不覆盖 `measures/uses/implementedBy`。
- 局限：标准收费；不是 RAG 本体。

### 2.3 通用关系属性（Wikidata / ConceptNet / OBO RO）

- **Wikidata**：`subclass of`（P279）、`part of`（P361）、`has part`（P527）、`uses`（P2283）、`follows`（P155）、`followed by`（P156）、`has quality`（P1552）等；[基本成员关系说明](https://www.wikidata.org/wiki/Help:Basic_membership_properties)。
- **ConceptNet**：34 种关系，含 `IsA`、`PartOf`、`HasA`、`HasPrerequisite`、`UsedFor`、`CapableOf`、`HasProperty`、`Causes`、`HasSubevent`、`MannerOf`、`RelatedTo` 等（[列表](https://github.com/commonsense/conceptnet5/wiki/Relations)）。
- **OBO RO**：`part_of`、`has_part`、`preceded_by`、`precedes`、`regulates` 等，带形式化公理（[RO](https://obofoundry.org/ontology/ro.html)）。
- 价值：可借 `uses/follows/measures?` 的命名和方向；但都没有 RAG/IR 的领域语义（如"召回率 measures 召回"）。

### 2.4 领域 RAG/IR 本体

- 有"ontology-based RAG"的论文（如面向维护助手的 RAG 流程），但它们是**用本体做检索**，不是定义 RAG 概念关系；
- 没有找到一个公开、成熟、覆盖 RAG/IR 概念关系（检索/召回/指标/实现方式）的 OWL 本体；
- 所以：**必须自建领域关系层。**

---

## 3. 你列的这些概念，用现有六类为什么不够

| 概念对 | 直觉关系 | 六类里能放哪 | 问题 |
| --- | --- | --- | --- |
| **召回 ↔ 召回率** | 指标衡量过程 | `related`? | 丢失"度量"语义；`kindOf/partOf` 都不对 |
| **语义检索 ↔ 混合检索** | 混合检索包含/组合语义检索 | `partOf`? | 混合检索不是"整体由部分构成"的物理组成，而是"方法组合"；`kindOf` 也不对（语义检索不是混合检索的子类） |
| **向量检索 ↔ 语义检索** | 向量检索是实现方式 | `kindOf`? | 语义检索是目标/方法，向量检索是实现技术；用 `implementedBy` 更准 |
| **RAG ↔ 检索** | RAG 使用检索 | `partOf`? | RAG 不是"检索的一部分"，是"使用检索的框架"；`uses/hasComponent` 更准 |
| **Reranking ↔ 召回** | 召回之后精排 | `prerequisite`? | 可以，但还缺"阶段顺序/stageOf"；方向要固定 |
| **检索 ↔ 召回** | 召回是检索的一个阶段/能力 | `partOf`? | 可以近似，但 `stageOf` 更准 |
| **RAG ↔ 微调** | 对比/取舍 | `contrast` | 可以，但"替代"需要 alternative；取舍/tradeoff 没有 |

**根因：六类都是"结构/比较"关系，缺"功能/过程/评价"关系。**

---

## 4. 建议的领域关系体系（分层）

### 4.1 先区分实体类型（否则关系一定错）

| 类型 | 例子 |
| --- | --- |
| Process / Stage 过程/阶段 | 检索、召回、Reranking、生成 |
| Method / Technique 方法/技术 | 语义检索、向量检索、混合检索、RAG、微调 |
| Framework / System 框架/系统 | RAG、检索系统 |
| Metric 指标 | 召回率、准确率、NDCG |
| Resource / Component 资源/组件 | 向量数据库、索引、BM25 |
| Quality 质量 | 相关性、准确性、延迟 |

### 4.2 关系族 + 谓词

| 关系族 | 谓词 | 语义/方向 | 例子 |
| --- | --- | --- | --- |
| 结构 | `kindOf` | 具体→上位；传递 | 语义检索 kindOf 检索 |
| 结构 | `partOf` | 部分→整体；传递 | 召回 partOf 检索流程 |
| 结构 | `hasComponent` | 整体→组件（partOf 的逆） | RAG hasComponent 检索 |
| 功能 | `uses` | 使用者→被使用 | RAG uses 检索 |
| 功能 | `implementedBy` | 抽象方法→实现技术 | 语义检索 implementedBy 向量检索 |
| 功能 | `combines` | 方法→被组合的方法（≥2） | 混合检索 combines 语义检索、关键词检索 |
| 过程 | `stageOf` | 阶段→过程 | 召回 stageOf 检索 |
| 过程 | `precedes` | 先→后；传递 | 召回 precedes Reranking |
| 评价 | `measures` | 指标→被度量对象 | 召回率 measures 召回 |
| 评价 | `improves` | 方法→指标/质量 | Reranking improves 准确率（需证据） |
| 评价 | `tradeoffWith` | 对称；指标/方法之间 | 召回率 tradeoffWith 准确率 |
| 比较 | `contrast` | 对称；对比 | RAG contrast 微调 |
| 比较 | `alternative` | 旧→新；替代 | 关键词检索 alternative 语义检索（视语境） |
| 关联 | `related` | 对称；弱关系；需证据 | RAG related 评测 |
| 注释 | `analogy` / `example` | 非知识关系，不进正式图 | RAG analogy 灰姑娘 |

### 4.3 方向/传递/约束

| 谓词 | 方向 | 传递 | 约束 |
| --- | --- | --- | --- |
| kindOf | 具体→上位 | ✅ | 不允许环；可多父 |
| partOf | 部分→整体 | ✅（有例外） | 不允许环 |
| hasComponent | 整体→组件 | ✅（反向） | partOf 的逆，不重复存 |
| uses | 使用者→被使用 | ❌ | 需证据 |
| implementedBy | 抽象→实现 | ❌ | 需证据 |
| combines | 组合方法→组件方法 | ❌ | 至少 2 个组件 |
| stageOf | 阶段→过程 | ✅ | 不允许环 |
| precedes | 先→后 | ✅ | 不允许环 |
| measures | 指标→对象 | ❌ | 指标必须是 Metric 类型 |
| improves | 方法→指标/质量 | ❌ | 需证据/对比 |
| tradeoffWith | 对称 | ❌ | 常用于指标 |
| contrast | 对称 | ❌ | 同类型比较 |
| alternative | 旧→新 | ❌ | 需语境/证据 |
| related | 对称 | ❌ | 弱关系，证据强才正式 |
| analogy/example | 无方向 | ❌ | 只进 MD |

### 4.4 用这套体系解释你的例子

| 句子/概念对 | 推荐关系 |
| --- | --- |
| RAG 与 检索 | `RAG uses 检索`（或 `RAG hasComponent 检索`） |
| 检索 与 召回 | `召回 stageOf 检索`（召回是检索的一个阶段/能力） |
| 语义检索 与 检索 | `语义检索 kindOf 检索` |
| 向量检索 与 语义检索 | `语义检索 implementedBy 向量检索`（若把向量检索视为实现技术） |
| 混合检索 与 语义检索 | `混合检索 combines 语义检索`（同时 `combines 关键词检索`） |
| 混合检索 与 检索 | `混合检索 kindOf 检索` |
| 召回 与 召回率 | `召回率 measures 召回` |
| RAG 与 召回率 | `RAG evaluatedBy 召回率` 或 `召回率 measures RAG 的检索质量`（更精确：`measures` 的对象是检索/召回，不是整个 RAG） |
| Reranking 与 召回 | `召回 precedes Reranking`；`Reranking stageOf 检索` |
| RAG 与 微调 | `RAG contrast 微调`；若说"替代"则 `微调 alternative RAG`（方向按旧→新） |
| RAG 与 知识库 | `RAG uses 知识库`（若语境是检索来源）；类比则 `analogy` 注释 |

**注意"RAG evaluatedBy 召回率"这种说法不够精确**：召回率衡量的是"召回/检索质量"，不是整个 RAG；更准确是 `召回率 measures 召回`，`RAG hasComponent 召回`。这就是实体类型+关系签名要解决的问题。

---

## 5. 和现有六类的关系

- 六类可以保留为"上层/教学关系"，但**不够**；
- 建议扩展为两层：
  - **核心教学关系**：kindOf / partOf / prerequisite（或 precedes/stageOf）/ contrast / alternative / related；
  - **领域功能关系**：uses / implementedBy / combines / measures / improves / tradeoffWith / hasComponent。
- 地图线型仍可保持 formal/suggest/source/direction；领域谓词只影响关系名/卡片/推理，不必每种都变成不同线型。

---

## 6. 是否存在"完全覆盖"的现成体系？

**没有。**

- RAG 综述给结构，不给关系词表；
- ISO 25964 给 IR 叙词表关系（等价/层级/关联），不给 `measures/uses/implementedBy`；
- SKOS/ISO 1087/WordNet/ConceptNet/OBO RO 给通用关系，不给 RAG/IR 领域功能关系；
- 没有找到公开成熟的 RAG/IR 领域本体覆盖"检索/召回/指标/实现"；
- 所以必须：**通用体系 + 自建领域关系层 + 程序约束**。

---

## 7. 下一步

1. 把实体类型（Process/Method/Framework/Metric/Resource/Quality）写进 schema；
2. 把关系签名（domain/range）写出来，防止 `召回率 kindOf 召回` 这类类型错误；
3. 为每个谓词写方向/传递/逆关系/循环约束；
4. 用你列的 8 个概念 + 10 条关系做 gold 集，验证 LLM 能否按这套 schema 输出；
5. 再决定地图上如何展示（关系族/关系卡，而不是每条线一个新样式）。

---

## 8. 参考

- RAG Survey：https://arxiv.org/abs/2312.10997
- ISO 25964-1（IR 叙词表）：https://www.dinmedia.de/en/draft-standard/iso-dis-25964-1/392705730
- SKOS：https://www.w3.org/TR/skos-reference/
- ISO 1087：https://www.iso.org/standard/20057.html
- ConceptNet Relations：https://github.com/commonsense/conceptnet5/wiki/Relations
- OBO RO：https://obofoundry.org/ontology/ro.html
- Wikidata basic membership：https://www.wikidata.org/wiki/Help:Basic_membership_properties
- 概念图/KST：https://github.com/vanderbilt-data-science/knowledge-spaces

---

*本文是领域关系体系提案，不是已确认 schema；需要产品确认谓词集合与方向规则。*


---

## 9. 设计修正：MD-first，不要过度节点化/类型化

### 9.1 你的两个批评

1. **每个节点本身有 MD，很多语义应该写在 MD 里，不是所有东西都要变成节点或关系；**
2. **先定节点类型（Process/Method/Metric/...）在实际使用里做不到，也不该成为前置条件。**

这两点成立。我上一版把"领域关系体系"做得过重：15 个谓词、6 种节点类型、domain/range 约束——那是本体工程，不是 MVP 需要的东西。

### 9.2 修正原则

#### 原则 A：节点 = 学习锚点，不是分类槽

- 节点只回答："这是不是一个用户会反复看、会出题、会继续探索的学习对象？"
- `type` 变成**可选标签**（nullable、可后改、可留空），不参与准入、不阻塞生成；
- 不做"先定类型再建节点"；
- 需要类型时，从 MD/使用中逐步补，而不是一开始强制分类。

#### 原则 B：MD 优先，图只放"导航所需"

- 节点的 MD 承载：定义、理解、例子、指标、实现方式、阶段说明、类比；
- 只有**影响导航/学习顺序/对比/副本**的关系才画成边；
- 领域细节（"召回率衡量召回""向量检索是语义检索的实现"）优先写进 MD；
- 如果用户需要在图上跳转，再建一条**带自由标签的关系**，而不是新增一个谓词。

#### 原则 C：最小关系集

首版只保留 5 个核心关系（+ 可选替代）：

| 关系 | 作用 |
| --- | --- |
| `kindOf` 归类 | 这个是什么的一种 |
| `partOf` 组成 | 这个由什么组成/属于哪个整体 |
| `prerequisite` 前置 | 先学什么再学什么 |
| `contrast` 对比 | 这两个有什么不同 |
| `related` 相关 | 有联系，但说不清具体类型 |
| `alternative` 替代（可选） | 一个替代另一个 |

**领域关系（uses / measures / combines / implementedBy / stageOf / improves / tradeoffWith）首版不作为一等谓词。**

- 先作为关系卡的**自由标签/说明**：`related` + label "衡量" / "组合" / "实现方式" / "阶段"；
- 或直接写进节点 MD；
- 只有当某类关系**反复出现、且需要程序推理**（例如出题、副本、排序）时，才升级为一等谓词。

#### 原则 D：关系卡承载语义，不靠谓词数量

关系卡显示：

- 核心谓词（kindOf/partOf/...）；
- 自由标签（"衡量" / "组合" / "实现" / "阶段"）；
- 一句解释；
- 证据；
- 方向。

这样"召回率衡量召回"可以是：

```text
召回率 --related(衡量)--> 召回
说明：召回率是衡量召回效果的指标
```

不需要新增 `measures` 谓词，也不需要给"召回率"定 Metric 类型。

### 9.3 用 MD-first 重新解释你的例子

| 例子 | 首版处理 |
| --- | --- |
| 召回 ↔ 召回率 | 两个都是学习锚点时可建两节点；关系 `related`，label "衡量"；否则召回率写进召回 MD 的"指标"区 |
| 语义检索 ↔ 混合检索 | 两节点；关系 `related`，label "组合"；混合检索 MD 写"由语义检索 + 关键词检索组成" |
| 向量检索 ↔ 语义检索 | 两节点；关系 `related`，label "实现方式"；语义检索 MD 写实现方式 |
| RAG ↔ 检索 | RAG MD 写"使用检索"；需要图上导航时 `related` label "使用" / `partOf`? 用自由标签更稳 |
| 检索 ↔ 召回 | 召回 MD 写"检索的一个阶段"；需要导航时 `partOf`（阶段→过程）或 `related(阶段)` |
| 召回 ↔ Reranking | `prerequisite`（先召回再精排）最自然；方向固定 |
| RAG ↔ 微调 | `contrast`；MD 写取舍 |
| RAG ↔ 知识库 | `related` label "使用/来源"；类比写 MD |

**结论：大部分领域语义用"节点 MD + 关系自由标签"就能表达，不必扩展成 15 个谓词。**

### 9.4 节点"值不值得建"的轻量判断（不依赖类型）

不做类型体系，但仍然要判断"是否建节点"：

1. 它是用户会反复看/会出题/会继续探索的学习对象吗？
2. 有来源/证据吗？
3. 它是不是另一个节点的细节（如果是，写进那个节点的 MD）？
4. 每片段最多新增几个节点？

这四问不需要先定类型。

### 9.5 什么时候才升级领域谓词

满足全部条件才考虑：

- 同一类语义在多个节点反复出现（例如"指标衡量过程"出现 10+ 次）；
- 需要程序推理（例如自动出题/副本/排序依赖它）；
- 自由标签不足以区分（"衡量"和"评估"被混用）；
- 有稳定方向和证据规则。

在此之前，**保持 5 个核心关系 + 自由标签**。

### 9.6 修正后的结论

- 不搞 15 谓词、6 类型、domain/range 的重本体；
- **节点 = 学习锚点 + MD；类型可选/后置；**
- **图只放导航关系；领域语义优先进 MD 或关系自由标签；**
- **首版 5 个核心关系 + 可选 alternative；**
- 等真实使用数据出现"必须一等谓词"的需求，再升级。

*本节是对 §4 领域关系体系的收敛：从"重本体"退回到"MD-first + 最小关系集"。*
