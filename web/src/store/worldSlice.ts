import type { StateCreator } from "zustand";
import {
  get,
  send,
  type BuildingRow,
  type DirectionRow,
  type EdgeRow,
  type NodeRow,
  type Passed,
  type Quiz,
  type World,
  type WorldPayload,
} from "../api";
import type { State } from "./types";

export type WorldSlice = Pick<
  State,
  | "view"
  | "worlds"
  | "world"
  | "nodes"
  | "edges"
  | "buildings"
  | "directions"
  | "focusId"
  | "drawer"
  | "quizzes"
  | "passed"
  | "tier"
  | "quizStatus"
  | "challenge"
  | "mapExpand"
  | "toggleMapExpand"
  | "mapZoom"
  | "setMapZoom"
  | "loadWorlds"
  | "createWorld"
  | "openWorld"
  | "backHome"
  | "openNode"
  | "openBuilding"
  | "openEdge"
  | "closeDrawer"
  | "refreshWorldData"
  | "saveMd"
  | "generateQuiz"
  | "answerQuiz"
  | "acceptEdge"
  | "startChallenge"
  | "submitFlow"
  | "submitDomain"
  | "setFocus"
>;

/** 世界/图读取、抽屉、题目、副本：打开一个世界后的大部分“读 + 更新”。 */
export const createWorldSlice: StateCreator<State, [], [], WorldSlice> = (set, getState) => ({
  view: "home",
  worlds: [],
  world: null,
  nodes: [],
  edges: [],
  buildings: [],
  directions: [],
  focusId: null,
  drawer: null,
  quizzes: [],
  passed: { short: 0, judge: 0 },
  tier: 0,
  quizStatus: "idle",
  challenge: null,
  mapExpand: false,
  mapZoom: "far",

  toggleMapExpand() {
    set({ mapExpand: !getState().mapExpand });
  },

  setMapZoom(zoom) {
    set({ mapZoom: zoom });
  },

  async loadWorlds() {
    const r = await get<{ worlds: World[] }>("/api/worlds");
    set({ worlds: r.worlds });
  },

  async createWorld(name, root) {
    const r = await send<{ world: World }>("/api/worlds", "POST", { name, rootName: root });
    await getState().openWorld(r.world.id);
  },

  async openWorld(id) {
    const p = await get<WorldPayload>(`/api/worlds/${id}`);
    history.replaceState(null, "", `#world/${id}`);
    set({
      view: "world",
      world: p.world,
      nodes: p.nodes,
      edges: p.edges,
      buildings: p.buildings,
      directions: p.directions ?? [],
      focusId: p.world.root_node_id,
      drawer: null,
      challenge: null,
      mapExpand: false,
      mapZoom: "far",
      partial: "",
      streamText: "",
      mentions: [],
      ghosts: [],
      spawnGhosts: [],
      stage: "idle",
      newNodeIds: [],
    });
  },

  async backHome() {
    history.replaceState(null, "", "#");
    set({ view: "home", world: null, drawer: null, challenge: null });
    await getState().loadWorlds();
  },

  openEdge(id: string) {
    set({ drawer: { kind: "edge", id }, challenge: null });
  },

  async openNode(id) {
    history.replaceState(null, "", `#world/${getState().world?.id}/node/${id}`);
    set({ drawer: { kind: "node", id }, focusId: id, challenge: null });
    const q = await get<any>(`/api/nodes/${id}/quiz`);
    set({
      quizzes: q.quizzes ?? [],
      passed: q.passed ?? { short: 0, judge: 0 },
      tier: q.tier ?? 0,
      quizStatus: q.status ?? "idle",
    });
  },

  async openBuilding(id) {
    history.replaceState(null, "", `#world/${getState().world?.id}/building/${id}`);
    set({ drawer: { kind: "building", id }, challenge: null });
    await getState().startChallenge(id).catch(() => null);
  },

  closeDrawer: () => {
    const w = getState().world?.id;
    history.replaceState(null, "", w ? `#world/${w}` : "#");
    set({ drawer: null, challenge: null });
  },

  /** 只刷新图/副本数据，不关闭当前抽屉（答题后解锁副本状态用）。 */
  async refreshWorldData() {
    const id = getState().world?.id;
    if (!id) return;
    const p = await get<WorldPayload>(`/api/worlds/${id}`);
    set({
      world: p.world,
      nodes: p.nodes,
      edges: p.edges,
      buildings: p.buildings,
      directions: p.directions ?? getState().directions,
    });
  },

  setFocus: (id) => set({ focusId: id }),

  async saveMd(id, md) {
    await send(`/api/nodes/${id}`, "PATCH", { freeMd: md });
    set({ nodes: getState().nodes.map((n) => (n.id === id ? { ...n, free_md: md } : n)) });
    getState().showToast("已保存自由区");
  },

  async generateQuiz(id) {
    set({ busy: true });
    try {
      const q = await send<any>(`/api/nodes/${id}/quiz/generate`, "POST");
      set({
        quizzes: q.quizzes ?? [],
        passed: q.passed ?? { short: 0, judge: 0 },
        tier: q.tier ?? 0,
        quizStatus: "ready",
        busy: false,
      });
    } catch (e: any) {
      set({ busy: false });
      getState().showToast(e.message ?? "出题失败");
    }
  },

  async answerQuiz(id, answer) {
    const r = await send<any>(`/api/quiz/${id}/answer`, "POST", { answer });
    getState().showToast((r.correct ? "正确" : "再想想") + (r.feedback ? "：" + r.feedback : ""));
    const q = getState().quizzes.find((x) => x.id === id);
    if (q) {
      set({
        nodes: getState().nodes.map((n) =>
          n.id === q.node_id ? { ...n, tier: r.tier, passed: r.passed } : n,
        ),
      });
    }
    const node = getState().drawer?.kind === "node" ? getState().drawer!.id : null;
    if (node) {
      const qz = await get<any>(`/api/nodes/${node}/quiz`);
      set({ passed: qz.passed, tier: qz.tier, quizzes: qz.quizzes });
    }
    // 答题会触发服务端 refreshBuildingStatus；刷新副本数据但不关抽屉
    await getState().refreshWorldData();
  },

  async acceptEdge(id) {
    await send(`/api/edges/${id}/accept`, "POST");
    if (getState().world) await getState().openWorld(getState().world!.id);
    getState().showToast("已接受关联，虚线 → 正式关系");
  },

  async startChallenge(id) {
    set({ challenge: null });
    try {
      const c = await send<any>(`/api/buildings/${id}/challenge`, "POST");
      set({
        challenge: c,
        buildings: getState().buildings.map((b) =>
          b.id === id && c.status ? { ...b, status: c.status } : b,
        ),
      });
    } catch (e: any) {
      set({ challenge: { error: e.message ?? "副本尚未解锁" } });
    }
  },

  async submitFlow(id, order) {
    const r = await send<any>(`/api/buildings/${id}/submit`, "POST", { order });
    set({
      buildings: getState().buildings.map((b) => (b.id === id ? { ...b, status: r.status } : b)),
    });
    getState().showToast(r.correct ? "通关！流程副本已保存" : "顺序不对，再试一次");
    if (r.correct) getState().openBuilding(id);
  },

  async submitDomain(id, answers) {
    const r = await send<any>(`/api/buildings/${id}/submit`, "POST", { answers });
    set({
      buildings: getState().buildings.map((b) => (b.id === id ? { ...b, status: r.status } : b)),
    });
    getState().showToast(r.correct ? `通过（${r.score}）` : `未通过（${r.score}）`);
    getState().openBuilding(id);
  },
});

export type { BuildingRow, DirectionRow, EdgeRow, NodeRow, Passed, Quiz };
