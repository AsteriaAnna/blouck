import { Handle, Position } from "@xyflow/react";

/** 副本建筑节点：领域副本 / 流程副本 */
export default function BuildingNode({ data }: any) {
  const locked = data.status === "locked" || data.status === "locked";
  return (
    <div
      className={"building-node" + (locked ? " locked" : "")}
      title={data.sub}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="box">
        <div className="kind">
          {data.kind === "flow" ? "流程副本" : "领域副本"} · 建筑
        </div>
        <div className="name">{data.title}</div>
        <div className="status">
          {data.status === "cleared" ? "已通关" : data.status === "locked" ? "未解锁" : "可挑战"}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
