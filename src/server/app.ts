// ===========================================================================
//  src/server/index.ts   (HTTP + WS façade)
// ===========================================================================

import express from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import { createServer } from "node:http";
import { Server as IOServer, Socket } from "socket.io";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";


import { CHUNK_SIZE } from "./storage/chunk-store";
import { MemoryChunkStore } from "./storage/memory-chunk-store";
import { FirestoreChunkStore } from "./storage/firestore-chunk-store";
import { Monkey }           from "./core/monkey";
import { WordDetector }     from "./core/word-detector";
import { DICTIONARY_SIZE }  from "./core/word-detector";
import { WordStore } from "./storage/word-store";
import { StartupScanner } from "./core/startup-scanner";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ────────────────  Runtime config (ENV‑driven)  ───────────────────────────
const HTTP_PORT   = Number(process.env.HTTP_PORT ?? 5500);
const REST_ROOT   = "/v1";      // versioned REST namespace
const WS_PATH     = "/ws";      // Socket.IO path
const TEST_MODE   = process.env.TEST_MODE !== "false"; // default «on» in dev

// ────────────────  Instantiate domain objects  ────────────────────────────
const store     = await FirestoreChunkStore.create();
const monkey    = new Monkey(store, store.cursor);
const detector  = new WordDetector();
const wordStore = new WordStore();

// Load persisted words on startup
const hits = await wordStore.loadWords();
console.log(`Loaded ${hits.length} persisted words`);

// Scan for any missing words since last persistence
const scanner = new StartupScanner(store);
const lastPosition = wordStore.getLastPersistedPosition();
const missingWords = await scanner.scanMissingWords(lastPosition);

if (missingWords.length > 0) {
  console.log(`Found ${missingWords.length} missing words during startup scan`);
  hits.push(...missingWords);
  
  // Persist the missing words
  for (const word of missingWords) {
    await wordStore.addWord(word);
  }
  await wordStore.flush();
}

// Link generator → detector → broadcast
monkey.on("tick", ({ index, ch }) => detector.push(ch, index));
detector.on("word", hit => { 
  hits.push(hit); 
  io.emit("word", hit); 
  wordStore.addWord(hit).catch(console.error);
});

// ────────────────  Online‑user tracking  ──────────────────────────────────
const sockets = new Set<Socket>();       // real connected clients
let mockExtra = 0;                       // fluctuating fake users for tests

/** Compute live online users (real + mock) */
const onlineUsers = () => sockets.size + mockExtra + 250;

/** Typing speed = onlineUsers × 5 cpm → chars per second (CPS). */
const charsPerMinute = () => onlineUsers() * 5;
const charsPerSecond = () => charsPerMinute() / 60;

// When TEST_MODE, jitter mockExtra every 10 s between 0…20 users.
if (TEST_MODE) {
  setInterval(() => { mockExtra = Math.floor(Math.random() * 21); }, 1_000);
}

// ────────────────  Express / REST  ────────────────────────────────────────
const app  = express();
const http = createServer(app);

app
  .use(helmet())
  .use(compression())
  .use(cors())
  .use(express.static(path.join(__dirname, "../public")));

const router = express.Router();

// Health / metrics
router.get("/status", (_req, res) => {
  res.json({
    cursor: store.cursor,
    chunks: store.chunkCount(),
    dictionarySize: DICTIONARY_SIZE,
    users: onlineUsers(),
    charsPerMinute: charsPerMinute(),
    uptimeSec: Math.floor(process.uptime()),
  });
});

// Random‑access chars
router.get("/chars", async (req, res) => {
  const start = Number(req.query.start);
  const len   = Number(req.query.len);
  if (!Number.isFinite(start) || !Number.isFinite(len) || start < 0 || len <= 0 || len > CHUNK_SIZE * 16) {
    res.status(400).json({ error: "Invalid range" });
    return;
  } 
  res.type("text/plain").send(await store.readSlice(start, len));
});

// Lightweight stats endpoint for clients (users + speed) -------------------
router.get("/stats", (_req, res) => {
  res.json({
    users: onlineUsers(),
    charsPerMinute: charsPerMinute(),
  });
});

app.use(REST_ROOT, router);

// ────────────────  WebSocket layer  ───────────────────────────────────────
const io = new IOServer(http, {
  path: WS_PATH,
  cors: { origin: "*" },
  serveClient: false,
  pingInterval: 25_000,
  pingTimeout : 20_000
});

io.on("connection", socket => {
  sockets.add(socket);

  // initial sync
  socket.emit("cursor", store.cursor);
  socket.emit("init-words", hits);

  socket.on("disconnect", () => sockets.delete(socket));
});

const STEP_MS = 1000 / 60;
let carry = 0;
setInterval(async () => {
  const cps = charsPerSecond();              // may be fractional
  carry += cps * (STEP_MS / 1000);
  const emitCnt = Math.floor(carry);
  carry -= emitCnt;

  for (let i = 0; i < emitCnt; i++) {
    const tick = await monkey.next();
    io.emit("char", tick);
  }
}, STEP_MS);

// ────────────────  Startup  ───────────────────────────────────────────────
http.listen(HTTP_PORT, () => {
  console.log(`🚀  HTTP ${HTTP_PORT}  WS path \"${WS_PATH}\"  REST root ${REST_ROOT}`);
  if (TEST_MODE) console.log("🔧  TEST_MODE enabled: mock users fluctuating 0–20");
});

process.on('SIGTERM', async () => {
  await wordStore.close();
  await store.close();
  process.exit(0);
});
