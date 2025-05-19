/** Fixed chunk size for every backing store (8 KiB).  */
export const CHUNK_SIZE = 8_192;

export interface ChunkStore {
  /** Absolute index of the *next* character to be written. */
  readonly cursor: number;

  /**
   * Append a single character at the current cursor position.
   * Returns the *written* index (≡ cursor before the call).
   */
  append(ch: string): number;

  /**
   * Read an arbitrary slice `[start, start+len)`.
   * Should always succeed (return empty string when beyond cursor).
   */
  read(start: number, len: number): string;

  /** Number of chunks currently held (useful for metrics). */
  chunkCount(): number;
}

/**
 * In‑memory append‑only implementation. Good for unit tests / low‑traffic demos.
 * Swap with a file, Redis, or Firestore store without touching server logic.
 */
export class MemoryChunkStore implements ChunkStore {
  private readonly chunks = new Map<number, string>();
  private _cursor = 0;
  get cursor() { return this._cursor; }

  append(ch: string): number {
    const idx = this._cursor++;
    const id  = Math.floor(idx / CHUNK_SIZE);
    const buf = this.chunks.get(id) ?? "";
    this.chunks.set(id, buf + ch);
    return idx;
  }

  read(start: number, len: number): string {
    if (len <= 0) return "";
    const first = Math.floor(start / CHUNK_SIZE);
    const last  = Math.floor((start + len - 1) / CHUNK_SIZE);

    let data = "";
    for (let id = first; id <= last; id++) data += this.chunks.get(id) ?? "";

    const offset = start - first * CHUNK_SIZE;
    return data.slice(offset, offset + len);
  }

  chunkCount() { return this.chunks.size; }
}