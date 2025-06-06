// ===========================================================================
//  src/server/app.ts   (HTTP + WS façade with comprehensive logging)
// ===========================================================================

import express from "express";
import helmet from "helmet";
import compression from "compression";
import { createServer } from "node:http";
import { Server as IOServer, Socket } from "socket.io";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pinoHttp from "pino-http";

import { CHUNK_SIZE } from "./storage/chunk-store";
import { FirestoreChunkStore } from "./storage/firestore-chunk-store";
import { Monkey } from "./core/monkey";
import { WordDetector } from "./core/word-detector";
import { DICTIONARY_SIZE } from "./core/word-detector";
import { WordStore } from "./storage/word-store";
import { StartupScanner } from "./core/startup-scanner";
import { 
  logger, 
  httpLogger, 
  wsLogger, 
  startupLogger,
  logError,
  logPerformance
} from "./utils/logger";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ────────────────  Runtime config (ENV‑driven)  ───────────────────────────
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 5500);
const REST_ROOT = "/v1";
const WS_PATH = "/ws";
const TEST_MODE = process.env.TEST_MODE !== "false";

startupLogger.info({
  HTTP_PORT,
  REST_ROOT,
  WS_PATH,
  TEST_MODE,
  NODE_ENV: process.env.NODE_ENV,
}, 'Starting Typewriting Monkey server');

// ────────────────  Instantiate domain objects  ────────────────────────────
const startTime = Date.now();

