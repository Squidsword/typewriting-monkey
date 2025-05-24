import { CHUNK_SIZE, type ChunkStore } from "./chunk-store";

/**
 *  Pure in-memory store — perfect for unit tests or low-traffic demos.
 *  Persistence-free, so everything is synchronous except the interface
 *  (kept async so callers don’t care which store they talk to).
 */
export class MemoryChunkStore implements ChunkStore {
  /** Finished, immutable chunks → text */
  private readonly chunks = new Map<number, string>();

  /** Current buffer (may be < CHUNK_SIZE) */
  private hot = "";
  private hotId = 0;          // numerical id of the hot chunk

  private _cursor = 0;
  get cursor() { return this._cursor; }

  /* ────────────────────────────────────────────────────────── */

  async append(ch: string): Promise<number> {
    const idx = this._cursor++;      // index that THIS char occupies
    this.hot += ch;

    // When the buffer fills up → freeze it and start a new hot buffer.
    if (this.hot.length === CHUNK_SIZE) await this.flush();
    return idx;
  }

  async flush(): Promise<void> {
    if (this.hot.length !== CHUNK_SIZE) return;        // not full → noop
    this.chunks.set(this.hotId, this.hot);             // persist to Map
    this.hotId += 1;                                   // next chunk id
    this.hot = "";                                     // clear buffer
  }

  /* ── Public read helpers ────────────────────────────────── */

  /** Return the ENTIRE chunk `id` (even if it’s still “hot”). */
  async readChunk(id: number): Promise<string> {
    if (id === this.hotId) return this.hot;            // current buffer
    return this.chunks.get(id) ?? "";                  // finished chunk
  }

  /** Return an arbitrary slice `[start, start+len)` */
  async readSlice(start: number, len: number): Promise<string> {
    if (len <= 0) return "";

    const first = Math.floor(start / CHUNK_SIZE);
    const last  = Math.floor((start + len - 1) / CHUNK_SIZE);

    // accumulate all touched chunks into one string
    let blob = "";
    for (let id = first; id <= last; id++) {
      blob += await this.readChunk(id);
    }

    const offset = start - first * CHUNK_SIZE;
    return blob.slice(offset, offset + len);
  }

  chunkCount() { return this.hotId + (this.hot.length ? 1 : 0); }
}
