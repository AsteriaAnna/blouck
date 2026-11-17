import { addEdge, consumeDirection, db, getGraph, listDirections } from "../db.js";

/**
 * 把 frontier 节点的方向数据物化成可点击的方向边。
 * 规则：非 frontier 的方向边删除；每节点最多 2 条；同 src|question 幂等。
 * 注意：这是地图投影，不是方向源数据（源数据在 directions 表）。
 */
export function materializeDirectionEdges(worldId: string) {
  db.prepare(
    "DELETE FROM edges WHERE world_id=? AND kind='direction' AND src IN (SELECT id FROM nodes WHERE world_id=? AND frontier=0)",
  ).run(worldId, worldId);
  const graph = getGraph(worldId);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const existing = new Set(
    graph.edges.filter((e) => e.kind === "direction").map((e) => `${e.src}|${e.question ?? ""}`),
  );
  const count = new Map<string, number>();
  for (const d of listDirections(worldId)) {
    if (d.status !== "open") continue;
    const node = byId.get(d.node_id);
    if (!node || !node.frontier || node.hidden) continue;
    const used = count.get(node.id) ?? 0;
    if (used >= 2) continue;
    const key = `${node.id}|${d.question}`;
    if (existing.has(key)) {
      count.set(node.id, used + 1);
      continue;
    }
    addEdge(worldId, node.id, node.id, "direction", d.target_name ?? "", d.question, "", {
      evidence: d.reason,
      confidence: 0.6,
      origin: "direction",
      target_name: d.target_name,
      target_type: d.target_type,
      target_definition: d.target_definition,
      target_aliases: d.target_aliases,
      target_predicate: d.target_predicate,
      target_label: d.target_label,
    });
    existing.add(key);
    count.set(node.id, used + 1);
  }
}

/**
 * 消费一条方向边：以 directions 表为源，把对应 open 方向置 consumed，并给投影边打 consumed=1。
 * edge id 只用于地图投影；不能拿 edge id 当 direction id。
 */
export function consumeDirectionEdge(edgeId: string): boolean {
  const e = db
    .prepare("SELECT id, world_id, src, kind, question FROM edges WHERE id=?")
    .get(edgeId) as
    | { id: string; world_id: string; src: string; kind: string; question: string | null }
    | undefined;
  if (!e || e.kind !== "direction") return false;
  const d = db
    .prepare(
      "SELECT id FROM directions WHERE world_id=? AND node_id=? AND question=? AND status='open' ORDER BY created_at DESC LIMIT 1",
    )
    .get(e.world_id, e.src, e.question ?? "") as { id: string } | undefined;
  if (!d) return false;
  consumeDirection(d.id);
  db.prepare("UPDATE edges SET consumed=1 WHERE id=?").run(edgeId);
  return true;
}
