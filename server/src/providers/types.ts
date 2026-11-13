/** 服务端 Provider 抽象：DeepSeek（语言）与豆包（流式 ASR）的预留位 */

export type ExtractEntity = { name: string; hint?: string };
export type ExtractRelation = {
  type: "source" | "formal" | "suggest" | "direction";
  label: string;
  target: string;
  question?: string;
};

export type ExtractResult = {
  entities: ExtractEntity[];
  relations: ExtractRelation[];
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
};

export type ASREvents = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
};

export type ASRSession = {
  push: (chunk: Buffer) => void;
  end: () => void;
};

export type ASRProvider = {
  name: string;
  open(events: ASREvents): ASRSession;
};
