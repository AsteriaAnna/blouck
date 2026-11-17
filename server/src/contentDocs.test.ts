import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `blouck-docs-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.DEEPSEEK_API_KEY = "";

const { addEdge, addNode, createSourceSpan, createWorld, db } = await import("./db.js");
const { getNodeDocRow, getRelationDocRow, setNodeDocNotes, setRelationDocNotes } = await import(
  "./db/docs.js"
);
const { ensureNodeDoc, ensureRelationDoc } = await import("./services/contentDocs.js");
const { mockLLM } = await import("./providers/mock.js");

test("节点卡：生成、关系位置、来源、备注不覆盖", async () => {
  const world = createWorld("doc-test", "根");
  const root = (await import("./db.js")).getGraph(world.id).nodes[0];
  const span = createSourceSpan(world.id, "RAG 包含检索，检索是生成的前置。");
  const node = addNode(world.id, "RAG", 100, 100, "", {
    definition: "检索增强生成",
    sourceSpanId: span.id,
  });
  const retrieval = addNode(world.id, "检索", 200, 100, "", { definition: "召回候选" });
  addEdge(world.id, node.id, retrieval.id, "formal", "包含", null, "", {
    predicate: "partOf",
    evidence: "RAG 包含检索",
  });

  const p = await ensureNodeDoc(node.id, mockLLM);
  assert.ok(p.doc);
  assert.equal(p.doc!.definition, "检索增强生成");
  assert.ok(p.doc!.position.some((x) => x.node_id === retrieval.id));
  assert.ok(p.doc!.source_quote.includes("RAG"));
  assert.equal(p.status, "ready");
  const firstVersion = getNodeDocRow(node.id)!.version;

  setNodeDocNotes(node.id, "我的笔记");
  const again = await ensureNodeDoc(node.id, mockLLM);
  assert.equal(again.notes_md, "我的笔记");
  assert.equal(getNodeDocRow(node.id)!.version, firstVersion, "已有文档不应重复写");

  const regen = await ensureNodeDoc(node.id, mockLLM, true);
  assert.equal(regen.status, "ready");
  assert.ok(getNodeDocRow(node.id)!.version > firstVersion);
  assert.ok(root);
});

test("关系卡：只有语义边生成；证据/备注；方向边不生成", async () => {
  const world = createWorld("relation-doc-test", "根");
  const graph = (await import("./db.js")).getGraph(world.id);
  const a = addNode(world.id, "A", 10, 10);
  const b = addNode(world.id, "B", 20, 20);
  const formal = addEdge(world.id, a.id, b.id, "formal", "A 是一种 B", null, "", {
    predicate: "kindOf",
    evidence: "A 是一种 B 的实现",
  });
  const suggest = addEdge(world.id, a.id, b.id, "suggest", "可能相关", null, "", {
    predicate: "related",
    evidence: "可能相关",
  });
  const direction = addEdge(world.id, a.id, a.id, "direction", "", "下一步？");
  assert.ok(graph);

  const p = await ensureRelationDoc(formal.id, mockLLM);
  assert.equal(p.status, "ready");
  assert.ok(p.doc);
  assert.equal(p.doc!.predicate, "kindOf");
  assert.ok(p.doc!.evidence_quote.includes("A 是一种 B"));

  const hint = await ensureRelationDoc(suggest.id, mockLLM);
  assert.equal(hint.status, "ready");
  const missing = await ensureRelationDoc(direction.id, mockLLM);
  assert.equal(missing.status, "missing");

  setRelationDocNotes(formal.id, "备注");
  const again = await ensureRelationDoc(formal.id, mockLLM);
  assert.equal(again.notes_md, "备注");
  assert.ok(getRelationDocRow(formal.id));
});

test.after(() => {
  try {
    db.close();
  } catch {}
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch {}
  }
});
