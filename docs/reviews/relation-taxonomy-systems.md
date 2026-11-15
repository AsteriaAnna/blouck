# 关系体系：可参考的标准、词表与规则

日期：2026-11-16
问题：有没有成熟的关系体系/区分系统，能覆盖我们的场景？规则是什么？
结论先行：**没有任何单一体系能完全覆盖；但 SKOS + ISO 1087 + OBO RO + ConceptNet + KST/概念图 可以覆盖大部分，剩下的 `alternative / contrast / analogy / example` 和方向/证据规则必须产品自定义。**

---

## 1. 可参考的体系一览

| 体系 | 类型 | 关系/规则 | 对我们的价值 | 局限 |
| --- | --- | --- | --- | --- |
| **SKOS**（W3C） | 知识组织系统标准 | `broader` / `narrower` / `related`；`broader` 可传递；`related` 对称；`related` 与 `broaderTransitive` 不相交；有完整性/循环约束 | 归类、关联、方向、反义/对称/传递规则的范本 | **没有 partOf / prerequisite**；偏分类法，不覆盖教学关系 |
| **ISO 1087**（术语学） | 术语标准 | 概念关系分 **generic（属种）/ partitive（部分-整体）/ associative（联想）** | 直接支撑 `kindOf` / `partOf` / `related` 的三分 | 标准文本收费；不定义教学方向/证据 |
| **WordNet** | 词义网络 | hypernym/hyponym（上下位）、meronym/holonym（部分-整体）、antonym（反义）、entailment 等 | `kindOf`、`partOf`、`contrast` 的词汇学依据 | 词义级，不是概念级；方向因关系而异 |
| **ConceptNet 5** | 多语言常识图 | 34 种关系，含 `IsA`、`PartOf`、`HasA`、`HasPrerequisite`、`Antonym`、`DistinctFrom`、`SimilarTo`、`RelatedTo`、`HasContext`、`MannerOf` 等 | 最接近"概念关系词表"的开放资源；中文可用 | 数据是常识断言，不是判定器；`HasPrerequisite` 方向与我们要相反；CC BY-SA |
| **OBO Relation Ontology (RO)** | 上层关系本体 | `part_of`、`has_part`、`preceded_by`、`precedes`、`regulates` 等，带形式化公理/逆向 | `partOf`/`prerequisite` 的方向、逆关系、传递性范本；CC0 | 生物医学背景；不覆盖教学/游戏语义 |
| **Knowledge Space Theory / Knowledge Spaces** | 教育测量理论 | surmise relation（先修准序）、knowledge states、outer fringe | `prerequisite` 的方向/闭包/可挑战条件的理论依据 | 假设 knowledge items 已给定；不解决文本抽取 |
| **Novak 概念图** | 教育理论 | 概念 + 带连接词的命题；层级、横向连接（cross-link）、例子 | 概念图的关系语义：层级/横向/例子；可映射 kindOf/partOf/related/example | 不规定形式化方向/传递性 |
| **课程概念图专利（KR102804240B1）** | 专利 | 关系类型：前提条件、包含、继承、因果、关联 | 说明教育场景常见关系类型 | 专利，不是开放标准 |
| **Schema.org** | Web 词表 | `isPartOf`、`hasPart` 等 | 词汇/命名参考 | 不是完整关系体系 |
| **DocRED / TACRED / FewRel / REBEL / GLiREL** | 关系抽取数据/模型 | 有向三元组；关系标签体系因数据集而异；有 `no relation` 类 | 关系抽取任务形式、无关系类、评测 | 标签体系不是教学关系；不定义方向约定 |

---

## 2. 覆盖矩阵：我们的谓词 vs 成熟体系

