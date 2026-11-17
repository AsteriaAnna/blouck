import test from "node:test";
import assert from "node:assert/strict";
import { splitTextChunks, mergeExtractResults } from "./services/extraction.js";

test("长文本切块：短文本 1 块；长文本有重叠且不超上限", () => {
  assert.deepEqual(splitTextChunks("短文本"), ["短文本"]);
  assert.deepEqual(splitTextChunks(""), []);
  const text = "甲".repeat(7000);
  const chunks = splitTextChunks(text, 3000, 200);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((c) => c.length <= 3000));
  assert.equal(chunks[1].slice(0, 200), chunks[0].slice(-200));
});

test("多块抽取合并：实体/关系/流程去重", () => {
  const merged = mergeExtractResults([
    {
      entities: [
        { name: "RAG", type: "概念", evidence: "a", confidence: 0.9 },
        { name: "检索", type: "概念", evidence: "b", confidence: 0.8 },
      ],
      relations: [{ source: "RAG", target: "检索", type: "formal", predicate: "partOf", label: "组成" }],
      processes: [{ name: "流程", steps: ["A", "B"] }],
    },
    {
      entities: [
        { name: "RAG", type: "概念", evidence: "c", confidence: 0.9, aliases: ["R"] },
        { name: "生成", type: "概念", evidence: "d", confidence: 0.7 },
      ],
      relations: [{ source: "RAG", target: "检索", type: "formal", predicate: "partOf", label: "组成" }],
      processes: [{ name: "流程2", steps: ["A", "B"] }],
    },
  ]);
  assert.equal(merged.entities.length, 3);
  assert.deepEqual(merged.entities.find((e) => e.name === "RAG")?.aliases, ["R"]);
  assert.equal(merged.relations.length, 1);
  assert.equal(merged.processes?.length, 1);
});
