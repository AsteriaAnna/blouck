import type { StateCreator } from "zustand";
import { send } from "../api";
import type { State } from "./types";

export type StreamSlice = Pick<
  State,
  | "partial"
  | "streamText"
  | "mentions"
  | "ghosts"
  | "spawnGhosts"
  | "stage"
  | "newNodeIds"
  | "toast"
  | "busy"
  | "extract"
  | "exploreDirection"
  | "ingestSegment"
  | "commitStream"
  | "setPartial"
  | "setStreamText"
  | "setMentions"
  | "setGhosts"
  | "setStage"
  | "clearStream"
  | "showToast"
>;

/** 流式语音/文本抽取：partial/ghost/stage/busy/toast 与 segment/commit。 */
export const createStreamSlice: StateCreator<State, [], [], StreamSlice> = (set, getState) => ({
  partial: "",
  streamText: "",
  mentions: [],
  ghosts: [],
  spawnGhosts: [],
  stage: "idle",
  newNodeIds: [],
  toast: "",
  busy: false,

  showToast: (text) => {
    set({ toast: text });
    window.setTimeout(() => set({ toast: "" }), 2600);
  },

  async extract(text) {
    if (!getState().world) return;
    const before = new Set(getState().nodes.map((n) => n.id));
    const ghostsBefore = getState().ghosts;
    set({ busy: true, stage: "generating", newNodeIds: [], spawnGhosts: ghostsBefore });
    try {
      const p = await send<any>(`/api/worlds/${getState().world!.id}/extract`, "POST", {
        text,
        fromNodeId: getState().focusId,
      });
      const newIds = (p.nodes ?? []).filter((n: any) => !before.has(n.id)).map((n: any) => n.id);
      set({
        nodes: p.nodes,
        edges: p.edges,
        buildings: p.buildings,
        directions: p.directions ?? getState().directions,
        newNodeIds: newIds,
        ghosts: [],
        spawnGhosts: ghostsBefore,
        stage: "done",
        busy: false,
      });
      window.setTimeout(() => {
        if (getState().stage === "done") set({ stage: "idle" });
      }, 2400);
      window.setTimeout(() => set({ newNodeIds: [] }), 3800);
      window.setTimeout(() => set({ spawnGhosts: [] }), 3400);
      const n = p.createdNodes?.length ?? newIds.length;
      const candidates = p.createdCandidates?.length ?? 0;
      getState().showToast(
        n
          ? `已落图 ${n} 个新节点${candidates ? ` · ${candidates} 个进候选` : ""} · ${
              p.provider === "mock" ? "mock 抽取" : "DeepSeek 抽取"
            }`
          : candidates
            ? `已放入 ${candidates} 个候选（缺少语义关系，未上地图）`
            : "这段没有可落图的新实体",
      );
    } catch (e: any) {
      set({ busy: false });
      getState().showToast(e.message ?? "抽取失败");
    }
  },

  async exploreDirection(edgeId) {
    if (!getState().world) return;
    const before = new Set(getState().nodes.map((n) => n.id));
    const ghostsBefore = getState().ghosts;
    set({ busy: true, stage: "generating", newNodeIds: [], spawnGhosts: ghostsBefore });
    try {
      const p = await send<any>(`/api/worlds/${getState().world!.id}/explore`, "POST", { edgeId });
      const newIds = (p.nodes ?? []).filter((n: any) => !before.has(n.id)).map((n: any) => n.id);
      set({
        nodes: p.nodes,
        edges: p.edges,
        buildings: p.buildings,
        directions: p.directions ?? getState().directions,
        newNodeIds: newIds,
        ghosts: [],
        spawnGhosts: ghostsBefore,
        stage: "done",
        busy: false,
      });
      window.setTimeout(() => {
        if (getState().stage === "done") set({ stage: "idle" });
      }, 2400);
      window.setTimeout(() => set({ newNodeIds: [] }), 3800);
      window.setTimeout(() => set({ spawnGhosts: [] }), 3400);
      const created = p.createdNodes?.[0];
      getState().showToast(
        typeof p.warning === "string" && p.warning
          ? p.warning
          : created
            ? `沿方向生成「${created.name}」`
            : "这条方向暂时没有生成新节点",
      );
    } catch (e: any) {
      set({ busy: false });
      getState().showToast(e.message ?? "探索失败");
    }
  },

  async ingestSegment(text) {
    if (!getState().world) return;
    set({ stage: "confirming" });
    try {
      const r = await send<any>(`/api/worlds/${getState().world!.id}/stream/segment`, "POST", {
        text,
        focusId: getState().focusId,
      });
      // T1 会在 segment 响应里带 warning?: string（本段没落图/抽取降级等）；防御式读取，没有也不报错
      const warning = typeof r?.warning === "string" ? r.warning.trim() : "";
      set({
        nodes: r.nodes,
        edges: r.edges,
        focusId: r.focusId ?? getState().focusId,
        ghosts: [],
        stage: "confirming",
      });
      if (warning) getState().showToast(`抽取提示：${warning}`);
    } catch (e: any) {
      // 失败必须可见：toast + 不把 UI 卡在 generating/busy；调用方回滚去重 key 后允许重试这一句
      set({ busy: false, stage: "confirming" });
      getState().showToast(`本句抽取失败：${e?.message ?? "网络错误"}`);
      throw e;
    }
  },

  async commitStream() {
    if (!getState().world) return;
    set({ stage: "generating", busy: true });
    try {
      const r = await send<any>(`/api/worlds/${getState().world!.id}/stream/commit`, "POST", {});
      set({ nodes: r.nodes, edges: r.edges, busy: false, stage: "done" });
      window.setTimeout(() => {
        if (getState().stage === "done") set({ stage: "idle" });
      }, 1600);
    } catch (e: any) {
      // 失败要可见且复位 busy/stage，避免停在“生成中…”
      set({ busy: false, stage: "confirming" });
      getState().showToast(`提交失败：${e?.message ?? "网络错误"}`);
      throw e;
    }
  },

  setPartial: (text) => set({ partial: text, streamText: text }),
  setStreamText: (text) => set({ streamText: text }),
  setMentions: (ids) => set({ mentions: ids }),
  setGhosts: (ghosts) => set({ ghosts }),
  setStage: (stage) => set({ stage }),
  clearStream: () =>
    set({
      partial: "",
      streamText: "",
      mentions: [],
      ghosts: [],
      spawnGhosts: [],
      newNodeIds: [],
      stage: "idle",
    }),
});
