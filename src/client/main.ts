/**
 * Browser-side entry point.
 * - Opens a Socket.IO connection to receive live characters + word hits
 * - Fetches missing historical chunks on demand via `/chars`
 * - Renders the ever-growing text, highlighting discovered words
 */

import io from 'socket.io-client';
import './styles.css';

// ---------------------------------------------------------------------------
// Type helpers mirroring server events
// ---------------------------------------------------------------------------
interface MonkeyEvt { index: number; ch: string }
interface WordHit   { start: number; len: number }

// Tunables — must match server values ---------------------------------------
const CHUNK = 8192;

// Client-side cache ----------------------------------------------------------
const chunks: Record<number, string> = {}; // chunkId → text
const hits:   WordHit[] = [];             // all word hits seen so far
let   cursor  = 0;                        // next global char index

const out = document.getElementById('output') as HTMLPreElement;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Lazy-load a chunk only once. */
const getChunk = async (id: number) => {
  if (chunks[id] !== undefined) return;

  const r = await fetch(`/chars?start=${id * CHUNK}&len=${CHUNK}`);
  if (r.ok) chunks[id] = await r.text();
};

/** Concatenate cached chunks up to (but not including) `cursor`. */
const fullText = (): string => {
  const lastChunk = Math.floor(cursor / CHUNK);

  let result = '';
  for (let i = 0; i <= lastChunk; i++) {
    const data = chunks[i] ?? '';
    result += i === lastChunk ? data.slice(0, cursor % CHUNK) : data;
  }
  return result;
};

/**
 * Deduplicate overlapping WordHits (prefer longer ones when nested).
 * Returns a list sorted by ascending `start`.
 */
const nonOverlappingHits = (raw: WordHit[]): WordHit[] => {
  const sorted = [...raw].sort((a, b) => a.start - b.start || b.len - a.len);
  const output: WordHit[] = [];

  sorted.forEach(hit => {
    const last = output.at(-1);
    if (!last || hit.start >= last.start + last.len) output.push(hit);
  });
  return output;
};

/** Render the current text + word highlights into the <pre>. */
const render = () => {
  const t = fullText();
  const visibleWords = nonOverlappingHits(hits.filter(h => h.start < t.length));

  let html = '';
  let ptr  = 0;

  visibleWords.forEach(h => {
    html += t.slice(ptr, h.start);                        // plain segment
    html += `<span class="word len${h.len}">${t.slice(    // highlighted word
             h.start, h.start + h.len)}</span>`;
    ptr = h.start + h.len;
  });
  html += t.slice(ptr);                                   // tail segment
  out.innerHTML = html;
};

// ---------------------------------------------------------------------------
// Live wiring
// ---------------------------------------------------------------------------
(async () => {
  const sock = io();

  /* Grab previously typed characters */
  sock.on('cursor', async (c: number) => {
    cursor = c;
    const last = Math.floor(cursor / CHUNK);
    for (let id = 0; id <= last; id++) await getChunk(id);

    render();
  });

  /* Grab previously detected characters */
  sock.on('init-words', (initial: WordHit[]) => {
    hits.push(...initial);
    render();
  });

  /* Grab and store new word hits {location, length} from server */
  sock.on('word', (hit: WordHit) => {
    hits.push(hit);
    render();
  });

  /* Register freshly typed character */
  sock.on('monkey-type', async ({ index, ch }: MonkeyEvt) => {
    const id  = Math.floor(index / CHUNK);
    await getChunk(id);

    chunks[id] += ch // Append character to most recent chunk
    cursor = index + 1;

    render();
  });
})();
