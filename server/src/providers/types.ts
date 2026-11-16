/** 服务端 Provider 抽象：DeepSeek（语言）与豆包（流式 ASR）的预留位 */

export type NodeType = "概念" | "方法" | "组件" | "指标" | "工具";
export type RelationPredicate =
  | "kindOf"
  | "partOf"
  | "prerequisite"
  | "contrast"
  | "alternative"
  | "related";

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
  type: "source" | "formal" | "suggest" | "direction";
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
  /** 为一批节点生成下一步方向问题 */
  suggestDirections(input: {
    nodes: { name: string; definition?: string; evidence?: string; neighbors: string[] }[];
  }): Promise<DirectionSuggestion[]>;
  /** 基于当前图提出流程/领域副本候选（程序再做硬校验） */
  detectDungeons(input: {
    nodes: { name: string; type?: string; definition?: string }[];
    edges: { src: string; dst: string; predicate?: string | null; label?: string; evidence?: string }[];
  }): Promise<DungeonSuggestions>;
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
