import type { EdgeRow, NodeRow } from "./db.js";

/**
 * WFC-lite 布局：
 * - 先把地图切成网格格子（每个格子是"波函数未坍缩"的候选）；
 * - 按度数从高到低坍缩节点：节点占据一个格子后，邻居节点对该格子周围的可选性产生约束；
 * - 每个节点在候选空格里选"到已放置邻居的总距离最小"的格子，平局随机；
 * - 这样边大多落在相邻格，减少交叉，同时保证节点不重叠。
 */
export function wfcLayout(nodes: NodeRow[], edges: EdgeRow[]) {
  const n = nodes.length;
  if (n === 0) return [] as { id: string; x: number; y: number }[];

  const cols = Math.max(3, Math.ceil(Math.sqrt(n * 1.45)));
  const rows = Math.max(2, Math.ceil(n / cols));
  const gapX = 250;
  const gapY = 230;
  const originX = 160;
  const originY = 140;

  const cells: { c: number; r: number; used: boolean }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push({ c, r, used: false });
  }

  const degree = new Map<string, number>();
  for (const node of nodes) degree.set(node.id, 0);
  for (const e of edges) {
    if (e.kind === "direction") continue;
    degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
  }
  const ordered = [...nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));

  const pos = new Map<string, { x: number; y: number }>();
  const neighbors = new Map<string, Set<string>>();
  for (const node of nodes) neighbors.set(node.id, new Set());
  for (const e of edges) {
    if (e.kind === "direction") continue;
    neighbors.get(e.src)?.add(e.dst);
    neighbors.get(e.dst)?.add(e.src);
  }

  const centerIdx = Math.floor(cells.length / 2);
  const seed = ordered[0];
  const seedCell = cells[centerIdx];
  seedCell.used = true;
  pos.set(seed.id, cellToXY(seedCell));
  const placed = [seed.id];

  for (const node of ordered.slice(1)) {
    let best = -1;
    let bestScore = Infinity;
    const placedNeighbors = [...(neighbors.get(node.id) ?? [])].filter((id) => pos.has(id));

    for (let i = 0; i < cells.length; i++) {
      if (cells[i].used) continue;
      const xy = cellToXY(cells[i]);
      let score = 0;
      for (const nb of placedNeighbors) {
        const p = pos.get(nb)!;
        const d = Math.hypot(p.x - xy.x, p.y - xy.y);
        score += (Math.min(d, 3 * gapX) / gapX) ** 2;
      }
      // 没有任何已放置邻居时，向中心靠拢
      if (placedNeighbors.length === 0) {
        const cx = originX + ((cols - 1) * gapX) / 2;
        const cy = originY + ((rows - 1) * gapY) / 2;
        score += Math.hypot(cx - xy.x, cy - xy.y) / (gapX * 4);
      }
      score += Math.random() * 0.35; // 平局扰动，避免完全对称
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) best = cells.findIndex((c) => !c.used);
    if (best < 0) break;
    cells[best].used = true;
    pos.set(node.id, cellToXY(cells[best]));
    placed.push(node.id);
  }

  return nodes.map((node) => ({
    id: node.id,
    x: pos.get(node.id)?.x ?? originX,
    y: pos.get(node.id)?.y ?? originY,
  }));

  function cellToXY(cell: { c: number; r: number }) {
    const offset = cell.r % 2 === 0 ? 0 : gapX * 0.28;
    return { x: originX + cell.c * gapX + offset, y: originY + cell.r * gapY };
  }
}
