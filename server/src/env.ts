import "dotenv/config";

/**
 * 环境配置。
 * DeepSeek / 豆包 的 key 只放在服务端，不进入前端构建。
 * 未配置 key 时自动走 mock，保证本地可跑通全链路。
 */
export const env = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.DB_PATH ?? "data/mvp.db",

  // ---- 语言模型（DeepSeek）----
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",

  // ---- 实时语音（豆包流式 ASR）----
  doubaoAppId: process.env.DOUBAO_ASR_APP_ID ?? "",
  doubaoToken: process.env.DOUBAO_ASR_TOKEN ?? "",
  doubaoWsUrl:
    process.env.DOUBAO_ASR_WS_URL ??
    "wss://openspeech.bytedance.com/api/v2/asr",
  doubaoCluster: process.env.DOUBAO_ASR_CLUSTER ?? "volcengine_input_common",
};

export const providers = {
  llm: env.deepseekApiKey ? "deepseek" : "mock",
  asr: env.doubaoAppId && env.doubaoToken ? "doubao" : "mock",
} as const;
