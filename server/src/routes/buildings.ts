import { Router } from "express";
import {
  createDomainQuestions,
  getBuilding,
  getNode,
  listDomainQuestions,
  updateBuildingMd,
  type NodeRow,
} from "../db.js";
import { llm } from "../providers/active.js";

/** /api/buildings/*：副本读取、挑战、提交、MD 编辑 */
export const buildingsRouter = Router();

buildingsRouter.get("/api/buildings/:id", (req, res) => {
  const b = getBuilding(req.params.id);
  if (!b) return res.status(404).json({ error: "building not found" });
  res.json({ building: b });
});

buildingsRouter.post("/api/buildings/:id/challenge", async (req, res) => {
  const b = getBuilding(req.params.id);
  if (!b) return res.status(404).json({ error: "building not found" });
  if (b.status === "locked" || b.status === "detected" || b.status === "stale") {
    res.status(409).json({ error: "尚未解锁：相关节点达到第一档后可挑战" });
    return;
  }
  if (b.kind === "flow") {
    const rawSteps: string[] = JSON.parse(b.steps || "[]");
    const names = rawSteps.map((x) => getNode(x)?.name ?? x);
    const shuffled = [...names].sort(() => Math.random() - 0.5);
    return res.json({
      kind: "flow",
      title: b.title,
      md: b.md,
      steps: shuffled,
      status: b.status,
    });
  }

  // 领域副本：按用户+世界+领域+自然日的 10 道混合题（填空/判断/解答）
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  let questions = listDomainQuestions(b.id, day);
  if (questions.length === 0) {
    const steps: string[] = JSON.parse(b.steps || "[]");
    const members = steps.map((id) => getNode(id)).filter(Boolean) as NodeRow[];
    const pool = members.length ? members : ([getNode(b.anchor)].filter(Boolean) as NodeRow[]);
    const items: {
      kind: "fill" | "judge" | "answer";
      prompt: string;
      answer: string;
      aliases?: string[];
    }[] = [];
    for (let i = 0; i < 10; i++) {
      const n = pool[i % Math.max(1, pool.length)];
      if (!n) break;
      const def = n.definition || `${n.name} 的相关知识`;
      const kind = (["fill", "judge", "answer"] as const)[i % 3];
      if (kind === "fill") {
        items.push({ kind, prompt: `「${n.name}」的核心定义是什么？`, answer: def });
      } else if (kind === "judge") {
        const other = pool[(i + 1) % Math.max(1, pool.length)];
        const trueClaim = i % 2 === 0;
        items.push({
          kind,
          prompt: trueClaim
            ? `「${n.name}」是指 ${def}。`
            : `「${n.name}」是指 ${other?.definition || "与本领域无关的概念"}。`,
          answer: trueClaim ? "对" : "错",
        });
      } else {
        items.push({ kind, prompt: `用自己的话解释「${n.name}」。`, answer: def });
      }
    }
    createDomainQuestions(b.id, day, items);
    questions = listDomainQuestions(b.id, day);
  }
  res.json({
    kind: "domain",
    title: b.title,
    md: b.md,
    daily: { used: questions.length, limit: 10 },
    questions: questions.map((q) => ({ id: q.id, prompt: q.prompt, kind: q.kind })),
    status: b.status,
  });
});

buildingsRouter.post("/api/buildings/:id/submit", async (req, res) => {
  const b = getBuilding(req.params.id);
  if (!b) return res.status(404).json({ error: "building not found" });
  if (b.status !== "playable" && b.status !== "cleared") {
    return res.status(409).json({ error: "副本尚未解锁，不能提交" });
  }
  if (b.kind === "flow") {
    const expected: string[] = (JSON.parse(b.steps || "[]") as string[]).map(
      (x) => getNode(x)?.name ?? x,
    );
    const order: string[] = (Array.isArray(req.body?.order) ? req.body.order : []).map(
      (x: string) => getNode(x)?.name ?? x,
    );
    const correct =
      order.length === expected.length && order.every((x, i) => x === expected[i]);
    // 旧排序题只做复习，不再直接 mark cleared；通关必须走辨析副本序列。
    return res.json({ correct, expected, status: b.status, practice: true });
  }

  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const questions = listDomainQuestions(b.id, day);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answers: { id: string; answer: string }[] = Array.isArray(req.body?.answers)
    ? req.body.answers
    : [];
  const norm = (v: string) => v.toLowerCase().replace(/[\s，。,.；;：:（）()]/g, "").trim();
  let ok = 0;
  for (const a of answers) {
    const q = byId.get(a.id);
    if (!q) continue;
    if (q.kind === "answer") {
      const judged = await llm.judge({ prompt: q.prompt, answer: a.answer, reference: q.answer });
      if (judged.correct) ok++;
    } else {
      const accepted = [q.answer, ...(JSON.parse(q.aliases || "[]") as string[])].map(norm);
      const got = norm(a.answer);
      const hit =
        accepted.some((x) => x === got || (got.length >= 2 && x.includes(got)) || got.includes(x)) ||
        (() => {
          const ref = new Set(accepted[0]?.split("") ?? []);
          const chars = new Set(got.split(""));
          if (!ref.size) return false;
          let n = 0;
          for (const ch of chars) if (ref.has(ch)) n++;
          return n / ref.size >= 0.6;
        })();
      if (hit) ok++;
    }
  }
  const passed = answers.length > 0 && ok / answers.length >= 0.6;
  // 旧定义题/字符判分只做复习，不能成为 cleared 的另一条路径。
  return res.json({
    correct: passed,
    score: `${ok}/${answers.length}`,
    status: b.status,
    practice: true,
  });
});

buildingsRouter.patch("/api/buildings/:id", (req, res) => {
  const b = getBuilding(req.params.id);
  if (!b) return res.status(404).json({ error: "building not found" });
  const md = typeof req.body?.md === "string" ? req.body.md : b.md;
  const steps = Array.isArray(req.body?.steps) ? req.body.steps : undefined;
  updateBuildingMd(b.id, md, steps);
  res.json({ ok: true });
});
