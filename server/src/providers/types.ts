/** 服务端 Provider 抽象：DeepSeek（语言）与豆包（流式 ASR）的预留位 */

import type {
  EdgeKind,
  NodeDoc,
  NodeType,
  RelationDoc,
  RelationPredicate,
} from "@blouck/shared";
export type { NodeType, RelationPredicate };

export type ExtractEntity = {
  name: string;
  hint?: string;
  type?: NodeType;
  definition?: string;
  aliases?: string[];
  evidence?: string;
  confidence?: number;
};

export type ExtractRelation = {
  type: EdgeKind;
  /** 知识语义谓词（关系 v2）；source/direction 可空 */
  predicate?: RelationPredicate;
  label: string;
  /** 关系起点（概念名）；缺省为焦点 */
  source?: string;
  target: string;
  question?: string;
  evidence?: string;
  confidence?: number;
};

export type ExtractProcess = {
  /** 过程/工作流本身的名称，例如“内容生产工作流” */
  name: string;
  /** 有序步骤名（不是节点，只属于流程副本） */
  steps: string[];
  evidence?: string[];
  confidence?: number;
};

export type ExtractResult = {
  entities: ExtractEntity[];
  relations: ExtractRelation[];
  processes?: ExtractProcess[];
  /** 抽取失败/超时等非致命问题：本段不落图，前端可据此提示（toast） */
  warning?: string;
};

export type RelationSuggestion = {
  predicate: RelationPredicate;
  label: string;
  md: string;
};

export type DirectionSuggestion = {
  node: string;
  question: string;
  reason: string;
  /** 生成方向时就计划好的延伸节点（探索时直接落它，不再抽取问题文本） */
  target?: {
    name: string;
    type?: NodeType;
    definition?: string;
    aliases?: string[];
  };
  predicate?: RelationPredicate;
  label?: string;
};

export type DungeonFlowSuggestion = {
  processName: string;
  steps: string[];
  precedence: { before: string; after: string; evidence: string }[];
  confidence: number;
};

export type DungeonDomainSuggestion = {
  domainName: string;
  members: string[];
  commonParent?: string;
  sharedSpanIds?: string[];
  confidence: number;
};

export type DungeonSuggestions = {
  flows: DungeonFlowSuggestion[];
  domains: DungeonDomainSuggestion[];
};

export type QuizItem = {
  kind: "short" | "judge";
  prompt: string;
  answer: string;
};

export type NodeDocDraft = Omit<NodeDoc, "generated_at">;
export type RelationDocDraft = Omit<RelationDoc, "generated_at">;

export type NodeDocInput = {
  name: string;
  type?: string;
  definition?: string;
  sourceText?: string;
  neighbors: {
    id: string;
    name: string;
    predicate?: string | null;
    label?: string;
    evidence?: string;
  }[];
};

export type RelationDocInput = {
  a: { id: string; name: string; definition?: string };
  b: { id: string; name: string; definition?: string };
  predicate?: string | null;
  label?: string;
  evidence?: string;
};

export type UnderstandingTaskDraft = {
  learning_goal: "discriminate" | "explain" | "apply" | "transfer";
  misconception: string;
  stem: string;
  choices: { id: string; text: string }[];
  correct_choice: string;
  rubric: string[];
  evidence_quote: string;
  follow_up: string;
};

export type UnderstandingTaskInput = {
  sourceText: string;
  a: { name: string; definition?: string };
  b: { name: string; definition?: string };
  predicate?: string | null;
  label?: string;
  evidence?: string;
  neighbors: string[];
  variant?: "boundary" | "counterexample" | "error_correction" | "transfer";
  /** 质检失败后的重写提示：缺了什么、为什么不合格 */
  repair?: string;
};

export type NodeUnderstandingInput = {
  sourceText: string;
  node: { name: string; type?: string; definition?: string };
  neighbors: { name: string; predicate?: string | null; evidence?: string }[];
  variant?: "boundary" | "counterexample" | "error_correction" | "transfer";
  repair?: string;
};

export type LLMProvider = {
  name: string;
  /** 从一段稳定文本里抽取实体与关系（对应 MVP 的“节点生成/关系生成”） */
  extract(input: {
    text: string;
    focus: { id: string; name: string };
    existing: string[];
  }): Promise<ExtractResult>;
  /** 按需生成 5 简答 + 10 判断 */
  generateQuiz(input: { name: string; md: string }): Promise<QuizItem[]>;
  /** 简答判题 */
  judge(input: {
    prompt: string;
    answer: string;
    reference: string;
  }): Promise<{ correct: boolean; feedback: string }>;
  /** 用户手动连线时，给出关系谓词/名称/说明 */
  suggestRelation(input: {
    a: { name: string; definition?: string; md?: string };
    b: { name: string; definition?: string; md?: string };
    evidence?: string;
  }): Promise<RelationSuggestion>;
  /** 为一批节点生成下一步方向问题 + 预先计划好延伸节点 */
  suggestDirections(input: {
    nodes: { name: string; definition?: string; evidence?: string; neighbors: string[] }[];
    existing: string[];
  }): Promise<DirectionSuggestion[]>;
  /** 基于当前图提出流程/领域副本候选（程序再做硬校验） */
  detectDungeons(input: {
    nodes: { name: string; type?: string; definition?: string }[];
    edges: { src: string; dst: string; predicate?: string | null; label?: string; evidence?: string }[];
  }): Promise<DungeonSuggestions>;

  /** V3：节点理解卡草稿。只依据输入证据，不要编造。 */
  generateNodeDoc(input: NodeDocInput): Promise<NodeDocDraft>;

  /** V3：关系对照卡草稿。只依据输入证据，不要编造。 */
  generateRelationDoc(input: RelationDocInput): Promise<RelationDocDraft>;

  /** V3：关系辨析任务（不是定义回忆题）。必须针对一个误解，带原文引用与 rubric。 */
  generateUnderstandingTask(input: UnderstandingTaskInput): Promise<UnderstandingTaskDraft>;

  /** V3：节点辨析任务（体系位置/边界），同样必须带原文引用。 */
  generateNodeUnderstandingTask(input: NodeUnderstandingInput): Promise<UnderstandingTaskDraft>;
};

export type ASREvents = {
  onPartial: (text: string) => void;
  onSegment?: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
};

export type ASROptions = {
  hotwords?: string[];
  context?: string[];
};

export type ASRSession = {
  push: (chunk: Buffer) => void;
  end: () => void;
};

export type ASRProvider = {
  name: string;
  open(events: ASREvents, options?: ASROptions): ASRSession;
};
