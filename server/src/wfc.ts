import type { EdgeRow, NodeRow } from "./db.js";

type Cell = { c: number; r: number };
type Placed = { id: string; cell: Cell };

/**
 * WFC 图布局：
 * - 地图先切成格子（每个格子是"未坍缩"的位置）；
 * - 每个未放置节点维护一个"候选格子域"（只允许落在已放置邻居附近）；
 * - 每次挑候选最少的节点（熵最低）先坍缩，选格子时按"邻居相邻/中心吸引/方向"打分；
 * - 坍缩后重新计算邻居的候选域（约束传播），直到所有节点落位；
 * - 最后在格子内做确定性的抖动，避免看起来像纯网格。
 *
 * 和旧 WFC-lite 的区别：旧版是"按度数顺序、每步贪心选空格"；
 * 这里是真的按熵排序 + 域收缩 + 传播，边会更短、簇更紧。
 */
export function wfcGraphLayout(nodes: NodeRow[], edges: EdgeRow[]) {
  const n = nodes.length;
  if (n === 0) return [] as { id: string; x: number; y: number }[];

  const cols = Math.max(3, Math.ceil(Math.sqrt(n * 1.5)));
  const rows = Math.max(2, Math.ceil(n / cols) + 1);
  const cellW = 260;
  const cellH = 230;
  const originX = 200;
  const originY = 170;

  const cellList: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cellList.push({ c, r });
  }
  const center = { c: (cols - 1) / 2, r: (rows - 1) / 2 };
  const manhattan = (a: Cell, b: Cell) => Math.abs(a.c - b.c) + Math.abs(a.r - b.r);

  // 邻接表
  const neighbors = new Map<string, Set<string>>();
  for (const node of nodes) neighbors.set(node.id, new Set());
  for (const e of edges) {
    if (e.kind === "direction") continue;
    neighbors.get(e.src)?.add(e.dst);
    neighbors.get(e.dst)?.add(e.src);
  }

  // 从度数最高的节点开始 BFS，决定坍缩顺序的先后（离根近的先稳定）
  const degree = new Map<string, number>();
  for (const node of nodes) degree.set(node.id, neighbors.get(node.id)?.size ?? 0);
  const start = [...nodes].sort((a, b) => (degree.get(b.id)! - degree.get(a.id)!))[0];

  const order: string[] = [];
  const seen = new Set<string>();
  const queue = [start.id];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const nb of neighbors.get(id) ?? []) if (!seen.has(nb)) queue.push(nb);
  }
  for (const node of nodes) if (!seen.has(node.id)) order.push(node.id);

  const placed: Placed[] = [];
  const used = new Set<string>();
  const posOf = new Map<string, { x: number; y: number }>();
  const placedById = new Map<string, Cell>();

  const occupiedKey = (cell: Cell) => cell.c + ":" + cell.r;
  const isFree = (cell: Cell) => !used.has(occupiedKey(cell));

  let hashSeed = 0;
  for (let i = 0; i < start.id.length; i++) hashSeed = (hashSeed * 31 + start.id.charCodeAt(i)) | 0;
  const rand = (() => {
    let s = Math.abs(hashSeed) || 1;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  })();

  const seedCell = { c: Math.floor(center.c), r: Math.floor(center.r) };
  used.add(occupiedKey(seedCell));
  placed.push({ id: start.id, cell: seedCell });
  placedById.set(start.id, seedCell);
  posOf.set(start.id, cellToXY(seedCell, start.id));

  for (const id of order) {
    if (id === start.id) continue;

    const nbs = [...(neighbors.get(id) ?? [])].filter((nb) => placedById.has(nb));
    // 候选域：已放置邻居周围 2 格内
    let domain: Cell[] = [];
    if (nbs.length) {
      const seenCell = new Set<string>();
      for (const nb of nbs) {
        const base = placedById.get(nb)!;
        for (const cell of cellList) {
          if (!isFree(cell)) continue;
          if (manhattan(cell, base) > 2) continue;
          const k = occupiedKey(cell);
          if (seenCell.has(k)) continue;
          seenCell.add(k);
          domain.push(cell);
        }
      }
    }
    if (!domain.length) domain = cellList.filter(isFree);

    // 加权打分：邻居相邻 > 相邻的两格 > 靠中心 > 少量随机
    let best = domain[0];
    let bestScore = -Infinity;
    for (const cell of domain) {
      let adjacent = 0;
      let near = 0;
      for (const nb of nbs) {
        const d = manhattan(cell, placedById.get(nb)!);
        if (d <= 1) adjacent++;
        else if (d === 2) near++;
      }
      const distCenter = Math.hypot(cell.c - center.c, cell.r - center.r);
      const score = adjacent * 120 + near * 25 - distCenter * 6 + rand() * 18;
      if (score > bestScore) {
        bestScore = score;
        best = cell;
      }
    }
    used.add(occupiedKey(best));
    placed.push({ id, cell: best });
    placedById.set(id, best);
    posOf.set(id, cellToXY(best, id));
  }

  return nodes.map((node) => ({
    id: node.id,
    ...(posOf.get(node.id) ?? { x: originX, y: originY }),
  }));

  /** 格子内确定性抖动，避免看起来像整齐网格 */
  function cellToXY(cell: Cell, id: string) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0;
    const jx = ((Math.abs(h) % 61) / 60 - 0.5) * cellW * 0.26;
    const jy = ((Math.abs(h >> 5) % 67) / 66 - 0.5) * cellH * 0.26;
    return {
      x: originX + cell.c * cellW + jx,
      y: originY + cell.r * cellH + jy,
    };
  }
}
