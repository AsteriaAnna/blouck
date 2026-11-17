import test from "node:test";
import assert from "node:assert/strict";
import { scoreExplanation } from "./services/explanationQuality.js";

test("解释评分：空解释 0；完整解释高分；缺 rubric 降分", () => {
  const rubric = ["指出正确关系类型", "引用原文证据", "说明为什么不是相邻类型"];
  const empty = scoreExplanation("", rubric, false);
  assert.equal(empty.score, 0);
  assert.equal(empty.missing.length, rubric.length);

  const good = scoreExplanation(
    "依据原文，A 是 B 的一种，所以这是归类关系，而不是组成关系，边界在于 kindOf 与 partOf 不同。",
    rubric,
    true,
  );
  assert.ok(good.score >= 70, `good score ${good.score}`);
  assert.ok(good.covered.length >= 2);

  const weak = scoreExplanation("就是那样。", rubric, false);
  assert.ok(weak.score < 60);
  assert.ok(weak.missing.length > 0);
});
