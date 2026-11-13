import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useStore } from "../store";

export default function NodeDrawer() {
  const drawer = useStore((s) => s.drawer);
  const world = useStore((s) => s.world);
  const nodes = useStore((s) => s.nodes);
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
