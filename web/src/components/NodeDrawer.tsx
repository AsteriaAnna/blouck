import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useStore } from "../store";

export default function NodeDrawer() {
  const drawer = useStore((s) => s.drawer);
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

  useEffect(() => {
    if (node) setMd(node.free_md ?? "");
  }, [node?.id, node?.free_md]);

  if (!node) return null;
  const short = quizzes.filter((q) => q.kind === "short");
  const judge = quizzes.filter((q) => q.kind === "judge");

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
                  生成 5 简答 + 10 判断
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="hintline" style={{ marginBottom: 8 }}>
                已生成 {short.length} 简答 / {judge.length} 判断（AI 题才计入三档）
              </div>
              {short.map((q) => (
                <div className="quiz" key={q.id}>
                  <div className="kind">简答</div>
                  <div className="q">{q.prompt}</div>
                  <textarea
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    placeholder="写下你的理解"
                  />
                  <div className="ans">
                    <button
                      className="primary"
                      onClick={() => answerQuiz(q.id, answers[q.id] ?? "")}
                    >
                      提交
                    </button>
                  </div>
                </div>
              ))}
              {judge.map((q) => (
                <div className="quiz" key={q.id}>
                  <div className="kind">判断</div>
                  <div className="q">{q.prompt}</div>
                  <div className="ans">
                    <button className="secondary" onClick={() => answerQuiz(q.id, "对")}>
                      对
                    </button>
                    <button className="secondary" onClick={() => answerQuiz(q.id, "错")}>
                      错
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
          <div className="hintline" style={{ marginTop: 10 }}>
            答题失败可重答；不同题只计一次通过。
          </div>
        </div>

        <div className="section">
          <h4>节点操作</h4>
          <div className="row">
            <button
              className="secondary"
              onClick={async () => {
                await fetch(`/api/nodes/${node.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ hidden: !node.hidden }),
                });
                useStore.setState({
                  nodes: nodes.map((n) =>
                    n.id === node.id ? { ...n, hidden: n.hidden ? 0 : 1 } : n,
                  ),
                });
              }}
            >
              {node.hidden ? "恢复显示" : "隐藏节点"}
            </button>
            <span className="hintline">隐藏只改变显示，不删除内容与记录</span>
          </div>
        </div>
      </div>
    </div>
  );
}
