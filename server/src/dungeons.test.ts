import test from "node:test";
import assert from "node:assert/strict";
import {
  countLinearExtensions,
  validateDomainCandidate,
  validateFlowCandidate,
  type DungeonNode,
} from "./dungeons.js";

test("countLinearExtensions: 链式约束只有 1 种顺序", () => {
  const r = countLinearExtensions(["a", "b", "c"], [
    { before: "a", after: "b" },
    { before: "b", after: "c" },
  ]);
  assert.equal(r.count, 1);
  assert.deepEqual(r.first, ["a", "b", "c"]);
});

test("countLinearExtensions: 无约束时多解", () => {
  const r = countLinearExtensions(["a", "b"], []);
  assert.equal(r.count, 2);
});

test("validateFlowCandidate: 3 步、有过程词证据、唯一顺序 → ok", () => {
  const nodes: DungeonNode[] = [
    { id: "a", name: "解析" },
    { id: "b", name: "分块" },
    { id: "c", name: "检索" },
  ];
  const result = validateFlowCandidate(nodes, {
    processName: "RAG 流程",
    steps: [
      { id: "a", name: "解析" },
      { id: "b", name: "分块" },
      { id: "c", name: "检索" },
    ],
    precedence: [
      { before: "a", after: "b", evidence: "先解析，然后分块" },
      { before: "b", after: "c", evidence: "分块之后再检索" },
    ],
    confidence: 0.9,
  });
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.deepEqual(result.order, ["a", "b", "c"]);
});

test("validateFlowCandidate: 缺过程词证据 → 拒绝", () => {
  const nodes: DungeonNode[] = [
    { id: "a", name: "解析" },
    { id: "b", name: "分块" },
    { id: "c", name: "检索" },
  ];
  const result = validateFlowCandidate(nodes, {
    processName: "RAG 流程",
    steps: [
      { id: "a", name: "解析" },
      { id: "b", name: "分块" },
      { id: "c", name: "检索" },
    ],
    precedence: [
      { before: "a", after: "b", evidence: "解析和分块有关" },
      { before: "b", after: "c", evidence: "分块和检索有关" },
    ],
    confidence: 0.9,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("过程词")));
});

test("validateDomainCandidate: kindOf 共同上位 → ok", () => {
  const nodes: DungeonNode[] = [
    { id: "p", name: "检索" },
    { id: "a", name: "向量检索" },
    { id: "b", name: "稀疏检索" },
    { id: "c", name: "混合检索" },
    { id: "d", name: "关键词检索" },
  ];
  const edges = ["a", "b", "c", "d"].map((id) => ({
    src: id,
    dst: "p",
    kind: "formal",
    predicate: "kindOf",
  }));
  const result = validateDomainCandidate(
    nodes,
    edges,
    {
      domainName: "检索技术",
      members: [
        { id: "a", name: "向量检索" },
        { id: "b", name: "稀疏检索" },
        { id: "c", name: "混合检索" },
        { id: "d", name: "关键词检索" },
      ],
      commonParent: "p",
      confidence: 0.8,
    },
  );
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("validateDomainCandidate: 只有共同邻居、没有 kindOf → 拒绝", () => {
  const nodes: DungeonNode[] = [
    { id: "p", name: "检索" },
    { id: "a", name: "向量检索" },
    { id: "b", name: "稀疏检索" },
    { id: "c", name: "混合检索" },
    { id: "d", name: "关键词检索" },
  ];
  const edges = ["a", "b", "c", "d"].map((id) => ({
    src: id,
    dst: "p",
    kind: "formal",
    predicate: "related",
  }));
  const result = validateDomainCandidate(
    nodes,
    edges,
    {
      domainName: "检索技术",
      members: [
        { id: "a", name: "向量检索" },
        { id: "b", name: "稀疏检索" },
        { id: "c", name: "混合检索" },
        { id: "d", name: "关键词检索" },
      ],
      commonParent: "p",
      confidence: 0.8,
    },
  );
  assert.equal(result.ok, false);
});
