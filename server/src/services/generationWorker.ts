import type { LLMProvider } from "../providers/types.js";
import {
  claimNextGenerationJob,
  finishGenerationJob,
  type JobType,
} from "../db/docs.js";
import { ensureNodeDoc, ensureRelationDoc } from "./contentDocs.js";

/**
 * 单进程生成 worker：串行领取 job，避免一次打爆 LLM。
 * 未接的任务类型直接标 done（保留队列可观测），后续阶段再实现。
 */
export async function runOneGenerationJob(llm: LLMProvider): Promise<boolean> {
  const job = claimNextGenerationJob();
  if (!job) return false;
  try {
    switch (job.type as JobType) {
      case "node_doc":
        await ensureNodeDoc(job.target_id, llm);
        break;
      case "relation_doc":
        await ensureRelationDoc(job.target_id, llm);
        break;
      default:
        break;
    }
    finishGenerationJob(job.id);
  } catch (err: any) {
    finishGenerationJob(job.id, String(err?.message ?? err));
  }
  return true;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startGenerationWorker(llm: LLMProvider, intervalMs = 900) {
  if (timer) return;
  timer = setInterval(() => {
    void runOneGenerationJob(llm);
  }, intervalMs);
  // 不要因为后台 worker 阻止进程退出（测试/脚本）
  timer.unref?.();
}

export function stopGenerationWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
