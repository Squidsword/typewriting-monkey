/**
 * Browser-side entry point (v2)
 * - Live characters via Socket.IO   → event: "char"
 * - Historical slices via GET /v1/chars
 * - Word hits via "word"
 * - Stats (users / speed) via polling /v1/stats
 */

import io from 'socket.io-client';
import './styles.css';

// ---------------------------------------------------------------------------
// Types mirrored from server DTOs
// ---------------------------------------------------------------------------
interface CharEvt   { index: number; ch: string }
interface WordHit   { start: number; len: number }
interface StatsJSON { users: number; charsPerMinute: number }

// ---------------------------------------------------------------------------
// Tunables — must match server values
// ---------------------------------------------------------------------------
const CHUNK = 8_192;
const STATS_POLL_MS = 5_000;

// ---------------------------------------------------------------------------
// DOM handles
// ---------------------------------------------------------------------------
const out   = document.getElementById('output') as HTMLPreElement;
const stats = (() => {
  let el = document.getElementById('stats') as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = 'stats';
    el.style.margin = '0 0 .5rem';
    document.body.insertBefore(el, out);
  }
  return el;
})();

// ---------------------------------------------------------------------------
// Client-side caches
// ---------------------------------------------------------------------------
const chunks: Record<number, string> = {}; // chunkId → text
const hits:   WordHit[] = [];
let   cursor  = 0;                          // index of *next* char

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const getChunk = async (id: number) => {
  if (chunks[id] !== undefined) return;
  const r = await fetch(`/v1/chars?start=${id * CHUNK}&len=${CHUNK}`);
  if (r.ok) chunks[id] = await r.text();
};

const fullText = (): string => {
  const last = Math.floor(cursor / CHUNK);
  let text = '';
  for (let i = 0; i <= last; i++) {
    const data = chunks[i] ?? '';
    text += i === last ? data.slice(0, cursor % CHUNK) : data;
  }
  return text;
};

const nonOverlappingHits = (raw: WordHit[]) => {
  const sorted = [...raw].sort((a, b) => a.start - b.start || b.len - a.len);
  const res: WordHit[] = [];
  sorted.forEach(h => {
    const prev = res.at(-1);
    if (!prev || h.start >= prev.start + prev.len) res.push(h);
  });
  return res;
};

const render = () => {
  const t = fullText();
  const visible = nonOverlappingHits(hits.filter(h => h.start < t.length));

  let html = '';
  let ptr  = 0;
  visible.forEach(h => {
    html += t.slice(ptr, h.start);
    html += `<span class="word len${h.len}">${t.slice(h.start, h.start + h.len)}</span>`;
    ptr = h.start + h.len;
  });
  html += t.slice(ptr);
  out.innerHTML = html;
};

// ---------------------------------------------------------------------------
// Stats polling
// ---------------------------------------------------------------------------
const updateStats = (s: StatsJSON) => {
  stats.textContent = `${s.users} online · ${s.charsPerMinute} cpm`;
};

const pollStats = async () => {
  try {
    const r = await fetch('/v1/stats');
    if (r.ok) updateStats(await r.json());
  } finally {
    setTimeout(pollStats, STATS_POLL_MS);
  }
};

// ---------------------------------------------------------------------------
// Live wiring
// ---------------------------------------------------------------------------
(async () => {
  pollStats();

  const sock = io({
    path: '/ws',              // ← new WS path
    transports: ['websocket']
  });

  /* Initial back-fill ----------------------------------------------- */
  sock.on('cursor', async (c: number) => {
    cursor = c;
    const last = Math.floor(cursor / CHUNK);
    for (let id = 0; id <= last; id++) await getChunk(id);
    render();
  });

  sock.on('init-words', (initial: WordHit[]) => {
    hits.push(...initial);
    render();
  });

  /* New word hits ---------------------------------------------------- */
  sock.on('word', (hit: WordHit) => {
    hits.push(hit);
    render();
  });

  /* Live characters -------------------------------------------------- */
  sock.on('char', ({ index, ch }: CharEvt) => {
    const id     = Math.floor(index / CHUNK);
    const offset = index % CHUNK;

    if (chunks[id] === undefined) chunks[id] = '';

    if (chunks[id].length === offset) {
      chunks[id] += ch;
    } else if (chunks[id].length < offset) {
      // gap → resync
      fetch(`/v1/chars?start=${id * CHUNK}&len=${CHUNK}`)
        .then(r => r.text())
        .then(txt => { chunks[id] = txt; render(); });
      return;
    }
    cursor = index + 1;
    render();
  });
})();