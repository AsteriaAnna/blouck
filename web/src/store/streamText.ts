/** 一句切出来的文本；complete=false 表示这是累计文本末尾还没带结束标点的半句 */
export type SentencePart = { text: string; complete: boolean };

/**
 * 切分 ASR 会话累计文本（豆包 segment 是“已确定累计文本”，final 是累计全文）。
 * 以 。！？!?；; 与换行为句界；引入句界符的句子算 complete。
 */
export function splitCumulativeText(cumulative: string): SentencePart[] {
  // 逐字符扫描，不用 lookbehind（兼容性更稳）：句界符留在句尾
  const ends = new Set(["。", "！", "？", "!", "?", "；", ";", "\n"]);
  const parts: SentencePart[] = [];
  let start = 0;
  for (let i = 0; i < cumulative.length; i++) {
    if (!ends.has(cumulative[i])) continue;
    const text = cumulative.slice(start, i + 1).trim();
    if (text) parts.push({ text, complete: true });
    start = i + 1;
  }
  // 末尾没有句界符的半句：final 时才送（见 pickNewSentences）
  const tail = cumulative.slice(start).trim();
  if (tail) parts.push({ text: tail, complete: false });
  return parts;
}

/** 句子去重 key：忽略空白与句末标点（半句 “B” 与补全后的 “B。” 视为同一句） */
export function sentenceKey(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[。！？!?；;，,、.…·：:]+$/, "")
    .toLowerCase();
}

/**
 * 从累计文本里挑出还没 ingest 的句子，并把它们记入 ingested。
 * final=false 时丢掉末尾未完结半句（等下一次累计文本补全或 final 再送）；
 * final=true 时尾句即使没有标点也送出。返回按出现顺序排列的新句子。
 */
export function pickNewSentences(
  cumulative: string,
  ingested: Set<string>,
  final: boolean,
): { text: string; key: string }[] {
  const fresh: { text: string; key: string }[] = [];
  for (const part of splitCumulativeText(cumulative)) {
    if (!final && !part.complete) continue;
    const key = sentenceKey(part.text);
    if (!key || ingested.has(key)) continue;
    ingested.add(key);
    fresh.push({ text: part.text, key });
  }
  return fresh;
}
