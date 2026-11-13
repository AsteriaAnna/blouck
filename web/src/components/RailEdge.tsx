import { EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";

const COLORS: Record<string, string> = {
  // 地面小路：低对比墨色/土色，比岛弱一档
  formal: "#8a7a63",
  source: "#8fa3a0",
  suggest: "#b0a390",
  direction: "#b9ab97",
};
const OPACITY: Record<string, number> = {
  formal: 0.55,
  source: 0.5,
  suggest: 0.52,
  direction: 0.45,
};

type Pt = { x: number; y: number };

function normalOf(pos?: string): Pt {
  if (pos === "top") return { x: 0, y: -1 };
  if (pos === "right") return { x: 1, y: 0 };
  if (pos === "bottom") return { x: 0, y: 1 };
  if (pos === "left") return { x: -1, y: 0 };
  return { x: 0, y: 1 };
}

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

function hashOf(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function curvePoints(s: Pt, t: Pt, id: string, bend: number): Pt[] {
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const seed = hashOf(id);
  const side = (seed % 2 === 0 ? 1 : -1) * (bend !== 0 ? Math.sign(bend) : 1);
  const bow = Math.min(160, 40 + len * 0.18) * side;
  const nx = -dy / len;
  const ny = dx / len;
  const c1 = { x: s.x + dx * 0.33 + nx * bow, y: s.y + dy * 0.33 + ny * bow };
  const c2 = { x: s.x + dx * 0.66 + nx * bow, y: s.y + dy * 0.66 + ny * bow };
  const out: Pt[] = [];
  for (let i = 0; i <= 28; i++) {
    const u = i / 28;
    const v = 1 - u;
    out.push({
      x: v * v * v * s.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * t.x,
      y: v * v * v * s.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * t.y,
    });
  }
  return out;
}

function smoothPath(points: Pt[]) {
  if (points.length < 3)
    return `M ${points[0].x} ${points[0].y} L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
  }
  return d;
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
  const alpha = OPACITY[kind] ?? 0.5;
  const bend: number = d.bend ?? 0;
  const isDir = kind === "direction";
  const lod: number = d.lod ?? 2;
  const mode: "straight" | "curve" | "rail" = d.mode ?? "curve";

  let pts: Pt[];
  let path: string;
  if (mode === "straight") {
    pts = [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
    path = toPath(pts);
  } else if (mode === "curve") {
    const routed = d.route as Pt[] | undefined;
    if (routed && routed.length > 2) {
      pts = routed;
      path = smoothPath(pts);
    } else {
      const seed2 = hashOf(id);
      const vx = targetX - sourceX;
      const vy = targetY - sourceY;
      const vl = Math.hypot(vx, vy) || 1;
      const nx = -vy / vl;
      const ny = vx / vl;
      const k1 = (((seed2 >> 2) % 7) - 3) * 7;
      const k2 = (((seed2 >> 5) % 7) - 3) * 7;
      pts = curvePoints(
        { x: sourceX + nx * k1, y: sourceY + ny * k1 },
        { x: targetX + nx * k2, y: targetY + ny * k2 },
        id,
        bend,
      );
      path = smoothPath(pts);
    }
  } else {
    const routed = d.route as Pt[] | undefined;
    pts =
      routed && routed.length > 1
        ? routed
        : fallbackRoute(
            { x: sourceX, y: sourceY },
            { x: targetX, y: targetY },
            normalOf(sourcePosition),
            normalOf(targetPosition),
            bend,
          );
    path = toPath(pts);
  }

  const seed = hashOf(id);
  const frac = 0.3 + ((seed % 34) / 100);
  const total = pts.reduce(
    (acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)),
    0,
  );
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
  const rad = (best.angle * Math.PI) / 180;
  const side = seed % 2 === 0 ? 1 : -1;
  const sp = d.signPos as Pt | undefined;
  const signX = sp ? sp.x : best.x + Math.sin(rad) * 16 * side;
  const signY = sp ? sp.y : best.y - Math.cos(rad) * 16 * side;

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
  const arrowA = { x: end.x - ax * 9 - ay * 4, y: end.y - ay * 9 + ax * 4 };
  const arrowB = { x: end.x - ax * 9 + ay * 4, y: end.y - ay * 9 - ax * 4 };

  return (
    <>
      {/* 地面小路：细墨线，不垫底、不加粗 */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={kind === "suggest" ? "4 6" : kind === "direction" ? "1 6" : undefined}
        opacity={alpha}
      />
      <polygon
        points={`${arrowTip.x},${arrowTip.y} ${arrowA.x},${arrowA.y} ${arrowB.x},${arrowB.y}`}
        fill={color}
        opacity={alpha * 0.9}
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
