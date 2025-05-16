/**
 * Extremely simple append-only chunk store.
 * The monkey writes sequentially, and readers can request arbitrary slices.
 */

export const CHUNK = 8_192;                 // 8 KiB per chunk

/** id → text (may be shorter than CHUNK if we haven’t filled the file yet). */
const chunks = new Map<number, string>();

/** Append raw text to the given chunk id. */
export const append = (id: number, data: string): void => {
  const existing = chunks.get(id) ?? '';
  chunks.set(id, existing + data);
};

/**
 * Random-access read across as many chunks as necessary.
 * Always returns exactly `len` characters (or fewer if we haven’t generated
 * that far yet).
 */
export const read = (start: number, len: number): string => {
  const first = Math.floor(start / CHUNK);
  const last  = Math.floor((start + len - 1) / CHUNK);

  let buffer = '';
  for (let id = first; id <= last; id++) buffer += chunks.get(id) ?? '';

  const offset = start - first * CHUNK;
  return buffer.slice(offset, offset + len);
};

