/**
 * 副本发现/校验评测（负例为主）
 * 用法：cd server && pnpm eval:dungeons
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateDomainCandidate,
  validateFlowCandidate,
  type DungeonEdge,
  type DungeonNode,
  type DomainCandidate,
  type FlowCandidate,
} from "../src/dungeons.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nodes: DungeonNode[] = [
  { id: "a", name: "文档分块" },
  { id: "b", name: "向量检索" },
  { id: "c", name: "重排" },
  { id: "d", name: "生成回答" },
  { id: "e", name: "提示词" },
  { id: "p", name: "检索技术" },
  { id: "f", name: "步骤F" },
  { id: "g", name: "步骤G" },
];

const flow = (steps: string[], prec: [string, string, string][], confidence = 0.85): FlowCandidate => ({
  processName: "RAG 流程",
  steps: steps.map((id) => ({ id, name: nodes.find((n) => n.id === id)?.name ?? id })),
  precedence: prec.map(([before, after, evidence]) => ({ before, after, evidence })),
  confidence,
});

type Case = {
  id: string;
  kind: "flow" | "domain";
  expect: boolean;
  note: string;
  run: () => { ok: boolean; errors: string[] };
};

const flowCases: Case[] = [
  {
    id: "F-P1",
    kind: "flow",
    expect: true,
    note: "4 步 + 过程词 + 唯一序",
    run: () =>
      validateFlowCandidate(nodes, flow(["a", "b", "c", "d"], [
        ["a", "b", "先把文档切成分块，再做向量检索"],
        ["b", "c", "检索出候选后，然后做重排"],
        ["c", "d", "最后把结果交给生成回答"],
      ])),
  },
  {
    id: "F-N1",
    kind: "flow",
    expect: false,
    note: "只有 2 步",
    run: () =>
      validateFlowCandidate(nodes, flow(["a", "b"], [["a", "b", "先分块，再检索"]])),
  },
  {
    id: "F-N2",
    kind: "flow",
    expect: false,
    note: "7 步超上限",
    run: () =>
      validateFlowCandidate(
        nodes,
        flow(["a", "b", "c", "d", "e", "f", "g"], [
          ["a", "b", "先 a 再 b"],
          ["b", "c", "然后 b 再 c"],
          ["c", "d", "之后 c 再 d"],
          ["d", "e", "接着 d 再 e"],
          ["e", "f", "然后 e 再 f"],
          ["f", "g", "最后 f 再 g"],
        ]),
      ),
  },
  {
    id: "F-N3",
    kind: "flow",
    expect: false,
    note: "多解：3 步只有 1 条约束",
    run: () =>
      validateFlowCandidate(nodes, flow(["a", "b", "c"], [["a", "b", "先分块再检索"]])),
  },
  {
    id: "F-N4",
    kind: "flow",
    expect: false,
    note: "环",
    run: () =>
      validateFlowCandidate(nodes, flow(["a", "b", "c"], [
        ["a", "b", "先 a 再 b"],
        ["b", "c", "然后 b 再 c"],
        ["c", "a", "最后 c 回到 a"],
      ])),
  },
  {
    id: "F-N5",
    kind: "flow",
    expect: false,
    note: "证据无过程词",
    run: () =>
      validateFlowCandidate(nodes, flow(["a", "b", "c"], [
        ["a", "b", "分块和检索有关"],
        ["b", "c", "检索和重排有关"],
      ])),
  },
  {
    id: "F-N6",
    kind: "flow",
    expect: false,
    note: "低 confidence",
    run: () =>
      validateFlowCandidate(nodes, flow(["a", "b", "c"], [
        ["a", "b", "先分块再检索"],
        ["b", "c", "然后检索再重排"],
      ], 0.5)),
  },
  {
    id: "F-N7",
    kind: "flow",
    expect: false,
    note: "引用不存在节点",
    run: () =>
      validateFlowCandidate(nodes, flow(["a", "b", "x"], [
        ["a", "b", "先分块再检索"],
        ["b", "x", "然后检索再未知"],
      ])),
  },
];

const domainEdges: DungeonEdge[] = [
  { src: "a", dst: "p", kind: "formal", label: "归类" },
  { src: "b", dst: "p", kind: "formal", label: "归类" },
  { src: "c", dst: "p", kind: "formal", label: "归类" },
  { src: "d", dst: "p", kind: "formal", label: "归类" },
  { src: "e", dst: "a", kind: "formal", label: "前置" },
];

const domain = (memberIds: string[], name = "检索技术", confidence = 0.8, commonParent = "p"): DomainCandidate => ({
  domainName: name,
  members: memberIds.map((id) => ({ id, name: nodes.find((n) => n.id === id)!.name })),
  commonParent,
  confidence,
});

const domainCases: Case[] = [
  {
    id: "D-P1",
    kind: "domain",
    expect: true,
    note: "4 成员 + 共同上位",
    run: () => validateDomainCandidate(nodes, domainEdges, domain(["a", "b", "c", "d"])),
  },
  {
    id: "D-N1",
    kind: "domain",
    expect: false,
    note: "只有 3 个成员",
    run: () => validateDomainCandidate(nodes, domainEdges, domain(["a", "b", "c"])),
  },
  {
    id: "D-N2",
    kind: "domain",
    expect: false,
    note: "无共同上位/来源",
    run: () =>
      validateDomainCandidate(
        nodes,
        domainEdges.filter((e) => e.dst !== "p"),
        domain(["a", "b", "c", "e"], "检索技术", 0.8, ""),
      ),
  },
  {
    id: "D-N3",
    kind: "domain",
    expect: false,
    note: "领域名泛化",
    run: () => validateDomainCandidate(nodes, domainEdges, domain(["a", "b", "c", "d"], "技术")),
  },
  {
    id: "D-N4",
    kind: "domain",
    expect: false,
    note: "领域名与成员同名",
    run: () => validateDomainCandidate(nodes, domainEdges, domain(["a", "b", "c", "d"], "文档分块")),
  },
  {
    id: "D-N5",
    kind: "domain",
    expect: false,
    note: "与已有领域重叠过高",
    run: () =>
      validateDomainCandidate(
        nodes,
        domainEdges,
        domain(["a", "b", "c", "d"]),
        [["a", "b", "c", "d", "e"]],
      ),
  },
  {
    id: "D-N6",
    kind: "domain",
    expect: false,
    note: "低 confidence",
    run: () => validateDomainCandidate(nodes, domainEdges, domain(["a", "b", "c", "d"], "检索技术", 0.5)),
  },
];

const cases = [...flowCases, ...domainCases];
let tp = 0, fp = 0, fn = 0, tn = 0;
const rows: string[] = [];
for (const c of cases) {
  const res = c.run();
  const pass = res.ok;
  const correct = pass === c.expect;
  if (pass && c.expect) tp++;
  else if (pass && !c.expect) fp++;
  else if (!pass && c.expect) fn++;
  else tn++;
  rows.push(
    `| ${c.id} | ${c.kind} | 期望${c.expect ? "生成" : "拒绝"} | 实际${pass ? "通过" : "拒绝"} | ${correct ? "✅" : "❌"} | ${c.note} | ${res.errors.slice(0, 2).join("；") || "—"} |`,
  );
}
const precision = tp / Math.max(1, tp + fp);
const recall = tp / Math.max(1, tp + fn);
console.log(rows.join("\n"));
console.log(`\nTP=${tp} FP=${fp} FN=${fn} TN=${tn}`);
console.log(`Precision=${precision.toFixed(2)} Recall=${recall.toFixed(2)}`);

const md = [
  "# 副本发现/校验评测报告",
  "",
  `- 时间：${new Date().toISOString()}`,
  `- 用例：${cases.length}（流程 ${flowCases.length} / 领域 ${domainCases.length}）`,
  `- TP=${tp} FP=${fp} FN=${fn} TN=${tn}`,
  `- Precision=${precision.toFixed(2)} Recall=${recall.toFixed(2)}`,
  "",
  "| case | 类型 | 期望 | 实际 | 结果 | 说明 | 拒绝原因 |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
].join("\n");
fs.writeFileSync(path.join(__dirname, "report-dungeons.md"), md);
