import { AvoidLib } from "libavoid-js";

type Box = { id: string; x: number; y: number; w: number; h: number };
type Link = { id: string; src: string; dst: string };

let avoid: any = null;
let loading: Promise<void> | null = null;

async function getAvoid() {
  if (avoid) return avoid;
  if (!loading) {
    loading = AvoidLib.load()
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
 * libavoid 正交避障路由：把每个节点当成障碍矩形，边绕开节点。
 * 失败时返回 null，调用方回退到自己的折线路径。
 */
export async function routeWithLibavoid(
  boxes: Box[],
  links: Link[],
): Promise<Record<string, { x: number; y: number }[]> | null> {
  const A = await getAvoid();
  if (!A) return null;
  try {
    const router = new A.Router(A.OrthogonalRouting);
    router.setRoutingParameter(A.RoutingParameter.shapeBufferDistance, 14);
    router.setRoutingParameter(A.RoutingParameter.crossingPenalty, 60);
    router.setRoutingParameter(A.RoutingParameter.segmentPenalty, 20);

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
    for (const l of links) {
      const s = boxes.find((b) => b.id === l.src);
      const t = boxes.find((b) => b.id === l.dst);
      if (!s || !t) continue;
      const src = new A.Point(s.x + s.w / 2, s.y + s.h);
      const dst = new A.Point(t.x + t.w / 2, t.y + t.h);
      const conn = new A.ConnRef(router, new A.ConnEnd(src), new A.ConnEnd(dst));
      conns.push({ id: l.id, conn });
    }
    router.processTransaction();

    const out: Record<string, { x: number; y: number }[]> = {};
    for (const { id, conn } of conns) {
      const route = conn.displayRoute();
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < route.size(); i++) {
        const p = route.at(i);
        pts.push({ x: Number(p.x), y: Number(p.y) });
      }
      out[id] = pts;
    }
    // 不清 router：WASM 对象较多，交给 GC；频繁重排时可加 router.delete()
    return out;
  } catch (err) {
    console.warn("[libavoid] 路由失败，回退手写折线", err);
    return null;
  }
}
