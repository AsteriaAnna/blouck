import { create } from "zustand";
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
} from "./api";

type Drawer = { kind: "node" | "building" | "edge"; id: string } | null;

export type Ghost = {
  name: string;
  role?: string;
  action: string;
  label?: string;
  predicate?: string;
  confidence?: number;
  pairVerdict?: string;
};

export type StreamStage = "idle" | "listening" | "detecting" | "confirming" | "generating" | "done";

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

type State = {
  view: "home" | "world";
  worlds: World[];
  world: World | null;
  nodes: NodeRow[];
  edges: EdgeRow[];
  buildings: BuildingRow[];
  directions: DirectionRow[];
  focusId: string | null;
  drawer: Drawer;
  quizzes: Quiz[];
  passed: Passed;
  tier: number;
  quizStatus: string;
  challenge: any | null;
  partial: string;
  streamText: string;
  mentions: string[];
  ghosts: Ghost[];
  spawnGhosts: Ghost[];
  stage: StreamStage;
  newNodeIds: string[];
  toast: string;
  busy: boolean;

  loadWorlds: () => Promise<void>;
  createWorld: (name: string, root: string) => Promise<void>;
  openWorld: (id: string) => Promise<void>;
  backHome: () => Promise<void>;
  openNode: (id: string) => Promise<void>;
  openBuilding: (id: string) => Promise<void>;
  openEdge: (id: string) => void;
  closeDrawer: () => void;
  extract: (text: string, exploreEdgeId?: string) => Promise<void>;
  /** 沿方向线落图：直接创建方向生成时计划好的延伸节点 */
  exploreDirection: (edgeId: string) => Promise<void>;
  ingestSegment: (text: string) => Promise<void>;
  commitStream: () => Promise<void>;
  saveMd: (id: string, md: string) => Promise<void>;
  generateQuiz: (id: string) => Promise<void>;
  answerQuiz: (id: string, answer: string) => Promise<void>;
  acceptEdge: (id: string) => Promise<void>;
  startChallenge: (id: string) => Promise<void>;
  submitFlow: (id: string, order: string[]) => Promise<void>;
  submitDomain: (id: string, answers: { id: string; answer: string }[]) => Promise<void>;
  setPartial: (text: string) => void;
  setStreamText: (text: string) => void;
  setMentions: (ids: string[]) => void;
  setGhosts: (ghosts: Ghost[]) => void;
  setStage: (stage: StreamStage) => void;
  clearStream: () => void;
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
  directions: [],
  focusId: null,
  drawer: null,
  quizzes: [],
  passed: { short: 0, judge: 0 },
  tier: 0,
  quizStatus: "idle",
  challenge: null,
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

  setFocus: (id) => set({ focusId: id }),

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
      getState().showToast(
        n ? `已落图 ${n} 个新节点 · ${p.provider === "mock" ? "mock 抽取" : "DeepSeek 抽取"}` : "这段没有可落图的新实体",
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
      set({
        nodes: r.nodes,
        edges: r.edges,
        busy: false,
        stage: "done",
      });
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

  setPartial: (text) => set({ partial: text, streamText: text }),
  setStreamText: (text) => set({ streamText: text }),
  setMentions: (ids) => set({ mentions: ids }),
  setGhosts: (ghosts) => set({ ghosts }),
  setStage: (stage) => set({ stage }),
  clearStream: () => set({ partial: "", streamText: "", mentions: [], ghosts: [], spawnGhosts: [], newNodeIds: [], stage: "idle" }),
}));
