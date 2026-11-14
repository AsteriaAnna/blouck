import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useStore } from "../store";

export default function NodeDrawer() {
  const drawer = useStore((s) => s.drawer);
  const world = useStore((s) => s.world);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const directions = useStore((s) => s.directions);
  const quizzes = useStore((s) => s.quizzes);
  const passed = useStore((s) => s.passed);
  const tier = useStore((s) => s.tier);
  const quizStatus = useStore((s) => s.quizStatus);
  const busy = useStore((s) => s.busy);
  const saveMd = useStore((s) => s.saveMd);
  const generateQuiz = useStore((s) => s.generateQuiz);
  const answerQuiz = useStore((s) => s.answerQuiz);
  const closeDrawer = useStore((s) => s.closeDrawer);

  const node = nodes.find((n) => n.id === (drawer?.kind === "node" ? drawer.id : ""));
  const [md, setMd] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hidePreview, setHidePreview] = useState<{ id: string; name: string }[] | null>(null);
  const [hideBusy, setHideBusy] = useState(false);
  const [linkTo, setLinkTo] = useState("");
  const [linkPredicate, setLinkPredicate] = useState("related");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);

  useEffect(() => {
    if (node) setMd(node.free_md ?? "");
    setHidePreview(null);
  }, [node?.id, node?.free_md]);

  if (!node) return null;
  const short = quizzes.filter((q) => q.kind === "short");
  const judge = quizzes.filter((q) => q.kind === "judge");
  const isRoot = world?.root_node_id === node.id;

  async function previewHide() {
    if (!world || !node) return;
    setHideBusy(true);
    try {
      const r = await fetch(`/api/worlds/${world.id}/hide/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: node.id }),
      });
      const data = await r.json();
      if (!r.ok) {
        useStore.getState().showToast(data.error ?? "隐藏预览失败");
        return;
      }
      setHidePreview(data.nodes ?? []);
    } finally {
      setHideBusy(false);
    }
  }

  async function confirmHide() {
    if (!world || !node) return;
    setHideBusy(true);
    try {
      const r = await fetch(`/api/worlds/${world.id}/hide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: node.id }),
      });
      const data = await r.json();
      if (!r.ok) {
        useStore.getState().showToast(data.error ?? "隐藏失败");
        return;
      }
      setHidePreview(null);
      closeDrawer();
      await useStore.getState().openWorld(world.id);
      useStore.getState().showToast(`已隐藏 ${data.count} 个节点（可撤回）`);
    } finally {
      setHideBusy(false);
    }
  }

  return (
    <div className="drawer">
      <header>
        <div className="k">节点 · 第 {tier || 0} 档 / 3</div>
        <h2>{node.name}</h2>
        <div className="tierbar">
          <span className={"chip" + (passed.short >= 1 && passed.judge >= 1 ? " on" : "")}>
            第一档 1/1
          </span>
          <span className={"chip" + (passed.short >= 3 && passed.judge >= 5 ? " on" : "")}>
            第二档 3/5
          </span>
          <span className={"chip" + (passed.short >= 5 && passed.judge >= 10 ? " on" : "")}>
            第三档 5/10
          </span>
          <span className="chip">{passed.short}/5 简答</span>
          <span className="chip">{passed.judge}/10 判断</span>
        </div>
        <button className="close" onClick={closeDrawer}>
          ×
        </button>
      </header>
      <div className="body">
        <div className="section">
          <h4>概念</h4>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="chip">{node.type || "概念"}</span>
            {node.frontier ? <span className="chip on">边缘节点 · 地图展示方向</span> : null}
          </div>
          {node.definition ? (
            <div className="hintline" style={{ fontSize: 14, lineHeight: 1.7 }}>
              {node.definition}
            </div>
          ) : (
            <div className="hintline">还没有定义；编辑自由区或继续探索来补充。</div>
          )}
          {(() => {
            try {
              const aliases = JSON.parse(node.aliases || "[]") as string[];
              return aliases.length ? <div className="hintline">别名：{aliases.join("、")}</div> : null;
            } catch {
              return null;
            }
          })()}
        </div>

        <div className="section">
          <h4>关系定位</h4>
          {edges.filter(
            (e) =>
              (e.src === node.id || e.dst === node.id) &&
              e.kind !== "direction" &&
              e.kind !== "source",
          ).length === 0 ? (
            <div className="hintline">还没有归类/定位关系。</div>
          ) : (
            edges
              .filter(
                (e) =>
                  (e.src === node.id || e.dst === node.id) &&
                  e.kind !== "direction" &&
                  e.kind !== "source",
              )
              .map((e) => {
                const other = nodes.find((n) => n.id === (e.src === node.id ? e.dst : e.src));
                return (
                  <div key={e.id} className="hintline" style={{ marginBottom: 6 }}>
                    <b>{e.predicate || e.kind}</b> · {other?.name ?? "?"}：{e.label || "—"}
                    {e.evidence ? <div style={{ opacity: 0.75 }}>依据：{e.evidence}</div> : null}
                  </div>
                );
              })
          )}
        </div>

        <div className="section">
          <h4>手动关联</h4>
          <div className="hintline">把当前概念和另一个概念连成正式关系；关系名留空时由 AI 给出。</div>
          <select
            className="md-edit"
            style={{ minHeight: 38, marginTop: 6 }}
            value={linkTo}
            onChange={(e) => setLinkTo(e.target.value)}
          >
            <option value="">选择另一个概念…</option>
            {nodes
              .filter((n) => n.id !== node.id && !n.hidden)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </select>
          <select
            className="md-edit"
            style={{ minHeight: 38, marginTop: 6 }}
            value={linkPredicate}
            onChange={(e) => setLinkPredicate(e.target.value)}
          >
            <option value="related">相关</option>
            <option value="kindOf">归类（具体→上位）</option>
            <option value="partOf">组成（部分→整体）</option>
            <option value="prerequisite">前置（前置→后续）</option>
            <option value="contrast">对比</option>
            <option value="alternative">替代（旧→新）</option>
          </select>
          <input
            className="md-edit"
            style={{ minHeight: 38, marginTop: 6 }}
            value={linkLabel}
            onChange={(e) => setLinkLabel(e.target.value)}
            placeholder="关系名（留空由 AI 生成）"
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="primary"
              disabled={!linkTo || linkBusy}
              onClick={async () => {
                if (!world || !node || !linkTo) return;
                setLinkBusy(true);
                try {
                  const r = await fetch(`/api/worlds/${world.id}/relations`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      fromNodeId: node.id,
                      toNodeId: linkTo,
                      predicate: linkPredicate,
                      label: linkLabel || undefined,
                    }),
                  });
                  const data = await r.json();
                  if (!r.ok) {
                    useStore.getState().showToast(data.error ?? "建立关系失败");
                    return;
                  }
                  setLinkTo("");
                  setLinkLabel("");
                  await useStore.getState().openWorld(world.id);
                  useStore.getState().showToast("已建立正式关系");
                } finally {
                  setLinkBusy(false);
                }
              }}
            >
              建立关系
            </button>
          </div>
        </div>

        <div className="section">
          <h4>继续探索</h4>
          {directions.filter((d) => d.node_id === node.id && d.status === "open").length === 0 ? (
            <div className="hintline">暂无方向；下一次抽取/对话会生成。</div>
          ) : (
            directions
              .filter((d) => d.node_id === node.id && d.status === "open")
              .map((d) => (
                <div key={d.id} className="hintline" style={{ marginBottom: 6 }}>
                  → {d.question}
                  {d.reason ? <div style={{ opacity: 0.75 }}>{d.reason}</div> : null}
                </div>
              ))
          )}
          {!node.frontier ? (
            <div className="hintline">非边缘节点：方向只在这里列出，不在地图上画线。</div>
          ) : null}
        </div>

        <div className="section">
          <h4>自由区（可编辑）</h4>
          <textarea
            className="md-edit"
            value={md}
            onChange={(e) => setMd(e.target.value)}
            placeholder="摘录、资料、链接、图片、定位、关系…"
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => saveMd(node.id, md)}>
              保存
            </button>
            <span className="hintline">自由区不会被 AI 自动覆盖</span>
          </div>
          {md.trim() && (
            <div className="md-preview" style={{ marginTop: 10 }}>
              <ReactMarkdown>{md}</ReactMarkdown>
            </div>
          )}
        </div>

        <div className="section">
          <h4>题目区</h4>
          {quizzes.length === 0 ? (
            <div className="hintline">
              {quizStatus === "idle" ? "题库未生成" : "生成中…"}
              <div style={{ marginTop: 8 }}>
                <button className="primary" disabled={busy} onClick={() => generateQuiz(node.id)}>
                  生成题库（5 简答 + 10 判断）
                </button>
              </div>
            </div>
          ) : (
            <>
              {short.map((q) => (
                <div key={q.id} className="quiz">
                  <div className="q">{q.prompt}</div>
                  <textarea
                    className="md-edit"
                    placeholder="写下你的答案"
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  />
                  <div className="row">
                    <button
                      className="secondary"
                      onClick={async () => {
                        await answerQuiz(q.id, answers[q.id] ?? "");
                        await useStore.getState().openNode(node.id);
                      }}
                    >
                      提交
                    </button>
                  </div>
                </div>
              ))}
              {judge.map((q) => (
                <div key={q.id} className="quiz">
                  <div className="q">{q.prompt}</div>
                  <div className="row">
                    <button
                      className="secondary"
                      onClick={async () => {
                        await answerQuiz(q.id, "对");
                        await useStore.getState().openNode(node.id);
                      }}
                    >
                      对
                    </button>
                    <button
                      className="secondary"
                      onClick={async () => {
                        await answerQuiz(q.id, "错");
                        await useStore.getState().openNode(node.id);
                      }}
                    >
                      错
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="section">
          <h4>隐藏</h4>
          {isRoot ? (
            <div className="hintline">初始节点暂不提供隐藏。</div>
          ) : hidePreview === null ? (
            <button className="secondary" disabled={hideBusy} onClick={previewHide}>
              隐藏整片（先预览）
            </button>
          ) : (
            <div>
              <div className="hintline">
                移除「{node.name}」后会断开：
                {hidePreview.length ? (
                  <ul>
                    {hidePreview.slice(0, 12).map((n) => (
                      <li key={n.id}>{n.name}</li>
                    ))}
                  </ul>
                ) : (
                  <div>（没有其它节点会断开）</div>
                )}
              </div>
              <div className="row">
                <button className="primary" disabled={hideBusy} onClick={confirmHide}>
                  确认隐藏 {hidePreview.length + 1} 个节点
                </button>
                <button className="secondary" onClick={() => setHidePreview(null)}>
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