| 我们的谓词 | 最合适的参考 | 方向/规则 | 覆盖度 |
| --- | --- | --- | --- |
| **kindOf 归类** | SKOS `broader`；ISO 1087 generic；WordNet hypernym；ConceptNet `IsA` | 具体 → 上位；非对称；可传递；有逆（narrower/hasSubtype） | ✅ 高 |
| **partOf 组成** | ISO 1087 partitive；OBO RO `part_of`；ConceptNet `PartOf`；WordNet meronym | 部分 → 整体；非对称；可传递（有例外）；逆 `has_part` | ✅ 高（注意 SKOS 没有 partOf） |
| **prerequisite 前置** | KST surmise relation；ConceptNet `HasPrerequisite`；课程概念图专利"前提条件" | 前置 → 后续；非对称；可传递（DAG）；**ConceptNet 方向相反（dependent→prerequisite）** | ⚠️ 中（方向需自定义） |
| **contrast 对比** | WordNet antonym；ConceptNet `Antonym` / `DistinctFrom`；ISO 1087 associative | 对称；不传递；比"反义"更宽（对比不一定是反义） | ⚠️ 部分（"对比"没有统一标准） |
| **alternative 替代** | 没有直接标准；可参考 schema.org/产品词汇（如 supersededBy 类） | 旧 → 新；非对称；是否传递待定 | ❌ 低（产品自定义） |
| **related 相关** | SKOS `related`；ConceptNet `RelatedTo`/`SimilarTo` | 对称；不传递；SKOS 要求与层级关系不相交 | ✅ 高（但太宽，需要证据） |
| **analogy 类比** | 概念图 cross-link / `SimilarTo` / `SymbolOf` 只能间接参考 | 无方向；非知识关系 | ❌ 无标准（注释层） |
| **example 举例** | 概念图"例子"；SKOS `example` 是注释属性；ConceptNet deprecated `InstanceOf` | 例子 → 概念；非知识关系 | ⚠️ 部分（注释层） |

**结论：kindOf、partOf、related 有成熟依据；prerequisite 有理论但方向要自定义；contrast/alternative/analogy/example 需要产品定义。**

---

## 3. 可以直接借用的规则

### 3.1 方向与逆关系

- SKOS：`broader` / `narrower` 互为逆；`related` 对称；
- OBO RO：`part_of` / `has_part` 互为逆；`precedes` / `preceded_by` 互为逆；
- ConceptNet：`IsA` 具体→上位；`PartOf` 部分→整体；`HasA` 常为 `PartOf` 的反向；
- WordNet：hypernym 具体→上位；meronym 方向与 ConceptNet PartOf 相反，需要归一。

**产品规则：**

```text
kindOf: 具体 → 上位
partOf: 部分 → 整体
prerequisite: 前置 → 后续
alternative: 旧 → 新
contrast/related/analogy: 无方向
```

### 3.2 传递性

| 关系 | 传递性 | 参考 |
| --- | --- | --- |
| kindOf | ✅ 可传递 | SKOS broaderTransitive；ISO generic |
| partOf | ✅ 通常可传递（有例外） | OBO RO part_of 有传递公理；需注意"部分的部分" |
| prerequisite | ✅ 可传递（DAG） | KST surmise relation 是准序 |
| related | ❌ 不传递 | SKOS 明确不传递 |
| contrast | ❌ 不传递 | 反义/对比不传递 |
| alternative | ❌ 一般不传递 | 产品定义 |
| analogy/example | ❌ 不传递 | 注释 |

### 3.3 对称性 / 不相交 / 循环

- `related` 对称；`contrast` 对称；
- SKOS：`related` 与 `broaderTransitive` 不相交（同一对概念不应同时是层级和关联）；
- `kindOf` / `partOf` / `prerequisite` 不允许环；
- 同一对概念允许多少种谓词？SKOS 允许 broader + related? 但它要求 related 与 broaderTransitive 不相交；我们可规定**同一对最多 2 种谓词**，且其中不能同时有层级+related（或只保留层级）。
- 多父级：kindOf/partOf 允许多个上位/整体（DAG）。

### 3.4 证据/置信度/状态（标准没有，必须自定义）

- 每个关系必须有证据（原文/用户说明）；
- `formal` / `suggest` / `unrelated` 三态；
- `claim_status`: normal / disputed / revised；
- 低置信不建正式；
- 用户可争议/修订（正式关系不可删除）。

---

## 4. 哪些完全覆盖不了

