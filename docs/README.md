# 知识世界 · 文档

这个目录只记录两件事：

1. **当前采用的产品/算法规则**；
2. **我们正在尝试到哪一步、还有哪些问题没解决**。

不记录过程、搜索轮次、红队报告、历史争论。过程在 git 历史里。

---

## 阅读顺序

1. [产品基线](reference/product-baseline.md)：产品是什么、对象怎么定义。
2. [需求](design/requirements.md)：系统必须表现出的行为与验收。
3. [算法](reference/algorithms.md)：节点/关系/方向/副本的实际规则。
4. [问题与处理](design/problems-and-approaches.md)：每个硬问题的尝试、结论、未决点。
5. [当前状态](design/current-state.md)：现在代码做到了哪、卡在哪、下一步试什么。
6. [运行说明](ops/runtime.md)：ASR、3D 资产、评测。

---

## 当前节点（一句话）

流式语音 → segment final → `/stream/segment` 建 provisional → `/stream/commit` 同 ID 升级。

**正式链路已接 provisional 同 ID；typed text 仍走旧 `/extract`。** 详见 [current-state.md](design/current-state.md)。

---

## 目录

```text
docs/
  README.md
  reference/
    product-baseline.md
    algorithms.md
    external-research.md
  design/
    requirements.md
    problems-and-approaches.md
    current-state.md
  ops/
    runtime.md
  screenshots/
    stream-*.png
    12-dungeon.png
```

---

## 写作约定

- 一份文档只回答一类问题；
- 已确认的写"规则"，未确认的写"待决"；
- 不写"我搜了什么/我怎么错的/历史过程"；
- 细节能用一句话说清，就不新开文档。
