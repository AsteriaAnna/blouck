/**
 * 生成算法评测脚本
 *
 * 用法（在 server/ 目录下）：
 *   pnpm eval                 # 直连 provider，评抽取质量
 *   pnpm eval -- --api        # 走真实 API（含副本检测），需要服务已启动
 *   pnpm eval -- --provider=mock
 *
 * 输出：
 *   server/eval/report-<provider>[-api].md
 *   server/eval/report-<provider>[-api].json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deepseekLLM } from "../src/providers/deepseek.js";
import { mockLLM } from "../src/providers/mock.js";
import type { ExtractResult } from "../src/providers/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const useApi = args.includes("--api");
const providerArg = args.find((a) => a.startsWith("--provider="))?.split("=")[1] ?? "deepseek";
const provider = providerArg === "mock" ? mockLLM : deepseekLLM;
const BASE = process.env.EVAL_BASE ?? "http://localhost:8787";

type GoldRelation = {
  from: string;
  to: string;
  type: "prerequisite" | "partOf" | "contrast" | "alternative" | "related";
  mapType: string;
  evidence: string;
};
type Case = {
  id: string;
  topic: string;
  text: string;
  goldEntities: string[];
  aliases?: Record<string, string[]>;
  goldRelations: GoldRelation[];
  expectFlow?: boolean;
  expectDomain?: boolean;
  expectDirection?: boolean;
};
type CasesFile = { meta: { focus: string; relationTypes: string[] }; cases: Case[] };

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf8")) as CasesFile;
const focusName = data.meta.focus;

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[\s\-_·、，。,.；;：:（）()【】\[\]《》"'“”]/g, "")
    .trim();
}

/** 每个 case 建一个“标准名 → 变体”的匹配表 */
function matcher(c: Case) {
  const table = new Map<string, string>();
  for (const name of c.goldEntities) {
    table.set(norm(name), name);
    for (const alias of c.aliases?.[name] ?? []) table.set(norm(alias), name);
  }
  return (raw: string) => table.get(norm(raw)) ?? null;
}

type CaseResult = {
  id: string;
  topic: string;
  provider: string;
  entityTP: number;
  entityFP: number;
  entityFN: number;
  relationTP: number;
  relationFP: number;
  relationFN: number;
  mapTypeOK: number;
  mapTypeTotal: number;
  evidenceOK: number;
  evidenceTotal: number;
  directionExpected: boolean;
  directionFound: boolean;
  predictedEntities: string[];
  predictedRelations: { src: string; dst: string; kind: string; label: string }[];
  missingEntities: string[];
  missingRelations: string[];
  expectFlow?: boolean;
  gotFlow?: boolean;
  expectDomain?: boolean;
  gotDomain?: boolean;
};

function scoreCase(
  c: Case,
  result: ExtractResult,
  edges: { src: string; dst: string; kind: string; label: string }[],
  buildingKinds: string[],
): CaseResult {
  const match = matcher(c);
  const predEntities = result.entities.map((e) => e.name);
  const predCanon = predEntities.map((n) => match(n)).filter(Boolean) as string[];
  const goldSet = new Set(c.goldEntities);
  const hitEntities = new Set(predCanon);
  const entityTP = [...hitEntities].filter((n) => goldSet.has(n)).length;
  const entityFP = predCanon.filter((n) => !goldSet.has(n)).length;
  const missingEntities = c.goldEntities.filter((n) => !hitEntities.has(n));

  // 关系：把预测边映射到标准名；当前抽取的结构限制是"所有边都从 focus 出发"
  const mappedEdges = edges
    .map((e) => ({
      src: match(e.src) ?? norm(e.src),
      dst: match(e.dst) ?? norm(e.dst),
      kind: e.kind,
      label: e.label,
    }))
    .filter((e) => e.src && e.dst);
  const goldPairs = c.goldRelations.map((r) => ({
    key: [norm(match(r.from) ?? r.from), norm(match(r.to) ?? r.to)].sort().join("|"),
    relation: r,
  }));
  let relationTP = 0;
  let mapTypeOK = 0;
  const matchedGold = new Set<string>();
  for (const gold of goldPairs) {
    const found = mappedEdges.find((e) => [norm(e.src), norm(e.dst)].sort().join("|") === gold.key);
    if (found) {
      relationTP++;
      matchedGold.add(gold.key);
      if (found.kind === gold.relation.mapType) mapTypeOK++;
    }
  }
  const relationFN = goldPairs.length - relationTP;
  const relationFP = Math.max(0, mappedEdges.length - relationTP);
  const directionFound =
    c.expectDirection === true &&
    edges.some((e) => e.kind === "direction" && (e.label?.length ?? 0) + 8 >= 8);

  return {
    id: c.id,
    topic: c.topic,
    provider: result ? provider.name : "unknown",
    entityTP,
    entityFP,
    entityFN: missingEntities.length,
    relationTP,
    relationFP,
    relationFN,
    mapTypeOK,
    mapTypeTotal: relationTP,
    evidenceOK: 0,
    evidenceTotal: c.goldRelations.length,
    directionExpected: c.expectDirection === true,
    directionFound,
    predictedEntities: predEntities,
    predictedRelations: mappedEdges,
    missingEntities,
    missingRelations: goldPairs.filter((g) => !matchedGold.has(g.key)).map((g) => {
      const r = g.relation;
      return `${r.from} --${r.type}--> ${r.to}`;
    }),
    expectFlow: c.expectFlow,
    gotFlow: buildingKinds.includes("flow"),
    expectDomain: c.expectDomain,
    gotDomain: buildingKinds.includes("domain"),
  };
}

