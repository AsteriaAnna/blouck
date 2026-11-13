import { EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";

const COLORS: Record<string, string> = {
  formal: "#2a2620",
  source: "#4f7a9a",
  suggest: "#8a8278",
  direction: "#a79e90",
};

type Pt = { x: number; y: number };

function normalOf(pos?: string): Pt {
  if (pos === "top") return { x: 0, y: -1 };
  if (pos === "right") return { x: 1, y: 0 };
  if (pos === "bottom") return { x: 0, y: 1 };
  if (pos === "left") return { x: -1, y: 0 };
  return { x: 0, y: 1 };
}

/** 备用路由：从岛尖端沿法线出线，正交折线接到目标尖端 */
function fallbackRoute(s: Pt, t: Pt, n1: Pt, n2: Pt, bend: number): Pt[] {
  const d = 34 + Math.abs(bend) * 14;
  const p1 = { x: s.x + n1.x * d, y: s.y + n1.y * d };
  const p3 = { x: t.x + n2.x * d, y: t.y + n2.y * d };
  if (n1.x !== 0) {
    const mx = p3.x + bend * 18;
    return [s, p1, { x: mx, y: p1.y }, { x: mx, y: p3.y }, p3, t];
  }
  return [s, p1, { x: p1.x, y: p3.y + bend * 18 }, p3, t];
}

function toPath(points: Pt[], r = 12) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const prev = points[i - 1];
    const next = points[i + 1];
    const v1 = { x: p.x - prev.x, y: p.y - prev.y };
    const v2 = { x: next.x - p.x, y: next.y - p.y };
    const l1 = Math.hypot(v1.x, v1.y) || 1;
    const l2 = Math.hypot(v2.x, v2.y) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const a = { x: p.x - (v1.x / l1) * rr, y: p.y - (v1.y / l1) * rr };
    const b = { x: p.x + (v2.x / l2) * rr, y: p.y + (v2.y / l2) * rr };
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function offsetLine(points: Pt[], off: number) {
  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: p.x + (-dy / l) * off, y: p.y + (dx / l) * off };
  });
}

export default function RailEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
  } = props;
  const d = (data ?? {}) as any;
  const kind: string = d.kind ?? "formal";
  const color = COLORS[kind] ?? COLORS.formal;
  const bend: number = d.bend ?? 0;
  const isDir = kind === "direction";
  const lod: number = d.lod ?? 2;

  const routed = d.route as Pt[] | undefined;
  const pts = d.straight
    ? [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }]
    : routed && routed.length > 1
      ? routed
      : fallbackRoute(
          { x: sourceX, y: sourceY },
          { x: targetX, y: targetY },
          normalOf(sourcePosition),
          normalOf(targetPosition),
          bend,
        );

  const left = toPath(offsetLine(pts, 2.8));
  const right = toPath(offsetLine(pts, -2.8));
  const path = toPath(pts);

  // 路牌沿路径按 id 哈希错位，避免同一走廊上的牌子叠在一起
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) | 0;
  const frac = 0.3 + ((Math.abs(seed) % 34) / 100);
  const total = pts.reduce((acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)), 0);
  let walked = 0;
  let best = { x: pts[0].x, y: pts[0].y, angle: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + len >= total * frac) {
      const t = len ? (total * frac - walked) / len : 0;
      best = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      };
      break;
    }
    walked += len;
  }
  // 垂直方向再错开一点；World 会传全局避让后的 signPos
  const rad = (best.angle * Math.PI) / 180;
  const side = Math.abs(seed) % 2 === 0 ? 1 : -1;
  const sp = d.signPos as { x: number; y: number } | undefined;
  const signX = sp ? sp.x : best.x + Math.sin(rad) * 14 * side;
  const signY = sp ? sp.y : best.y - Math.cos(rad) * 14 * side;

  const label = isDir ? d.question || "下一步方向" : d.label || "关系";
  const showSign = !d.noSign && lod > 0 && (isDir || kind === "suggest");

  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2] ?? end;
  const ux = end.x - prev.x;
  const uy = end.y - prev.y;
  const ul = Math.hypot(ux, uy) || 1;
  const ax = ux / ul;
  const ay = uy / ul;
  const arrowTip = { x: end.x - ax * 2, y: end.y - ay * 2 };
  const arrowA = { x: end.x - ax * 11 - ay * 5, y: end.y - ay * 11 + ax * 5 };
  const arrowB = { x: end.x - ax * 11 + ay * 5, y: end.y - ay * 11 - ax * 5 };

  return (
    <>
      <path d={left} fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      <path d={right} fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      {kind === "suggest" && (
        <path d={path} fill="none" stroke="#fffdf7" strokeWidth={1.2} strokeDasharray="5 8" opacity={0.9} />
      )}
      <polygon
        points={`${arrowTip.x},${arrowTip.y} ${arrowA.x},${arrowA.y} ${arrowB.x},${arrowB.y}`}
        fill={color}
      />

      {showSign && (
        <EdgeLabelRenderer>
          <div
            className={"rail-post" + (isDir ? " dir" : "") + (kind === "suggest" ? " suggest" : "")}
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${signX}px,${signY}px)`,
              pointerEvents: "all",
            }}
          >
            <button
              className="rail-board"
              title={isDir ? "方向路牌：点击查看问题" : label}
              onClick={(e) => {
                e.stopPropagation();
                d.onSign?.(id);
              }}
            >
              <span
                className="rail-board-arrow"
                style={{ transform: `rotate(${isDir ? best.angle : 0}deg)` }}
              >
                {isDir ? "➜" : "▸"}
              </span>
              <span className="rail-board-text">{label}</span>
            </button>
            <span className="rail-stem" />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
