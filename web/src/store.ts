import { create } from "zustand";
import { createStreamSlice } from "./store/streamSlice";
import { createWorldSlice } from "./store/worldSlice";
import type { State } from "./store/types";

export type { Ghost, StreamStage, State } from "./store/types";
export type { SentencePart } from "./store/streamText";
export { pickNewSentences, sentenceKey, splitCumulativeText } from "./store/streamText";

/**
 * 前端全局状态。按职责拆 slices：
 * - worldSlice：世界/图读取、抽屉、题目、副本（读 + 更新）
 * - streamSlice：语音/文本抽取、partial/ghost/stage/busy/toast
 * 纯句子切分/去重在 store/streamText.ts，便于单独测试。
 */
export const useStore = create<State>()((...a) => ({
  ...createWorldSlice(...a),
  ...createStreamSlice(...a),
}));
