import { env } from "../env.js";
import { deepseekLLM } from "./deepseek.js";
import { doubaoASR } from "./doubao.js";
import { mockASR, mockLLM } from "./mock.js";

/** 当前生效的 LLM/ASR provider（无 key 时自动 mock） */
export const llm = env.deepseekApiKey ? deepseekLLM : mockLLM;
export const asr = env.doubaoAppId && env.doubaoToken ? doubaoASR : mockASR;
