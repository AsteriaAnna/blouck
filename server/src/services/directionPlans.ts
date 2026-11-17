import type { NodeRow } from "../db.js";
import { addDirection, listDirections } from "../db.js";
import type { LLMProvider } from "../providers/types.js";

/** 模板兜底：保证新节点至少有 4 条不同的下一步方向。 */
const templates = (name: string) => [
  `「${name}」和哪个概念最容易混淆？`,
  `「${name}」依赖哪些前置概念？`,
  `「${name}」由哪些部分组成？`,
  `「${name}」在什么情况下不成立？`,
];

/**
 * 确保节点有 count 条 open 方向计划：
 * LLM 优先，去重；不足用模板补；已有方向也算数。
 */
export async function ensureDirectionPlans(
  worldId: string,
  node: NodeRow,
  llm: LLMProvider,
  count = 4,
): Promise<void> {
  const existing = listDirections(worldId).filter((d) => d.node_id === node.id && d.status === "open");
  if (existing.length >= count) return;
  const used = new Set(existing.map((d) => d.question));
  let added = existing.length;
  const add = (question: string, reason: string, target: any) => {
    if (added >= count || used.has(question)) return;
    addDirection(worldId, node.id, question, reason, target);
    used.add(question);
    added++;
  };

  try {
    const suggestions = await llm.suggestDirections({
      nodes: [{ name: node.name, definition: node.definition, neighbors: [] }],
      existing: [],
    });
    for (const s of suggestions.filter((x) => x.node === node.name)) {
      add(
        s.question,
        s.reason,
        s.target
          ? {
              name: s.target.name,
              type: s.target.type,
              definition: s.target.definition,
              aliases: s.target.aliases,
              predicate: s.predicate ?? null,
              label: s.label,
            }
          : null,
      );
    }
  } catch (err) {
    console.warn("[directions] 新节点方向生成失败，使用模板：", err);
  }
  for (const q of templates(node.name)) add(q, `围绕「${node.name}」的下一步`, null);
}
