import {
  addEdge,
  addNode,
  createWorld,
  getGraph,
  listBuildings,
  setNodePosition,
} from "../db.js";
import { placeAround, relax, type Placed } from "../placement.js";

const VOCAB = [
  "检索", "重排", "评测", "记忆", "工具调用", "多模态", "推理", "规划",
  "幻觉", "上下文窗口", "向量库", "索引", "分块", "微调", "对齐", "蒸馏",
  "Agent", "工作流", "提示词", "召回", "精排", "生成", "事实性", "延迟",
];

/**
 * 模拟一次真实探索：
 * - 每一轮拿一个"前沿节点"当焦点，生成 1~2 个新节点；
 * - 新节点位置由 placeAround 现场判断（围绕焦点、朝外、避开已有节点）；
 * - 新老节点位置都保留，不整体重排，最后只做局部松弛。
 */
export async function simulateExplore(
  rounds: number,
  detect: (worldId: string, focus: any, nodes: any[]) => void,
) {
  const world = createWorld(`探索模拟 · ${rounds} 轮`, "起点");
  const start = getGraph(world.id).nodes[0];
  const placed: Placed[] = [{ id: start.id, x: start.x, y: start.y }];
  const frontier = [start.id];
  const allIds = [start.id];
  let vi = 0;

  for (let r = 0; r < rounds; r++) {
    const focusId = frontier.length ? frontier.shift()! : allIds[Math.floor(Math.random() * allIds.length)];
    const focus = placed.find((p) => p.id === focusId)!;
    const k = 1 + (r % 2);
    for (let j = 0; j < k; j++) {
      const name = VOCAB[vi % VOCAB.length] + (vi >= VOCAB.length ? `·${vi}` : "");
      vi++;
      const pos = placeAround(placed, focus, { preferAngle: (placed.length * 1.7) % (Math.PI * 2) });
      const node = addNode(world.id, name, pos.x, pos.y);
      placed.push({ id: node.id, x: pos.x, y: pos.y });
      allIds.push(node.id);
      addEdge(world.id, focusId, node.id, j === 0 ? "formal" : "source", "探索延伸");
      frontier.push(node.id);

      // 发现关联：连到一个已有节点，并把新节点往两者中间拉近
      if (allIds.length > 4) {
        const otherId = allIds[Math.floor(Math.random() * allIds.length)];
        const other = placed.find((p) => p.id === otherId);
        if (other && otherId !== node.id) {
          addEdge(world.id, node.id, otherId, r % 3 === 0 ? "suggest" : "formal", "发现关联");
          const mx = node.x * 0.65 + other.x * 0.35;
          const my = node.y * 0.65 + other.y * 0.35;
          const adjusted = placeAround(
            placed.filter((p) => p.id !== node.id),
            { id: node.id, x: mx, y: my },
            { minGap: 220 },
          );
          node.x = adjusted.x;
          node.y = adjusted.y;
          const mine = placed.find((p) => p.id === node.id)!;
          mine.x = adjusted.x;
          mine.y = adjusted.y;
        }
      }
    }
    frontier.push(focusId);
    if (r % 6 === 0) addEdge(world.id, focusId, focusId, "direction", "下一步可以探索什么？");
  }

  // 结构化：一条流程链 + 一个领域簇，验证副本生成
  const chain: string[] = [];
  const clusterCenter = placeAround(placed, { id: "cluster", x: 600, y: 900 }, { minGap: 240 });
  for (let i = 0; i < 4; i++) {
    const pos = i === 0
      ? clusterCenter
      : placeAround(placed, placed.find((p) => p.id === chain[i - 1])!, { minGap: 230 });
    const n = addNode(world.id, `流程步骤${i + 1}`, pos.x, pos.y);
    placed.push({ id: n.id, x: pos.x, y: pos.y });
    chain.push(n.id);
    if (i > 0) addEdge(world.id, chain[i - 1], n.id, "formal", "步骤");
  }
  const clusterAnchor = placeAround(placed, { id: "c2", x: 1200, y: 900 }, { minGap: 240 });
  const center = addNode(world.id, "领域中心", clusterAnchor.x, clusterAnchor.y);
  placed.push({ id: center.id, ...clusterAnchor });
  const clusterIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const pos = placeAround(placed, { id: center.id, x: clusterAnchor.x, y: clusterAnchor.y }, { minGap: 225 });
    const n = addNode(world.id, `领域节点${i + 1}`, pos.x, pos.y);
    placed.push({ id: n.id, x: pos.x, y: pos.y });
    addEdge(world.id, center.id, n.id, "formal", "属于");
    // 邻居之间互相连接，形成真正的"领域簇"
    if (clusterIds.length) addEdge(world.id, n.id, clusterIds[clusterIds.length - 1], "formal", "同类");
    clusterIds.push(n.id);
  }

  // 局部松弛：消除放置阶段的少量挤压，不整体重排
  const relaxed = relax(placed, 215);
  for (const p of relaxed) setNodePosition(p.id, p.x, p.y);

  const graph = getGraph(world.id);
  detect(world.id, graph.nodes[0], graph.nodes);

  const W = 190, H = 170, SP = 1.28;
  const nodes = getGraph(world.id).nodes;
  let overlaps = 0;
  let minGap = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = Math.abs(nodes[i].x - nodes[j].x) * SP;
      const dy = Math.abs(nodes[i].y - nodes[j].y) * SP;
      if (dx < W && dy < H) overlaps++;
      minGap = Math.min(minGap, Math.max(dx - W, dy - H));
    }
  }
  const buildings = listBuildings(world.id);
  const extentX = Math.max(...nodes.map((n) => n.x)) - Math.min(...nodes.map((n) => n.x));
  const extentY = Math.max(...nodes.map((n) => n.y)) - Math.min(...nodes.map((n) => n.y));

  return {
    ok: true,
    world,
    layoutEngine: "incremental",
    stats: {
      nodes: nodes.length,
      edges: getGraph(world.id).edges.length,
      rounds,
      overlaps,
      minGap: Number.isFinite(minGap) ? Math.round(minGap) : null,
      extent: `${Math.round(extentX)}×${Math.round(extentY)}`,
      buildings: buildings.length,
      buildingKinds: buildings.map((b) => b.kind),
    },
  };
}
