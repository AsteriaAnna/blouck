/** 节点 → 3D 模型映射（资产来自 prototype/tools 生成的 _assets） */

const ISLAND_IDS = [
  "rag", "retrieval", "vectordb", "embedding", "chunking", "bm25", "docparse",
  "clean", "kg", "generation", "hallucination", "ctx", "prompt", "eval",
  "recall", "qa", "finetune", "agent", "workflow", "multimodal", "longctx",
];

/** 名称关键词 → 岛模型 id（先匹配到的优先） */
const KEYWORDS: [string, string[]][] = [
  ["vectordb", ["向量数据库", "向量库", "向量"]],
  ["embedding", ["embedding", "嵌入"]],
  ["chunking", ["chunking", "分块"]],
  ["bm25", ["bm25"]],
  ["docparse", ["文档解析", "解析"]],
  ["clean", ["清洗"]],
  ["kg", ["知识图谱", "图谱"]],
  ["hallucination", ["幻觉"]],
  ["ctx", ["上下文窗口", "上下文"]],
  ["longctx", ["长上下文", "长文本"]],
  ["prompt", ["prompt", "提示词"]],
  ["eval", ["评测", "评估"]],
  ["recall", ["召回"]],
  ["qa", ["问答", "qa"]],
  ["finetune", ["微调"]],
  ["agent", ["agent", "智能体"]],
  ["workflow", ["工作流"]],
  ["multimodal", ["多模态"]],
  ["generation", ["生成"]],
  ["retrieval", ["检索"]],
  ["rag", ["rag"]],
];

export function islandModelName(name: string, seedId: string): string {
  const lower = name.toLowerCase();
  for (const [id, words] of KEYWORDS) {
    if (words.some((w) => lower.includes(w.toLowerCase()))) return id;
  }
  let h = 0;
  for (let i = 0; i < seedId.length; i++) h = (h * 31 + seedId.charCodeAt(i)) | 0;
  return ISLAND_IDS[Math.abs(h) % ISLAND_IDS.length];
}

export function islandModelUrl(name: string, seedId: string): string {
  return `/assets3d/island_${islandModelName(name, seedId)}.glb`;
}

export function buildingModelUrl(kind: string): string {
  return kind === "flow" ? "/assets3d/gate_flow.glb" : "/assets3d/gate_domain.glb";
}
