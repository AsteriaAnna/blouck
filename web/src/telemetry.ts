/** 本地指标：fire-and-forget，不阻塞 UI，不影响主链路。 */
export function track(
  type: string,
  opts: { worldId?: string | null; targetId?: string | null; payload?: unknown } = {},
) {
  try {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        type,
        worldId: opts.worldId ?? null,
        targetId: opts.targetId ?? null,
        payload: opts.payload ?? {},
      }),
    }).catch(() => {});
  } catch {
    // 指标永远不影响功能
  }
}
