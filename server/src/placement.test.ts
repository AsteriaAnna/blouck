import test from "node:test";
import assert from "node:assert/strict";
import { placeAround, relax } from "./placement.js";

test("placeAround 空图从锚点右侧起步", () => {
  const p = placeAround([], { id: "a", x: 10, y: 20 });
  assert.deepEqual(p, { x: 370, y: 20 });
});

test("placeAround 新节点与已有节点保持 minGap", () => {
  const realRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const existing = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 120, y: 60 },
      { id: "c", x: -80, y: 140 },
    ];
    const p = placeAround(existing, { id: "a", x: 0, y: 0 }, { minGap: 200 });
    for (const e of existing) {
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      assert.ok(d >= 200, `too close: ${d} to ${e.id}`);
    }
  } finally {
    Math.random = realRandom;
  }
});

test("relax 只消除局部重叠，不整体搬移", () => {
  const out = relax(
    [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 0 },
      { id: "c", x: 500, y: 500 },
    ],
    100,
  );
  const d = Math.hypot(out[0].x - out[1].x, out[0].y - out[1].y);
  assert.ok(d > 80, `expected relaxed distance > 80, got ${d}`);
  assert.deepEqual(out[2], { id: "c", x: 500, y: 500 });
});
