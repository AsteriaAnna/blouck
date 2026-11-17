import type {
  BuildingRow,
  DirectionRow,
  EdgeRow,
  NodeRow,
  Passed,
  Quiz,
  World,
} from "../api";

export type Drawer = { kind: "node" | "building" | "edge"; id: string } | null;

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

export type State = {
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
  /** 渐进披露：默认只显示提示 top2/方向少量；展开后显示全部关系 */
  mapExpand: boolean;
  toggleMapExpand: () => void;
  /** 镜头远近：拉近自动多显示一些线索 */
  mapZoom: "far" | "near";
  setMapZoom: (zoom: "far" | "near") => void;
  /** CameraFit 后的相机-目标距离，用于区分“缩放”与“旋转” */
  mapBaseDistance: number;
  setMapBaseDistance: (distance: number) => void;
  /** 自增触发 CameraFit 重新框住全景 */
  mapFitToken: number;
  fitMapView: () => void;

  loadWorlds: () => Promise<void>;
  createWorld: (name: string, root: string) => Promise<void>;
  openWorld: (id: string) => Promise<void>;
  backHome: () => Promise<void>;
  openNode: (id: string) => Promise<void>;
  openBuilding: (id: string) => Promise<void>;
  openEdge: (id: string) => void;
  closeDrawer: () => void;
  refreshWorldData: () => Promise<void>;
  extract: (text: string, exploreEdgeId?: string) => Promise<void>;
  /** 沿方向线落图：直接创建方向生成时计划好的延伸节点 */
  exploreDirection: (edgeId: string) => Promise<void>;
  /** 沿节点卡里的方向计划落图（不要求地图上已 materialize） */
  explorePlanDirection: (directionId: string) => Promise<void>;
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
