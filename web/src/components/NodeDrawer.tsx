import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useStore } from "../store";

/** 点击节点的文档：名称 + 正文 + 来源（沿用早期样片的 MD 结构：标题 / 正文 / 来源引用） */
export default function NodeDrawer() {
  const drawer = useStore((s) => s.drawer);
  const nodes = useStore((s) => s.nodes);
  const saveMd = useStore((s) => s.saveMd);
  const closeDrawer = useStore((s) => s.closeDrawer);

  const node = nodes.find((n) => n.id === (drawer?.kind === "node" ? drawer.id : ""));
  const [editing, setEditing] = useState(false);
  const [md, setMd] = useState("");

  useEffect(() => {
    if (!node) return;
    setMd(node.free_md ?? "");
    setEditing(false);
  }, [node?.id]);

  if (!node) return null;

  const aliases = (() => {
    try {
      const list = JSON.parse(node.aliases || "[]") as string[];
      return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch {
      return [];
    }
  })();
  const body = [node.definition, md].filter((x) => x && x.trim()).join("\n\n");
  const source = node.source_at
    ? `来源：${new Date(node.source_at).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })}${node.source_text ? ` · ${node.source_text.slice(0, 120)}` : ""}`
    : node.source_text
      ? `来源：${node.source_text.slice(0, 120)}`
      : "";

  return (
    <div className="drawer">
      <header>
        <div className="k">
          {node.type || "概念"}
          {aliases.length ? ` · 别名：${aliases.join("、")}` : ""}
        </div>
        <h2>{node.name}</h2>
        <button className="close" onClick={closeDrawer}>
          ×
        </button>
      </header>
      <div className="body">
        <div className="md-preview node-doc">
          <h3>{node.name}</h3>
          {body ? <ReactMarkdown>{body}</ReactMarkdown> : null}
          {source ? <blockquote>{source}</blockquote> : null}
        </div>
        {editing ? (
          <div style={{ marginTop: 12 }}>
            <textarea
              className="md-edit"
              value={md}
              onChange={(e) => setMd(e.target.value)}
              placeholder="写下你的理解…"
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="primary"
                onClick={async () => {
                  await saveMd(node.id, md);
                  setEditing(false);
                }}
              >
                保存
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setMd(node.free_md ?? "");
                  setEditing(false);
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button className="ghost-btn" style={{ marginTop: 12 }} onClick={() => setEditing(true)}>
            编辑
          </button>
        )}
      </div>
    </div>
  );
}