async function evaluateDirect(c: Case) {
  const result = await provider.extract({
    text: c.text,
    focus: { id: "root", name: focusName },
    existing: [],
  });
  // 直接用 provider 的结果模拟"焦点→目标"的边（当前抽取 schema 只有 target，没有任意 source）
  const edges = result.relations.map((r) => ({
    src: focusName,
    dst: r.target,
    kind: r.type,
    label: r.label,
  }));
  return scoreCase(c, result, edges, []);
}

async function evaluateApi(c: Case): Promise<CaseResult> {
  const create = await fetch(`${BASE}/api/worlds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `eval-${c.id}`, rootName: focusName }),
  }).then((r) => r.json());
  const world = create.world;
  try {
    const res = await fetch(`${BASE}/api/worlds/${world.id}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: c.text, fromNodeId: world.root_node_id }),
    }).then((r) => r.json());
    const byId = new Map<string, string>(
      (res.nodes ?? []).map((n: any) => [n.id, String(n.name)]),
    );
    const edges = (res.edges ?? []).map((e: any) => ({
      src: byId.get(e.src) ?? e.src,
      dst: byId.get(e.dst) ?? e.dst,
      kind: e.kind,
      label: e.label,
    }));
    const buildingKinds = (res.buildings ?? []).map((b: any) => b.kind);
    const result: ExtractResult = {
      entities: (res.createdNodes ?? []).map((n: any) => ({ name: n.name })),
      relations: [],
    };
    return scoreCase(c, result, edges, buildingKinds);
  } finally {
    await fetch(`${BASE}/api/worlds/${world.id}`, { method: "DELETE" }).catch(() => null);
  }
}

function pct(n: number, d: number) {
  return d ? `${((100 * n) / d).toFixed(1)}%` : "—";
}

const results: CaseResult[] = [];
for (const c of data.cases) {
  try {
    results.push(useApi ? await evaluateApi(c) : await evaluateDirect(c));
    process.stdout.write(`✓ ${c.id}\n`);
  } catch (err: any) {
    process.stdout.write(`✗ ${c.id}: ${err?.message ?? err}\n`);
  }
}

const entityTP = results.reduce((a, r) => a + r.entityTP, 0);
const entityFP = results.reduce((a, r) => a + r.entityFP, 0);
const entityFN = results.reduce((a, r) => a + r.entityFN, 0);
const relationTP = results.reduce((a, r) => a + r.relationTP, 0);
const relationFP = results.reduce((a, r) => a + r.relationFP, 0);
const relationFN = results.reduce((a, r) => a + r.relationFN, 0);
const mapTypeOK = results.reduce((a, r) => a + r.mapTypeOK, 0);
const mapTypeTotal = results.reduce((a, r) => a + r.mapTypeTotal, 0);
const directionExpected = results.filter((r) => r.directionExpected).length;
const directionFound = results.filter((r) => r.directionFound).length;
const flowExpected = results.filter((r) => r.expectFlow).length;
const flowFound = results.filter((r) => r.expectFlow && r.gotFlow).length;
const domainExpected = results.filter((r) => r.expectDomain).length;
const domainFound = results.filter((r) => r.expectDomain && r.gotDomain).length;

