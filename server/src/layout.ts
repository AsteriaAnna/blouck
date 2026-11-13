import ELKModule from "elkjs/lib/elk.bundled.js";
import type { EdgeRow, NodeRow } from "./db.js";

const ELK: any = (ELKModule as any).default ?? ELKModule;
const elk = new ELK();

export const NODE_W = 210;
export const NODE_H = 170;

/**
 * ELK 分层布局（优先）：保证节点不重叠，按关系方向从左到右分层；
 * 失败时回退到 WFC-lite。
 */
export async function elkLayout(nodes: NodeRow[], edges: EdgeRow[]) {
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "force",
      "elk.force.iterations": "400",
      "elk.spacing.nodeNode": "130",
      "elk.spacing.edgeNode": "80",
      "elk.spacing.edgeEdge": "24",
      "elk.padding": "[top=60,left=60,bottom=60,right=60]",
    },
    children: nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
    edges: edges
      .filter((e) => e.kind !== "direction")
      .map((e, i) => ({
        id: "e" + i + "_" + e.id,
        sources: [e.src],
        targets: [e.dst],
      })),
  };
  const laid = (await elk.layout(graph as any)) as any;
  const raw: { id: string; x: number; y: number }[] = (laid.children ?? []).map((c: any) => ({
    id: c.id as string,
    x: Number(c.x ?? 0),
    y: Number(c.y ?? 0),
  }));

  // 压紧：ELK 会把大图拉得很开（47 节点可达 7000px），
  // 这里按 ELK 的相对顺序重建紧凑网格，保证屏幕比例合适且不重叠。
  const n = raw.length;
  if (n > 18) {
    const maxX = Math.max(...raw.map((p) => p.x));
    const maxY = Math.max(...raw.map((p) => p.y));
    if (maxX > 2600 || maxY > 2000) {
      const cols = Math.max(4, Math.ceil(Math.sqrt(n * 1.5)));
      const ordered = [...raw].sort(
        (a, b) => Math.round(a.y / 140) - Math.round(b.y / 140) || a.x - b.x,
      );
      return ordered.map((p, i) => ({
        id: p.id,
        x: 200 + (i % cols) * 270 + (Math.floor(i / cols) % 2 ? 55 : 0),
        y: 170 + Math.floor(i / cols) * 245,
      }));
    }
  }
  return raw;
}

/**
 * WFC-lite 回退：把地图切成网格，按度数从高到低坍缩节点，
 * 节点占据格子后邻居产生距离约束；保证一格一节点。
 */
export function wfcLayout(nodes: NodeRow[], edges: EdgeRow[]) {
  const n = nodes.length;
  if (n === 0) return [] as { id: string; x: number; y: number }[];
  const cols = Math.max(3, Math.ceil(Math.sqrt(n * 1.45)));
  const rows = Math.max(2, Math.ceil(n / cols));
  const gapX = 300;
  const gapY = 260;
  const originX = 160;
  const originY = 140;

  const cells: { c: number; r: number; used: boolean }[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) cells.push({ c, r, used: false });

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

  const cellToXY = (cell: { c: number; r: number }) => {
    const offset = cell.r % 2 === 0 ? 0 : gapX * 0.28;
    return { x: originX + cell.c * gapX + offset, y: originY + cell.r * gapY };
  };

  const seedCell = cells[Math.floor(cells.length / 2)];
  seedCell.used = true;
  pos.set(ordered[0].id, cellToXY(seedCell));

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
        score += (Math.min(Math.hypot(p.x - xy.x, p.y - xy.y), 3 * gapX) / gapX) ** 2;
      }
      if (placedNeighbors.length === 0) {
        const cx = originX + ((cols - 1) * gapX) / 2;
        const cy = originY + ((rows - 1) * gapY) / 2;
        score += Math.hypot(cx - xy.x, cy - xy.y) / (gapX * 4);
      }
      score += Math.random() * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    cells[best].used = true;
    pos.set(node.id, cellToXY(cells[best]));
  }

  return nodes.map((node) => ({
    id: node.id,
    x: pos.get(node.id)?.x ?? originX,
    y: pos.get(node.id)?.y ?? originY,
  }));
}
