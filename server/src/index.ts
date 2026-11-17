import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { env, providers } from "./env.js";
import { seedDemoIfEmpty } from "./db.js";
import { mockASR } from "./providers/mock.js";
import { asr, llm } from "./providers/active.js";
import { streamRouter } from "./routes/stream.js";
import { nodesRouter } from "./routes/nodes.js";
import { edgesRouter } from "./routes/edges.js";
import { worldsRouter } from "./routes/worlds.js";
import { devRouter } from "./routes/dev.js";
import { buildingsRouter } from "./routes/buildings.js";
import { worldAdminRouter } from "./routes/worldAdmin.js";
import { graphRouter } from "./routes/graph.js";
import { docsRouter } from "./routes/docs.js";
import { candidatesRouter } from "./routes/candidates.js";
import { practiceRouter } from "./routes/practice.js";
import { eventsRouter } from "./routes/events.js";
import { startGenerationWorker } from "./services/generationWorker.js";

seedDemoIfEmpty();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api/worlds", streamRouter);
app.use(nodesRouter);
app.use(edgesRouter);
app.use(worldsRouter);
app.use(devRouter);
app.use(buildingsRouter);
app.use(worldAdminRouter);
app.use(graphRouter);
app.use(docsRouter);
app.use(candidatesRouter);
app.use(practiceRouter);
app.use(eventsRouter);
startGenerationWorker(llm);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    providers: { ...providers, llmActive: llm.name, asrActive: asr.name },
    hint: "未配置 key 时使用 mock；配置 DEEPSEEK_API_KEY / DOUBAO_ASR_* 后自动切换",
  });
});

const server = createServer(app);

/* ---------------- 实时语音（豆包流式预留位） ---------------- */
const wss = new WebSocketServer({ server, path: "/ws/asr" });
wss.on("connection", (ws: WebSocket) => {
  let session: ReturnType<typeof asr.open> | null = null;
  ws.on("message", (data) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "start" || msg.type === "mock") {
      const provider = msg.type === "mock" ? mockASR : asr;
      session = provider.open({
        onPartial: (text) => ws.send(JSON.stringify({ type: "partial", text })),
        onSegment: (text) => ws.send(JSON.stringify({ type: "segment", text })),
        onFinal: (text) => {
          ws.send(JSON.stringify({ type: "final", text }));
          session = null;
        },
        onError: (message) => ws.send(JSON.stringify({ type: "error", message })),
      }, {
        hotwords: Array.isArray(msg.hotwords) ? msg.hotwords.map(String) : [],
        context: Array.isArray(msg.context) ? msg.context.map(String) : [],
      });
      ws.send(JSON.stringify({ type: "ready", provider: provider.name }));
    } else if (msg.type === "stop") {
      session?.end();
    } else if (msg.type === "audio" && msg.chunk) {
      session?.push(Buffer.from(msg.chunk, "base64"));
    }
  });
  ws.on("close", () => session?.end());
});

server.listen(env.port, () => {
  console.log(`[blouck] server http://localhost:${env.port}  llm=${llm.name} asr=${asr.name}`);
});
