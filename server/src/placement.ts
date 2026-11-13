import type { NodeRow } from "./db.js";

export type Placed = { id: string; x: number; y: number };

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * 增量式语义放置：新节点围绕"父节点"落在一条条环上，
 * 候选位置按「不压已有节点 + 朝外生长 + 扇形分散」打分。
 *
 * 和全局重排的区别：老节点位置保持不动，地图是"长出来"的。
 */
export function placeAround(
  existing: Placed[],
  anchor: Placed,
  opts: { minGap?: number; preferAngle?: number } = {},
): { x: number; y: number } {
  const minGap = opts.minGap ?? 235;
  if (existing.length === 0) return { x: anchor.x + 300, y: anchor.y };

  // 地图重心 → 用来判断"朝外"方向
  const cx = existing.reduce((a, p) => a + p.x, 0) / existing.length;
  const cy = existing.reduce((a, p) => a + p.y, 0) / existing.length;
  let ox = anchor.x - cx;
  let oy = anchor.y - cy;
  const ol = Math.hypot(ox, oy);
  if (ol < 1) {
    const a = existing.length * GOLDEN;
    ox = Math.cos(a);
    oy = Math.sin(a);
  } else {
    ox /= ol;
    oy /= ol;
  }

  const prefer = opts.preferAngle ?? 0;
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;

  for (const radius of [250, 330, 420, 520, 640, 780]) {
    for (let k = 0; k < 16; k++) {
      const angle = prefer + k * (Math.PI / 8) + existing.length * 0.17;
      const x = anchor.x + Math.cos(angle) * radius;
      const y = anchor.y + Math.sin(angle) * radius;

      // 到已有节点的最小空隙
      let clearance = Infinity;
      for (const p of existing) {
        const d = Math.hypot(p.x - x, p.y - y);
        clearance = Math.min(clearance, d - minGap);
        if (clearance < -200) break;
      }

      // 朝外生长 + 与父节点方向有一定角度差（形成扇形而不是一条射线）
      const outward = (Math.cos(angle) * ox + Math.sin(angle) * oy) * 120;
      const spread = Math.abs(Math.cos(angle - prefer)) * 20;
      const score = clearance * 3 + outward + spread + Math.random() * 12;

      if (clearance >= 0 && score > bestScore) {
        bestScore = score;
        best = { x, y };
      } else if (!best && score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    if (best && bestScore > 0) break;
  }

  return best ?? { x: anchor.x + 300, y: anchor.y };
}

/** 局部松弛：只在新节点附近消掉残留重叠，不整体重排 */
export function relax(placed: Placed[], minGap = 215): Placed[] {
  const out = placed.map((p) => ({ ...p }));
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[j].x - out[i].x;
        const dy = out[j].y - out[i].y;
        const d = Math.hypot(dx, dy) || 1;
        if (d >= minGap) continue;
        const push = (minGap - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        out[i].x -= ux * push;
        out[i].y -= uy * push;
        out[j].x += ux * push;
        out[j].y += uy * push;
      }
    }
  }
  return out;
}
