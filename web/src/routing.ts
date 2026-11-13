import { AvoidLib } from "libavoid-js";

type Box = { id: string; x: number; y: number; w: number; h: number };
type Link = { id: string; src: string; dst: string };
type Side = "l" | "r" | "t" | "b";

let avoid: any = null;
let loading: Promise<void> | null = null;

async function getAvoid() {
  if (avoid) return avoid;
  if (!loading) {
    loading = AvoidLib.load("/libavoid.wasm")
      .then(() => {
        avoid = AvoidLib.getInstance();
      })
      .catch((err) => {
        console.warn("[libavoid] 加载失败，回退手写路由", err);
        avoid = null;
      });
  }
  await loading;
  return avoid;
}

/**
 * libavoid 正交避障路由。
 * 关键：同一节点出发/进入的多条边要把端口沿边框分开，
 * 否则所有 ConnEnd 都落在同一个点上，libavoid 也会让线重叠。
 */
export async function routeWithLibavoid(
  boxes: Box[],
  links: Link[],
): Promise<Record<string, { x: number; y: number }[]> | null> {
  const A = await getAvoid();
  if (!A) return null;
  try {
    const byId = new Map(boxes.map((b) => [b.id, b]));

    // 为每条边确定两端从哪一侧出/入
    const portPlan: { link: Link; sSide: Side; tSide: Side }[] = [];
    for (const l of links) {
      const s = byId.get(l.src);
      const t = byId.get(l.dst);
      if (!s || !t) continue;
      const dx = t.x + t.w / 2 - (s.x + s.w / 2);
      const dy = t.y + t.h / 2 - (s.y + s.h / 2);
      const horiz = Math.abs(dx) >= Math.abs(dy);
      const sSide: Side = horiz ? (dx >= 0 ? "r" : "l") : (dy >= 0 ? "b" : "t");
      const tSide: Side = horiz ? (dx >= 0 ? "l" : "r") : (dy >= 0 ? "t" : "b");
      portPlan.push({ link: l, sSide, tSide });
    }

    // 同一节点同侧的端口按对端位置排序，均匀分布
    const groups = new Map<string, { key: string; perp: number; index: number }[]>();
    const sideKey = (id: string, side: Side) => id + ":" + side;
    for (const p of portPlan) {
      const s = byId.get(p.link.src)!;
      const t = byId.get(p.link.dst)!;
      const add = (id: string, side: Side, perp: number) => {
        const key = sideKey(id, side);
        const arr = groups.get(key) ?? [];
        arr.push({ key, perp, index: 0 });
        groups.set(key, arr);
      };
      add(p.link.src, p.sSide, p.sSide === "l" || p.sSide === "r" ? t.y : t.x);
      add(p.link.dst, p.tSide, p.tSide === "l" || p.tSide === "r" ? s.y : s.x);
    }

    const portPoint = (id: string, side: Side, otherPerp: number) => {
      const b = byId.get(id)!;
      const key = sideKey(id, side);
      const arr = groups.get(key) ?? [];
      arr.sort((a, b2) => a.perp - b2.perp);
      let idx = arr.findIndex((x) => x.perp === otherPerp);
      if (idx < 0) idx = 0;
      const n = arr.length;
      const f = n <= 1 ? 0.5 : 0.2 + (0.6 * idx) / (n - 1);
      if (side === "l") return { x: b.x, y: b.y + b.h * f };
      if (side === "r") return { x: b.x + b.w, y: b.y + b.h * f };
      if (side === "t") return { x: b.x + b.w * f, y: b.y };
      return { x: b.x + b.w * f, y: b.y + b.h };
    };

    const router = new A.Router(A.OrthogonalRouting);
    router.setRoutingParameter(A.RoutingParameter.shapeBufferDistance, 12);
    router.setRoutingParameter(A.RoutingParameter.crossingPenalty, 80);
    router.setRoutingParameter(A.RoutingParameter.segmentPenalty, 25);
    router.setRoutingParameter(A.RoutingParameter.idealNudgingDistance, 26);

    const shapes: Record<string, any> = {};
    for (const b of boxes) {
      const rect = new A.Rectangle(
        new A.Point(b.x, b.y),
        Math.max(60, b.w),
        Math.max(60, b.h),
      );
      shapes[b.id] = new A.ShapeRef(router, rect);
    }

    const conns: { id: string; conn: any }[] = [];
    for (const p of portPlan) {
      const s = byId.get(p.link.src)!;
      const t = byId.get(p.link.dst)!;
      const src = portPoint(p.link.src, p.sSide, p.sSide === "l" || p.sSide === "r" ? t.y : t.x);
      const dst = portPoint(p.link.dst, p.tSide, p.tSide === "l" || p.tSide === "r" ? s.y : s.x);
      const conn = new A.ConnRef(
        router,
        new A.ConnEnd(new A.Point(src.x, src.y)),
        new A.ConnEnd(new A.Point(dst.x, dst.y)),
      );
      conns.push({ id: p.link.id, conn });
    }
    router.processTransaction();

    const out: Record<string, { x: number; y: number }[]> = {};
    for (const { id, conn } of conns) {
      const route = conn.displayRoute();
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < route.size(); i++) {
        const pt = route.at(i);
        pts.push({ x: Number(pt.x), y: Number(pt.y) });
      }
      out[id] = pts;
    }
    return out;
  } catch (err) {
    console.warn("[libavoid] 路由失败，回退手写折线", err);
    return null;
  }
}
