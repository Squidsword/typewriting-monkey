/**
 *  Fixed chunk size for every backing store (8 KiB).
 *  All stores:
 *    • keep exactly ONE “hot” in-memory buffer for the current chunk
 *    • only write a chunk to the DB when it is FULL (8192 B)
 */
export const CHUNK_SIZE = 8_192;

/**
 *  cursor()        – next absolute char index to be written
 *  append(ch)      – push ONE char into the hot buffer
 *  flush()         – force-write the buffer if it’s full (auto-called)
 *  readSlice(s,l)  – arbitrary slice, like Array.slice()
 *  readChunk(id)   – entire chunk (finished OR current hot one)
 *  chunkCount()    – finished chunks + (hot buffer ? 1 : 0)
 */
export interface ChunkStore {
  readonly cursor: number;
  append(ch: string): Promise<number>;              // returns written index
  flush(): Promise<void>;

  readSlice(start: number, len: number): Promise<string>;
  readChunk(chunkId: number): Promise<string>;

  chunkCount(): number;
}
 