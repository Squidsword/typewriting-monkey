import { db } from "./firebase";
import { CHUNK_SIZE, type ChunkStore } from "./chunk-store";
import { storeLogger as logger, logError, logPerformance } from "../utils/logger";

/* ────────────────────────────────────────────────────────────── */
/*  Firestore collection layout                                   */
/*    chunks/                                                     */
/*      ├─ chunk_0         { text: "..." }                        */
/*      ├─ chunk_1         { text: "..." }                        */
/*      └─ …                                                      */
/*    meta/                                                       */
/*      ├─ cursor          { index: 0 }                           */
/*    words/
/*      ├─ word_123_3      { start: 123, len:3, word: "cat", timestamp: ... }
/*      └─…
/*  Only COMPLETED chunks are stored; the hot buffer lives in RAM */
/* ────────────────────────────────────────────────────────────── */

const CHUNKS = "chunks";
const META = "meta";
const CURSOR = "cursor";
/** How often (ms) to persist the cursor to Firestore. */
const CURSOR_UPDATE_INTERVAL = 2_000;

/** Tiny (32‑entry) LRU cache so repeated reads stay local & fast. */
class LRUCache {
  private map = new Map<number, string>();
  private max;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(max: number = 32) {
    this.max = max;
    logger.debug({ maxSize: max }, 'LRU cache initialized');
  }

  get(id: number) {
    const text = this.map.get(id);
    if (text) {
      this.hits++;
      logger.trace({ chunkId: id, hits: this.hits }, 'Cache hit');
    } else {
      this.misses++;
      logger.trace({ chunkId: id, misses: this.misses }, 'Cache miss');
    }
    return text;
  }

  set(id: number, text: string) {
    if (this.map.has(id)) this.map.delete(id); // bump to front
    this.map.set(id, text);

    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as number;
      this.map.delete(oldest);
      this.evictions++;
      logger.debug({
        evictedId: oldest,
        totalEvictions: this.evictions,
        cacheSize: this.map.size,
      }, 'Cache eviction');
    }
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(2) + '%' : '0%',
      size: this.map.size,
    };
  }
}

/* ────────────────────────────────────────────────────────────── */

export class FirestoreChunkStore implements ChunkStore {
  /** Currently building chunk (lives only in RAM). */
  private workingChunk = "";
  private workingChunkId = 0;
  private _cursor = 0;

  /** finished‑chunk cache */
  private cache = new LRUCache();

  /** Whether the in‑memory cursor differs from Firestore. */
  private cursorDirty = false;
  private readonly cursorTimer: NodeJS.Timeout;
  
  /** Statistics tracking */
  private totalWrites = 0;
  private totalReads = 0;
  private lastStatsLog = Date.now();

  get cursor() {
    return this._cursor;
  }

  /* ---------- factory: make sure we know where we left off ----- */
  constructor() {
    // Kick off a background timer that flushes the cursor
    this.cursorTimer = setInterval(() => {
      this.flushCursor().catch(err => logError(logger, err, { context: 'cursor-flush' }));
    }, CURSOR_UPDATE_INTERVAL);
    
    logger.info({
      cursorUpdateInterval: CURSOR_UPDATE_INTERVAL,
      cacheSize: 32,
    }, 'FirestoreChunkStore constructed');
  }

  static async create(): Promise<FirestoreChunkStore> {
    const startTime = Date.now();
    const self = new FirestoreChunkStore();

    try {
      const snap = await db.collection(META).doc(CURSOR).get();
      self._cursor = snap.exists ? (snap.data()!.index as number) : 0;
      self.workingChunkId = Math.floor(self._cursor / CHUNK_SIZE);

      logger.info({
        cursor: self._cursor,
        workingChunkId: self.workingChunkId,
        cursorExists: snap.exists,
      }, 'Loaded cursor from Firestore');

      const wipChunk = await db
        .collection(CHUNKS)
        .doc(`chunk_${self.workingChunkId}`)
        .get();

      if (wipChunk.exists) {
        self.workingChunk = wipChunk.data()!.text as string;
        
        logger.info({
          workingChunkId: self.workingChunkId,
          workingChunkLength: self.workingChunk.length,
        }, 'Loaded working chunk');

        // If the chunk was already full we "roll forward"
        if (self.workingChunk.length === CHUNK_SIZE) {
          self.cache.set(self.workingChunkId, self.workingChunk);
          self.workingChunkId += 1;
          self.workingChunk = "";
          logger.debug('Working chunk was full, rolled forward');
        }
      }

      logPerformance(logger, 'firestore-init', startTime, {
        cursor: self._cursor,
        workingChunkId: self.workingChunkId,
      });

      return self;
    } catch (error) {
      logError(logger, error, { context: 'firestore-init' });
      throw error;
    }
  }

  /* ---------- writes ------------------------------------------ */

