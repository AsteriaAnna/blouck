import { useStore } from "../store";
import World3D from "./World3D";
import InputBar from "./InputBar";
import CandidatePanel from "./CandidatePanel";
import NodeDrawer from "./NodeDrawer";
import DungeonDrawer from "./DungeonDrawer";
import RelationDrawer from "./RelationDrawer";

/**
 * 世界页：只保留 3D 视图（2026-11-14 起 2D React Flow 视图已移除）。
 * 3D 负责渲染；抽屉、输入台、副本/关系编辑仍由 DOM 层负责。
 * 顶栏只留「返回世界列表 + 世界名」，示例标记/统计/供应商/重排/导出等展示与操作已移除。
 */
export default function World() {
  const world = useStore((s) => s.world);
  const drawer = useStore((s) => s.drawer);
  const backHome = useStore((s) => s.backHome);

  if (!world) return null;

  return (
    <>
      <div className="world">
        <div className="topbar">
          <button className="ghost-btn" onClick={backHome}>
            ← 世界列表
          </button>
          <div className="title">{world.name}</div>
        </div>

        <div className="flow-wrap">
          <World3D />
          <div className="legend">
            <div><b>3D 视图</b></div>
            <div className="li">浮岛 = 知识节点；地标 = 节点类型</div>
            <div className="li">贴地曲线 = 关系；立体路牌 = 方向/建议</div>
            <div className="li">塔 = 领域副本；门 = 流程副本</div>
            <div style={{ marginTop: 6 }}><b>节点三档</b>：核心 → Ⅰ 环 → Ⅱ → Ⅲ 塔</div>
          </div>
          <InputBar />
          <CandidatePanel />
        </div>

        {drawer?.kind === "node" && <NodeDrawer />}
        {drawer?.kind === "building" && <DungeonDrawer />}
        {drawer?.kind === "edge" && <RelationDrawer />}
      </div>
    </>
  );
}