| 缺口 | 原因 | 建议 |
| --- | --- | --- |
| `alternative` 替代 | 没有通用本体把"替代"作为标准关系；语义依赖领域 | 产品自定义：旧→新，非对称，证据要求高 |
| `contrast` 对比 | 标准只有 antonym/associative；"对比"比反义宽 | 自定义：对称、非传递；需明确"对比点" |
| `analogy` 类比 | 没有知识关系标准；概念图只有 cross-link | 非知识注释，不进正式图/题/副本 |
| `example` 举例 | SKOS 的 example 是注释，不是关系 | 注释层，或 `exampleOf`（非正式） |
| 方向约定 | 各标准方向不同（ConceptNet HasPrerequisite 反向） | 产品固定方向表 + 程序归一 |
| 证据/置信度 | 标准词表不定义 | 产品自定义 |
| 教学可挑战 | KST 有理论，但不是现成文本抽取 | 用 KST 建模，不直接抄关系抽取 |

---

## 5. 建议的关系体系（分层）

```text
L1 知识关系（进图、可出题/副本）
  kindOf / partOf / prerequisite / contrast / alternative / related

L2 非知识注释（不进正式图、不出题、不作为副本依据）
  analogy / example / 备注

L3 地图线型（表现层，不是知识谓词）
  formal / suggest / source / direction

L4 关系元数据
  direction / inverse / transitivity / evidence / confidence / claim_status / revision
```

映射建议：

| 我们的谓词 | 参考词表 | 方向 | 传递 | 备注 |
| --- | --- | --- | --- | --- |
| kindOf | SKOS broader / ISO generic / ConceptNet IsA | 具体→上位 | ✅ | 允许 kindOf + contrast 并存？需规则 |
| partOf | ISO partitive / OBO part_of / ConceptNet PartOf | 部分→整体 | ✅ | SKOS 无 partOf |
| prerequisite | KST surmise / ConceptNet HasPrerequisite | 前置→后续 | ✅ | 注意 ConceptNet 方向相反 |
| contrast | WordNet antonym / ConceptNet Antonym/DistinctFrom | 无方向 | ❌ | 比反义宽 |
| alternative | 产品自定义 | 旧→新 | ❌ | 无通用标准 |
| related | SKOS related / ConceptNet RelatedTo | 无方向 | ❌ | 必须证据强 |
| analogy | 概念图 cross-link | 无方向 | ❌ | 注释 |
| example | 概念图例子 / SKOS example | 例子→概念 | ❌ | 注释 |

---

## 6. 结论

- **没有单一体系能完全覆盖我们的场景**；
- **kindOf / partOf / related**：SKOS、ISO 1087、OBO RO、WordNet、ConceptNet 足够参考；
- **prerequisite**：KST / ConceptNet HasPrerequisite 有依据，但方向必须自定义（注意反向）；
- **contrast / alternative / analogy / example**：没有通用标准，必须产品定义；
- **方向、传递、逆关系、循环、不相交**：可以借 SKOS/RO 的规则；
- **证据、置信度、正式/建议/争议**：标准不覆盖，必须自定义；
- 因此，关系体系应该是 **标准词表 + 产品谓词层 + 程序规则层** 的组合，而不是找一个"完全覆盖"的现成体系。

---

## 7. 参考链接

- SKOS Reference：https://www.w3.org/TR/skos-reference/
- ISO 1087（术语工作）：https://www.iso.org/standard/20057.html
- WordNet：https://wordnet.princeton.edu/
- ConceptNet Relations（34 种）：https://github.com/commonsense/conceptnet5/wiki/Relations
- OBO Relation Ontology：https://obofoundry.org/ontology/ro.html
- Knowledge Spaces（KST）：https://github.com/vanderbilt-data-science/knowledge-spaces
- Novak 概念图 / IHMC CmapTools：https://cmap.ihmc.us/
- 课程概念图专利 KR102804240B1：https://patents.google.com/patent/KR102804240B1/en
- Concept Map Extraction（ACL 2025）：https://aclanthology.org/2025.ldk-1.10/

---

*本报告只做关系体系参考与覆盖分析；具体谓词/方向/约束需产品确认。*
