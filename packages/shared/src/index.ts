/**
 * 前后端共享的 DTO / enum / API 契约。
 *
 * 规则：
 * - 这里是“线上 JSON 的形状”，不是数据库行类型；
 * - 新增字段必须向后兼容（可选或迁移）；
 * - 产品术语见 docs/engineering/glossary.md；不要把 kind 当产品四类线。
 */

export type NodeType = "概念" | "方法" | "组件" | "指标" | "工具";

export const NODE_TYPES: NodeType[] = ["概念", "方法", "组件", "指标", "工具"];

export type RelationPredicate =
  | "kindOf"
  | "partOf"
  | "prerequisite"
  | "contrast"
  | "alternative"
  | "related";

export const RELATION_PREDICATES: RelationPredicate[] = [
  "kindOf",
  "partOf",
  "prerequisite",
  "contrast",
  "alternative",
  "related",
];

/** 代码 kind（不是产品四类线；映射见 docs/engineering/glossary.md） */
export type EdgeKind = "formal" | "source" | "suggest" | "direction";
export const EDGE_KINDS: EdgeKind[] = ["formal", "source", "suggest", "direction"];

export type EdgeOrigin = "auto" | "manual" | "stream" | "direction";

export type NodeStatus = "provisional" | "committed";

export type BuildingKind = "domain" | "flow";
export type BuildingStatus = "detected" | "locked" | "playable" | "cleared" | "stale";
export type DirectionStatus = "open" | "consumed" | "archived";

/** 产品线型的展示名（用于 UI/文档；不要用于数据库 kind） */
export const LINE_KIND_TO_PRODUCT: Record<EdgeKind, string> = {
  formal: "关系线",
  source: "顺序线",
  suggest: "关联提示线",
  direction: "探索线",
};

/**
 * Canonical（产品）线型/状态。
 * 数据库仍存 EdgeKind；新代码用这里的 line_type/line_state 表达产品语义。
 * 迁移阶段：DB kind 不动 → API 附加 canonical 字段 → 前端逐步改用 canonical → 最后再改 DB。
 */
export type LineType = "relation" | "sequence" | "hint" | "exploration";
export type LineState = "confirmed" | "proposed" | "provenance" | "planned" | "consumed";

export const EDGE_KIND_TO_LINE_TYPE: Record<EdgeKind, LineType> = {
  formal: "relation",
  source: "sequence",
  suggest: "hint",
  direction: "exploration",
};

export const LINE_TYPE_LABEL: Record<LineType, string> = {
  relation: "关系线",
  sequence: "顺序线",
  hint: "关联提示线",
  exploration: "探索线",
};

export function deriveLineFields(edge: {
  kind: EdgeKind;
  consumed?: number | null;
}): { line_type: LineType; line_state: LineState } {
  const line_type = EDGE_KIND_TO_LINE_TYPE[edge.kind];
  let line_state: LineState;
  switch (line_type) {
    case "relation":
      line_state = "confirmed";
      break;
    case "hint":
      line_state = "proposed";
      break;
    case "sequence":
      line_state = "provenance";
      break;
    case "exploration":
      line_state = edge.consumed ? "consumed" : "planned";
      break;
  }
  return { line_type, line_state };
}

export type WorldDTO = {
  id: string;
  name: string;
  root_node_id: string;
  is_demo: number;
  created_at: number;
};

export type PassedDTO = { short: number; judge: number };

export type NodeDTO = {
  id: string;
  world_id: string;
  name: string;
  x: number;
  y: number;
  free_md: string;
  hidden: number;
  tier: number;
  type: string;
  definition: string;
  aliases: string;
  source_span_id: string | null;
  frontier: number;
  status?: NodeStatus;
  passed?: PassedDTO;
  /** 节点来源片段（只读，节点 MD 的“来源”引用） */
  source_text?: string | null;
  source_at?: number | null;
};

export type EdgeDTO = {
  id: string;
  world_id: string;
  src: string;
  dst: string;
  kind: EdgeKind;
  label: string;
  md: string;
  question: string | null;
  frontier_x?: number | null;
  frontier_y?: number | null;
  consumed?: number;
  predicate?: RelationPredicate | string | null;
  evidence?: string;
  confidence?: number;
  origin?: EdgeOrigin | string;
  claim_status?: string;
  revision?: number;
  /** canonical 产品线型/状态（由 kind/consumed 派生，迁移期附加） */
  line_type?: LineType;
  line_state?: LineState;
  /** 方向线生成时预先计划好的延伸节点 */
  target_name?: string | null;
  target_type?: string | null;
  target_definition?: string | null;
  target_aliases?: string | null;
  target_predicate?: string | null;
  target_label?: string | null;
};

export type BuildingDTO = {
  id: string;
  world_id: string;
  kind: BuildingKind;
  anchor: string;
  title: string;
  sub: string;
  md: string;
  steps: string;
  status: BuildingStatus;
  version?: number;
  basis?: string;
  fingerprint?: string;
  x: number;
  y: number;
};

/**
 * 产品名“副本”的 alias。DB/API 仍保留 building 命名以兼容旧数据；
 * 新代码/前端组件可优先用 Dungeon*，等 DB 迁移时再统一。
 */
export type DungeonDTO = BuildingDTO;
export type DungeonKind = BuildingKind;
export type DungeonStatus = BuildingStatus;

export type DirectionDTO = {
  id: string;
  world_id: string;
  node_id: string;
  question: string;
  reason: string;
  target_hint: string | null;
  target_name?: string | null;
  target_type?: string | null;
  target_definition?: string | null;
  target_aliases?: string | null;
  target_predicate?: string | null;
  target_label?: string | null;
  status: DirectionStatus;
  consumed_span_id?: string | null;
  created_at: number;
};

export type QuizDTO = {
  id: string;
  node_id: string;
  kind: "short" | "judge";
  prompt: string;
  answer: string;
};

export type WorldPayloadDTO = {
  world: WorldDTO;
  nodes: NodeDTO[];
  edges: EdgeDTO[];
  buildings: BuildingDTO[];
  directions?: DirectionDTO[];
};

/** API 请求体：抽取/探索/手动关系/语音段落 */
export type ExtractRequest = { text: string; fromNodeId?: string | null };
export type ExploreRequest = { edgeId: string };
export type RelationsRequest = {
  fromNodeId: string;
  toNodeId: string;
  predicate?: RelationPredicate | string;
  label?: string;
  evidence?: string;
  md?: string;
};
export type StreamSegmentRequest = { text: string; focusId?: string | null };
export type StreamCommitRequest = { ids?: string[] };

/** 通用 API 错误体 */
export type ApiError = { error: string };
