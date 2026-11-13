import { Handle, Position } from "@xyflow/react";

/** 方向线终点：不连到任何节点，只表示"这个方向还没探索" */
export default function DirectionNode({ data }: any) {
  return (
    <div className="dir-marker" title={data.question || "下一步方向"}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="dir-circle">?</div>
      {data.question && <div className="dir-q">{data.question}</div>}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
