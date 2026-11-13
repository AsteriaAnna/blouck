import { create } from "zustand";
import {
  get,
  send,
  type BuildingRow,
  type EdgeRow,
  type NodeRow,
  type Passed,
  type Quiz,
  type World,
  type WorldPayload,
} from "./api";

type Drawer = { kind: "node" | "building"; id: string } | null;

type State = {
  view: "home" | "world";
  worlds: World[];
  world: World | null;
  nodes: NodeRow[];
  edges: EdgeRow[];
  buildings: BuildingRow[];
  focusId: string | null;
  drawer: Drawer;
  quizzes: Quiz[];
  passed: Passed;
  tier: number;
  quizStatus: string;
  challenge: any | null;
  partial: string;
  toast: string;
  busy: boolean;

  loadWorlds: () => Promise<void>;
  createWorld: (name: string, root: string) => Promise<void>;
  openWorld: (id: string) => Promise<void>;
  backHome: () => Promise<void>;
  openNode: (id: string) => Promise<void>;
  openBuilding: (id: string) => Promise<void>;
  closeDrawer: () => void;
  extract: (text: string) => Promise<void>;
  saveMd: (id: string, md: string) => Promise<void>;
  generateQuiz: (id: string) => Promise<void>;
  answerQuiz: (id: string, answer: string) => Promise<void>;
  acceptEdge: (id: string) => Promise<void>;
  startChallenge: (id: string) => Promise<void>;
  submitFlow: (id: string, order: string[]) => Promise<void>;
  submitDomain: (id: string, answers: { id: string; answer: string }[]) => Promise<void>;
  setPartial: (text: string) => void;
  showToast: (text: string) => void;
  setFocus: (id: string) => void;
};

export const useStore = create<State>((set, getState) => ({
  view: "home",
  worlds: [],
  world: null,
  nodes: [],
  edges: [],
  buildings: [],
  focusId: null,
  drawer: null,
  quizzes: [],
  passed: { short: 0, judge: 0 },
  tier: 0,
  quizStatus: "idle",
  challenge: null,
  partial: "",
  toast: "",
  busy: false,

  showToast: (text) => {
    set({ toast: text });
    window.setTimeout(() => set({ toast: "" }), 2600);
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
      focusId: p.world.root_node_id,
      drawer: null,
      challenge: null,
    });
  },

  async backHome() {
    history.replaceState(null, "", "#");
    set({ view: "home", world: null, drawer: null, challenge: null });
    await getState().loadWorlds();
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

  setFocus: (id) => set({ focusId: id }),

  async extract(text) {
    if (!getState().world) return;
    set({ busy: true });
    try {
      const p = await send<any>(`/api/worlds/${getState().world!.id}/extract`, "POST", {
        text,
        fromNodeId: getState().focusId,
      });
      set({
        nodes: p.nodes,
        edges: p.edges,
        buildings: p.buildings,
        busy: false,
      });
      const n = p.createdNodes?.length ?? 0;
      getState().showToast(
        n ? `已落图 ${n} 个新节点 · ${p.provider === "mock" ? "mock 抽取" : "DeepSeek 抽取"}` : "已记录，没有新实体",
      );
    } catch (e: any) {
      set({ busy: false });
      getState().showToast(e.message ?? "抽取失败");
    }
  },

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
      set({
        passed: qz.passed,
        tier: qz.tier,
        quizzes: qz.quizzes,
      });
    }
  },

  async acceptEdge(id) {
    await send(`/api/edges/${id}/accept`, "POST");
    set({
      edges: getState().edges.map((e) => (e.id === id ? { ...e, kind: "formal" } : e)),
    });
    getState().showToast("已接受关联，虚线 → 正式关系");
  },

  async startChallenge(id) {
    set({ challenge: null });
    try {
      const c = await send<any>(`/api/buildings/${id}/challenge`, "POST");
      set({ challenge: c });
    } catch (e: any) {
      set({ challenge: { error: e.message ?? "副本尚未解锁" } });
    }
  },

  async submitFlow(id, order) {
    const r = await send<any>(`/api/buildings/${id}/submit`, "POST", { order });
    set({
      buildings: getState().buildings.map((b) =>
        b.id === id ? { ...b, status: r.status } : b,
      ),
    });
    getState().showToast(r.correct ? "通关！流程副本已保存" : "顺序不对，再试一次");
    if (r.correct) getState().openBuilding(id);
  },

  async submitDomain(id, answers) {
    const r = await send<any>(`/api/buildings/${id}/submit`, "POST", { answers });
    set({
      buildings: getState().buildings.map((b) =>
        b.id === id ? { ...b, status: r.status } : b,
      ),
    });
    getState().showToast(r.correct ? `通过（${r.score}）` : `未通过（${r.score}）`);
    getState().openBuilding(id);
  },

  setPartial: (text) => set({ partial: text }),
}));