const eP = entityTP / Math.max(1, entityTP + entityFP);
const eR = entityTP / Math.max(1, entityTP + entityFN);
const rP = relationTP / Math.max(1, relationTP + relationFP);
const rR = relationTP / Math.max(1, relationTP + relationFN);

const lines: string[] = [];
lines.push(`# 生成算法评测报告`);
lines.push(``);
lines.push(`- 时间：${new Date().toISOString()}`);
lines.push(`- 模式：${useApi ? "真实 API（含副本检测）" : "provider 直连"}`);
lines.push(`- provider：${provider.name}`);
lines.push(`- 用例数：${results.length}`);
lines.push(`- 焦点：${focusName}`);
lines.push(``);
lines.push(`## 汇总`);
lines.push(``);
lines.push(`| 指标 | 数值 |`);
lines.push(`| --- | --- |`);
lines.push(`| 实体 Precision | ${pct(entityTP, entityTP + entityFP)} |`);
lines.push(`| 实体 Recall | ${pct(entityTP, entityTP + entityFN)} |`);
lines.push(`| 实体 F1 | ${pct(2 * eP * eR, eP + eR)} |`);
lines.push(`| 关系对 Precision | ${pct(relationTP, relationTP + relationFP)} |`);
lines.push(`| 关系对 Recall | ${pct(relationTP, relationTP + relationFN)} |`);
lines.push(`| 线型（mapType）一致率 | ${pct(mapTypeOK, mapTypeTotal)} |`);
lines.push(`| 证据覆盖率 | 0.0%（当前抽取没有 evidence 字段） |`);
lines.push(`| 方向问题命中 | ${directionFound}/${directionExpected} |`);
if (useApi) {
  lines.push(`| 流程副本命中 | ${flowFound}/${flowExpected} |`);
  lines.push(`| 领域副本命中 | ${domainFound}/${domainExpected} |`);
}
lines.push(``);
lines.push(`## 逐条结果`);
lines.push(``);
lines.push(`| case | 实体 TP/FP/FN | 关系 TP/FP/FN | 线型 | 方向 | 缺失实体 | 缺失关系 |`);
lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
for (const r of results) {
  lines.push(
    `| ${r.id} | ${r.entityTP}/${r.entityFP}/${r.entityFN} | ${r.relationTP}/${r.relationFP}/${r.relationFN} | ${r.mapTypeOK}/${r.mapTypeTotal} | ${
      r.directionExpected ? (r.directionFound ? "✓" : "✗") : "—"
    } | ${r.missingEntities.join("、") || "—"} | ${r.missingRelations.join("；") || "—"} |`,
  );
}
lines.push(``);
lines.push(`## 解读`);
lines.push(``);
lines.push(`1. **结构限制**：当前抽取 schema 的 relations 只有 \`target\`，没有 \`source\`，所以所有边都只能是「焦点 → 目标」，非焦点的实体对（如 A 前置 B）无法表达——这是关系 Recall 上不去的结构性原因。`);
lines.push(`2. **无证据字段**：抽取结果没有 evidence span，因此证据覆盖率恒为 0；这部分要等数据模型补 TranscriptSpan/relation.source。`);
lines.push(`3. **无线型判定**：provider 只返回 source/formal/suggest/direction，没有知识语义类型（前置/组成/对比），线型一致率只能检验"四类地图线"映射，检验不了教学关系。`);
lines.push(`4. **副本检测**：只有 --api 模式能评，而且依赖抽取后的图结构；规则检测的命中率应结合实例人工复核。`);
lines.push(``);

const baseName = `report-${provider.name}${useApi ? "-api" : ""}`;
fs.writeFileSync(path.join(__dirname, `${baseName}.json`), JSON.stringify({ summary: { entityTP, entityFP, entityFN, relationTP, relationFP, relationFN, mapTypeOK, mapTypeTotal, directionExpected, directionFound }, results }, null, 2));
fs.writeFileSync(path.join(__dirname, `${baseName}.md`), lines.join("\n"));

console.log(`\n实体 P/R: ${pct(entityTP, entityTP + entityFP)} / ${pct(entityTP, entityTP + entityFN)}`);
console.log(`关系 P/R: ${pct(relationTP, relationTP + relationFP)} / ${pct(relationTP, relationTP + relationFN)}`);
console.log(`报告已写入 server/eval/${baseName}.md`);