  /** Append a single character and return its global index. */
  async append(ch: string): Promise<number> {
    const idx = this._cursor++;
    this.workingChunk += ch;
    this.totalWrites++;

    // Mark the cursor as dirty
    this.cursorDirty = true;

    logger.trace({
      index: idx,
      char: ch,
      workingChunkLength: this.workingChunk.length,
    }, 'Character appended');

    if (this.workingChunk.length === CHUNK_SIZE) {
      await this.flush();
    }
    
    this.logStatsIfNeeded();
    return idx;
  }

  /** Persist the current cursor and working chunk */
  private async flushCursor(): Promise<void> {
    if (!this.cursorDirty) return;

    try {
      const batch = db.batch();

      const chunkRef = db
        .collection(CHUNKS)
        .doc(`chunk_${this.workingChunkId}`);

      batch.set(chunkRef, { text: this.workingChunk });

      const cursorRef = db
        .collection(META)
        .doc(CURSOR); 

      batch.set(cursorRef, { index: this._cursor });

      await batch.commit();

      this.cursorDirty = false;
      
    } catch (error) {
      logError(logger, error, { 
        context: 'cursor-flush',
        cursor: this._cursor,
        workingChunkId: this.workingChunkId,
      });
      throw error;
    }
  }

  /** Flush when a chunk fills up */
  async flush(): Promise<void> {
    if (this.workingChunk.length !== CHUNK_SIZE) return;

    const startTime = Date.now();
    const id = this.workingChunkId;
    
    try {
      logger.info({
        chunkId: id,
        size: this.workingChunk.length,
      }, 'Flushing full chunk');

      const ref = db.collection(CHUNKS).doc(`chunk_${id}`);
      const cur = db.collection(META).doc(CURSOR);

      const batch = db.batch();
      batch.set(ref, { text: this.workingChunk });
      batch.set(cur, { index: this._cursor }, { merge: true });

      await batch.commit();

      // After successful commit
      this.cursorDirty = false;
      this.cache.set(id, this.workingChunk);

      this.workingChunkId += 1;
      this.workingChunk = "";
      
      logPerformance(logger, 'chunk-flush', startTime, {
        chunkId: id,
      });
    } catch (error) {
      logError(logger, error, {
        context: 'chunk-flush',
        chunkId: id,
      });
      throw error;
    }
  }

  /* ---------- reads ------------------------------------------- */

  /** Get the FULL text of chunk `id` */
  async readChunk(id: number): Promise<string> {
    this.totalReads++;
    
    if (id === this.workingChunkId) {
      logger.trace({ chunkId: id }, 'Reading working chunk');
      return this.workingChunk;
    }

    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;

    // Not cached → fetch from Firestore
    const startTime = Date.now();
    try {
      logger.debug({ chunkId: id }, 'Fetching chunk from Firestore');
      
      const snap = await db.collection(CHUNKS).doc(`chunk_${id}`).get();
      const text = snap.exists ? (snap.data()!.text as string) : "";
      
      this.cache.set(id, text);
      
      logPerformance(logger, 'chunk-read', startTime, {
        chunkId: id,
        size: text.length,
        exists: snap.exists,
      });
      
      return text;
    } catch (error) {
      logError(logger, error, {
        context: 'chunk-read',
        chunkId: id,
      });
      throw error;
    }
  }

  /** Arbitrary slice */
  async readSlice(start: number, len: number): Promise<string> {
    if (len <= 0) return "";

    const first = Math.floor(start / CHUNK_SIZE);
    const last = Math.floor((start + len - 1) / CHUNK_SIZE);

    let blob = "";
    for (let id = first; id <= last; id++) {
      blob += await this.readChunk(id);
    }

    const offset = start - first * CHUNK_SIZE;
    const result = blob.slice(offset, offset + len);
    
    return result;
  }

  chunkCount() {
    return this.workingChunkId + (this.workingChunk.length ? 1 : 0);
  }

  /* ---------- Utilities --------------------------------------- */
  
  private logStatsIfNeeded() {
    if (Date.now() - this.lastStatsLog > 60_000) {
      logger.info({
        cursor: this._cursor,
        chunks: this.chunkCount(),
        workingChunkId: this.workingChunkId,
        workingChunkLength: this.workingChunk.length,
        totalWrites: this.totalWrites,
        totalReads: this.totalReads,
        cache: this.cache.getStats(),
      }, 'Store statistics');
      
      this.lastStatsLog = Date.now();
    }
  }

  /* ---------- Cleanup ----------------------------------------- */

  async close(): Promise<void> {
    logger.info('Closing FirestoreChunkStore');
    clearInterval(this.cursorTimer);
    await this.flushCursor();
    logger.info({
      finalCursor: this._cursor,
      finalChunks: this.chunkCount(),
    }, 'FirestoreChunkStore closed');
  }
}