try {
  const store = await FirestoreChunkStore.create();
  startupLogger.info({ cursor: store.cursor, chunks: store.chunkCount() }, 'Chunk store initialized');

  const monkey = new Monkey(store, store.cursor);
  const detector = new WordDetector();
  const wordStore = new WordStore();

  // Load persisted words on startup
  const hits = await wordStore.loadWords();
  startupLogger.info({ wordCount: hits.length }, 'Loaded persisted words');

  // Initialize the WordDetector with context from existing text
  const initializeDetector = async () => {
    const cursor = store.cursor;
    if (cursor > 0) {
      const contextStart = Math.max(0, cursor - 20);
      const contextLen = cursor - contextStart;
      
      if (contextLen > 0) {
        startupLogger.debug({
          contextStart,
          contextLen,
          cursor
        }, 'Initializing WordDetector with context');
        
        const context = await store.readSlice(contextStart, contextLen);
        
        for (let i = 0; i < context.length; i++) {
          detector.push(context[i], contextStart + i);
        }
      }
    }
  };

  await initializeDetector();

  // Scan for any missing words since last persistence
  const scanner = new StartupScanner(store);
  const lastPosition = wordStore.getLastPersistedPosition();
  const scanStartTime = Date.now();
  const missingWords = await scanner.scanMissingWords(lastPosition);
  
  if (missingWords.length > 0) {
    startupLogger.warn({
      missingWordCount: missingWords.length,
      lastPersistedPosition: lastPosition,
      currentCursor: store.cursor,
    }, 'Found missing words during startup scan');
    
    hits.push(...missingWords);
    
    for (const word of missingWords) {
      await wordStore.addWord(word);
    }
    await wordStore.flush();
  }
  
  logPerformance(startupLogger, 'startup-scan', scanStartTime, {
    missingWords: missingWords.length
  });

  // Link generator → detector → broadcast
  monkey.on("tick", ({ index, ch }) => detector.push(ch, index));
  detector.on("word", hit => { 
    hits.push(hit);
    io.emit("word", hit);
    wordStore.addWord(hit).catch(err => logError(wsLogger, err, { context: 'word-store-add' }));
  });

  // ────────────────  Online‑user tracking  ──────────────────────────────────
  const sockets = new Set<Socket>();
  let mockExtra = 0;

  const onlineUsers = () => sockets.size + mockExtra + 250;
  const charsPerMinute = () => onlineUsers() * 5;
  const charsPerSecond = () => charsPerMinute() / 60;

  if (TEST_MODE) {
    setInterval(() => { 
      mockExtra = Math.floor(Math.random() * 21);
    }, 1_000);
  }

  // ────────────────  Express / REST  ────────────────────────────────────────
  const app = express();
  const http = createServer(app);

  // HTTP request logging with reduced verbosity
  app.use(pinoHttp({
    logger: httpLogger,
    autoLogging: {
      // Ignore high-frequency endpoints
      ignore: (req) => {
        const ignorePaths = ['/v1/stats', '/v1/chars'];
        return ignorePaths.some(path => req.url?.startsWith(path));
      },
    },
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 400 && res.statusCode < 500) return 'warn';
      if (res.statusCode >= 500 || err) return 'error';
      // Log other requests at debug level instead of info
      return 'debug';
    },
    // Simplify request/response serialization
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
  }));

  app
    .use(helmet())
    .use(compression())
    .use(express.static(path.join(__dirname, "../public")));

  const router = express.Router();

  // Health / metrics
  router.get("/status", (_req, res) => {
    const status = {
      cursor: store.cursor,
      chunks: store.chunkCount(),
      dictionarySize: DICTIONARY_SIZE,
      users: onlineUsers(),
      charsPerMinute: charsPerMinute(),
      uptimeSec: Math.floor(process.uptime()),
    };
    
    httpLogger.debug({ status }, 'Status request');
    res.json(status);
  });

  // Random‑access chars
  router.get("/chars", async (req, res) => {
    const start = Number(req.query.start);
    const len = Number(req.query.len);
    
    if (!Number.isFinite(start) || !Number.isFinite(len) || start < 0 || len <= 0 || len > CHUNK_SIZE * 16) {
      httpLogger.warn({ start, len }, 'Invalid char range requested');
      res.status(400).json({ error: "Invalid range" });
      return;
    }
    
    try {
      const text = await store.readSlice(start, len);
      res.type("text/plain").send(text);
    } catch (error) {
      logError(httpLogger, error, { start, len });
      res.status(500).json({ error: "Failed to read slice" });
    }
  });

  // Lightweight stats endpoint
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
    pingTimeout: 20_000
  });

  io.on("connection", socket => {
    sockets.add(socket);
    
    wsLogger.info({
      socketId: socket.id,
      totalSockets: sockets.size,
      remoteAddress: socket.handshake.address,
    }, 'Socket connected');

    // initial sync
    socket.emit("cursor", store.cursor);
    socket.emit("init-words", hits);

    socket.on("disconnect", (reason) => {
      sockets.delete(socket);
      wsLogger.info({
        socketId: socket.id,
        totalSockets: sockets.size,
        reason,
      }, 'Socket disconnected');
    });
  });

  // Character generation loop
  const STEP_MS = 1000 / 60;
  let carry = 0;
  let totalCharsGenerated = 0;
  let lastMetricsLog = Date.now();
  
  setInterval(async () => {
    const cps = charsPerSecond();
    carry += cps * (STEP_MS / 1000);
    const emitCnt = Math.floor(carry);
    carry -= emitCnt;

    try {
      for (let i = 0; i < emitCnt; i++) {
        const tick = await monkey.next();
        io.emit("char", tick);
        totalCharsGenerated++;
      }

      // Log metrics every 10 seconds
      if (Date.now() - lastMetricsLog > 10_000) {
        logger.info({
          users: onlineUsers(),
          cps: cps.toFixed(2),
          totalChars: totalCharsGenerated,
          cursor: store.cursor,
          words: hits.length,
          sockets: sockets.size,
        }, 'System metrics');
        lastMetricsLog = Date.now();
      }
    } catch (error) {
      logError(logger, error, { context: 'char-generation' });
    }
  }, STEP_MS);

  // ────────────────  Startup  ───────────────────────────────────────────────
  http.listen(HTTP_PORT, () => {
    logPerformance(startupLogger, 'server-startup', startTime);
    startupLogger.info({
      port: HTTP_PORT,
      wsPath: WS_PATH,
      restRoot: REST_ROOT,
      testMode: TEST_MODE,
    }, `🚀 Server listening on port ${HTTP_PORT}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    
    try {
      await wordStore.close();
      await store.close();
      logger.info('Cleanup completed successfully');
      process.exit(0);
    } catch (error) {
      logError(logger, error, { context: 'shutdown' });
      process.exit(1);
    }
  });

} catch (error) {
  logError(startupLogger, error, { context: 'startup-failure' });
  process.exit(1);
}