import { db } from "./firebase";
import { CHUNK_SIZE, type ChunkStore } from "./chunk-store";

/* ────────────────────────────────────────────────────────────── */
/*  Firestore collection layout                                   */
/*    chunks/                                                     */
/*      ├─ chunk_0         { text: "..." }                        */
/*      ├─ chunk_1         { text: "..." }                        */
/*      └─ …                                                      */
/*    meta/                                                       */
/*      ├─ cursor          { index: 0 }                           */
/*  Only COMPLETED chunks are stored; the hot buffer lives in RAM */
/* ────────────────────────────────────────────────────────────── */

const CHUNKS = "chunks";
const META = "meta";
const CURSOR = "cursor";
/** How often (ms) to persist the cursor to Firestore. */
const CURSOR_UPDATE_INTERVAL = 5_000; // 5 s

/** Tiny (256‑entry) LRU cache so repeated reads stay local & fast. */
class LRUCache {
  private map = new Map<number, string>();
  private max;
  constructor(max: number = 256) {this.max = max}

  get(id: number) {
    return this.map.get(id);
  }

  set(id: number, text: string) {
    if (this.map.has(id)) this.map.delete(id); // bump to front
    this.map.set(id, text);

    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as number;
      this.map.delete(oldest);
    }
  }
}

/* ────────────────────────────────────────────────────────────── */

export class FirestoreChunkStore implements ChunkStore {
  /** Currently building chunk (lives only in RAM). */
  private hot = "";
  private hotId = 0;
  private _cursor = 0;

  /** finished‑chunk cache */
  private cache = new LRUCache();

  /** Whether the in‑memory cursor differs from Firestore. */
  private cursorDirty = false;
  private readonly cursorTimer: NodeJS.Timeout;

  get cursor() {
    return this._cursor;
  }

  /* ---------- factory: make sure we know where we left off ----- */
  constructor() {
    // Kick off a background timer that flushes the cursor at a
    // fixed cadence instead of on every single character.
    this.cursorTimer = setInterval(() => {
      // Fire‑and‑forget – any error is logged but doesn’t kill the loop.
      this.flushCursor().catch(console.error);
    }, CURSOR_UPDATE_INTERVAL);
  }

  static async create(): Promise<FirestoreChunkStore> {
    const self = new FirestoreChunkStore();

    const snap = await db.collection(META).doc(CURSOR).get();
    self._cursor = snap.exists ? (snap.data()!.index as number) : 0;
    self.hotId = Math.floor(self._cursor / CHUNK_SIZE);

    return self;
  }

  /* ---------- writes ------------------------------------------ */

  /** Append a single character and return its global index. */
  async append(ch: string): Promise<number> {
    const idx = this._cursor++;
    this.hot += ch;

    // Mark the cursor as dirty; the background timer will persist it.
    this.cursorDirty = true;

    if (this.hot.length === CHUNK_SIZE) await this.flush();
    return idx;
  }

  /** Persist the current cursor **only** if it changed. */
  private async flushCursor(): Promise<void> {
    if (!this.cursorDirty) return; // nothing to do

    await db
      .collection(META)
      .doc(CURSOR)
      .set({ index: this._cursor }, { merge: true });

    this.cursorDirty = false;
  }

  /** Flush when a chunk fills up – this writes both chunk & cursor. */
  async flush(): Promise<void> {
    if (this.hot.length !== CHUNK_SIZE) return; // still building

    const id = this.hotId;
    const ref = db.collection(CHUNKS).doc(`chunk_${id}`);
    const cur = db.collection(META).doc(CURSOR);

    const batch = db.batch();
    batch.set(ref, { text: this.hot });
    batch.set(cur, { index: this._cursor }, { merge: true });

    await batch.commit();

    // After a successful commit the cursor is now in‑sync.
    this.cursorDirty = false;
    this.cache.set(id, this.hot); // warm cache for recent chunk

    this.hotId += 1;
    this.hot = "";
  }

  /* ---------- reads ------------------------------------------- */

  /** Get the FULL text of chunk `id` (awaits Firestore on cache miss). */
  async readChunk(id: number): Promise<string> {
    if (id === this.hotId) return this.hot; // hot buffer

    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;

    // Not cached → fetch from Firestore (≈ 20 reads/s free quota)
    const snap = await db.collection(CHUNKS).doc(`chunk_${id}`).get();
    const text = snap.exists ? (snap.data()!.text as string) : "";
    this.cache.set(id, text);
    return text;
  }

  /** Arbitrary slice. Max 17 chunks because len ≤ 8 KiB × 16. */
  async readSlice(start: number, len: number): Promise<string> {
    if (len <= 0) return "";

    const first = Math.floor(start / CHUNK_SIZE);
    const last = Math.floor((start + len - 1) / CHUNK_SIZE);

    let blob = "";
    for (let id = first; id <= last; id++) {
      blob += await this.readChunk(id);
    }

    const offset = start - first * CHUNK_SIZE;
    return blob.slice(offset, offset + len);
  }

  chunkCount() {
    return this.hotId + (this.hot.length ? 1 : 0);
  }

  /* ---------- cleanup ----------------------------------------- */

  /** Optional – call when your process exits to avoid dangling timers. */
  async close(): Promise<void> {
    clearInterval(this.cursorTimer);
    await this.flushCursor(); // persist any last‑minute updates
  }
}
