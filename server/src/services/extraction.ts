import type { ExtractEntity, ExtractProcess, ExtractRelation, ExtractResult } from "../providers/types.js";

const norm = (s: string) =>
  s.toLowerCase().replace(/[\s\-_·、，。,.；;：:（）()【】\[\]《》"'“”]/g, "").trim();

/** 长文本切块：每块 max 字，相邻 overlap 字；不会死循环。 */
export function splitTextChunks(text: string, max = 3000, overlap = 200): string[] {
  const s = text.trim();
  if (!s) return [];
  if (s.length <= max) return [s];
  const chunks: string[] = [];
  let start = 0;
  while (start < s.length) {
    const end = Math.min(s.length, start + max);
    chunks.push(s.slice(start, end));
    if (end >= s.length) break;
    const next = end - overlap;
    start = next > start ? next : end;
  }
  return chunks;
}

/** 多块抽取结果合并：实体按名、关系按 src|dst|type、流程按步骤去重。 */
export function mergeExtractResults(results: ExtractResult[]): ExtractResult {
  const entities = new Map<string, ExtractEntity>();
  const relations = new Map<string, ExtractRelation>();
  const processes = new Map<string, ExtractProcess>();
  for (const r of results) {
    for (const e of r.entities ?? []) {
      const key = norm(e.name);
      if (!key) continue;
      const prev = entities.get(key);
      if (!prev) entities.set(key, e);
      else {
        const aliases = new Set([...(prev.aliases ?? []), ...(e.aliases ?? [])]);
        entities.set(key, {
          ...prev,
          aliases: [...aliases],
          evidence: prev.evidence || e.evidence,
          definition: prev.definition || e.definition,
        });
      }
    }
    for (const rel of r.relations ?? []) {
      const key = `${norm(rel.source ?? "")}|${norm(rel.target ?? "")}|${rel.type}`;
      if (!relations.has(key)) relations.set(key, rel);
    }
    for (const p of r.processes ?? []) {
      const key = p.steps.map(norm).join(">");
      if (!processes.has(key)) processes.set(key, p);
    }
  }
  return {
    entities: [...entities.values()],
    relations: [...relations.values()],
    processes: [...processes.values()],
  };
}
