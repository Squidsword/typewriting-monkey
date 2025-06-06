/**
 * Browser-side entry point (v2) with comprehensive logging
 * - Live characters via Socket.IO   → event: "char"
 * - Historical slices via GET /v1/chars
 * - Word hits via "word"
 * - Stats (users / speed) via polling /v1/stats
 */

import io from 'socket.io-client';
import './styles.css';
import { 
  logger, 
  socketLogger, 
  renderLogger, 
  statsLogger, 
  chunkLogger,
  logError,
  logPerformance 
} from './utils/logger';

// ---------------------------------------------------------------------------
// Types mirrored from server DTOs
// ---------------------------------------------------------------------------
interface CharEvt   { index: number; ch: string }
interface WordHit   { start: number; len: number; word?: string }
interface StatsJSON { users: number; charsPerMinute: number }

// ---------------------------------------------------------------------------
// Tunables — must match server values
// ---------------------------------------------------------------------------
const CHUNK = 8_192;
const STATS_POLL_MS = 5_000;

logger.info({
  chunk_size: CHUNK,
  stats_poll_interval: STATS_POLL_MS,
  environment: import.meta.env.MODE,
}, 'Typewriting Monkey client starting');

// ---------------------------------------------------------------------------
// DOM handles
// ---------------------------------------------------------------------------
const out = document.getElementById('output') as HTMLPreElement;
const stats = (() => {
  let el = document.getElementById('stats') as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = 'stats';
    el.style.margin = '0 0 .5rem';
    document.body.insertBefore(el, out);
    logger.debug('Created stats element');
  }
  return el;
})();

// ---------------------------------------------------------------------------
// Client-side caches
// ---------------------------------------------------------------------------
const chunks: Record<number, string> = {};
const hits: WordHit[] = [];
let cursor = 0;
let initialized = false;

// Performance monitoring
let renderCount = 0;
let lastRenderTime = 0;
let charCount = 0;
let lastCharCountLog = Date.now();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const getChunk = async (id: number) => {
  if (chunks[id] !== undefined) {
    chunkLogger.trace({ chunkId: id }, 'Chunk cache hit');
    return;
  }
  
  const startTime = performance.now();
  const start = id * CHUNK;
  
  try {
    chunkLogger.debug({ chunkId: id, start, len: CHUNK }, 'Fetching chunk');
    const r = await fetch(`/v1/chars?start=${start}&len=${CHUNK}`);
    
    if (r.ok) {
      chunks[id] = await r.text();
      logPerformance(chunkLogger, 'chunk-fetch', startTime, {
        chunkId: id,
        size: chunks[id].length,
      });
    } else {
      chunkLogger.error({
        chunkId: id,
        status: r.status,
        statusText: r.statusText,
      }, 'Failed to fetch chunk');
    }
  } catch (error) {
    logError(chunkLogger, error, { chunkId: id });
  }
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
  if (!initialized) {
    renderLogger.trace('Skipping render - not initialized');
    return;
  }
  
  const startTime = performance.now();
  renderCount++;
  
  const t = fullText();
  const visible = nonOverlappingHits(hits.filter(h => h.start < t.length));

  let html = '';
  let ptr = 0;
  visible.forEach(h => {
    html += t.slice(ptr, h.start);
    html += `<span class="word len${h.len}">${t.slice(h.start, h.start + h.len)}</span>`;
    ptr = h.start + h.len;
  });
  html += t.slice(ptr);
  out.innerHTML = html;
  
  const renderTime = performance.now() - startTime;
  
  // Log performance warnings
  if (renderTime > 16.67) { // More than one frame at 60fps
    renderLogger.warn({
      renderTime: renderTime.toFixed(2),
      textLength: t.length,
      visibleWords: visible.length,
      renderCount,
    }, 'Slow render detected');
  }
  
  // Log render stats every 10 seconds
  if (Date.now() - lastRenderTime > 10_000) {
    renderLogger.info({
      renderCount,
      avgRenderTime: (renderTime / renderCount).toFixed(2),
      textLength: t.length,
      wordCount: hits.length,
      visibleWords: visible.length,
      chunks: Object.keys(chunks).length,
    }, 'Render statistics');
    lastRenderTime = Date.now();
  }
};

// ---------------------------------------------------------------------------
// Stats polling
// ---------------------------------------------------------------------------
const updateStats = (s: StatsJSON) => {
  statsLogger.debug({ users: s.users, cpm: s.charsPerMinute }, 'Stats updated');
  stats.textContent = `${s.users} online · ${s.charsPerMinute} cpm`;
};

const pollStats = async () => {
  try {
    const startTime = performance.now();
    const r = await fetch('/v1/stats');
    
    if (r.ok) {
      const data = await r.json();
      updateStats(data);
      
      statsLogger.trace({
        fetchTime: (performance.now() - startTime).toFixed(2),
      }, 'Stats fetch completed');
    } else {
      statsLogger.warn({
        status: r.status,
        statusText: r.statusText,
      }, 'Stats fetch failed');
    }
  } catch (error) {
    logError(statsLogger, error, { context: 'stats-poll' });
  } finally {
    setTimeout(pollStats, STATS_POLL_MS);
  }
};

// ---------------------------------------------------------------------------
// Live wiring
// ---------------------------------------------------------------------------
(async () => {
  logger.info('Initializing WebSocket connection and data loading');
  pollStats();

  const sock = io({
    path: '/ws',
    transports: ['websocket']
  });

  // Socket event handlers
  sock.on('connect', () => {
    socketLogger.info({
      socketId: sock.id,
      connected: sock.connected,
    }, 'WebSocket connected');
  });

  sock.on('connect_error', (error: any) => {
    logError(socketLogger, error, { context: 'connection' });
  });

  sock.on('disconnect', (reason: any) => {
    socketLogger.warn({ reason }, 'WebSocket disconnected');
  });

  // Store initial words until ready
  let pendingInitWords: WordHit[] | null = null;

  /* Initial back-fill ----------------------------------------------- */
  sock.on('cursor', async (c: number) => {
    const startTime = performance.now();
    cursor = c;
    const last = Math.floor(cursor / CHUNK);
    
    socketLogger.info({
      cursor,
      lastChunk: last,
      totalChunks: last + 1,
    }, 'Received cursor position');
    
    // Load all chunks
    const chunkPromises: Promise<void>[] = [];
    for (let id = 0; id <= last; id++) {
      chunkPromises.push(getChunk(id));
    }
    await Promise.all(chunkPromises);
    
    // Mark as initialized
    initialized = true;
    
    // Process any pending initial words
    if (pendingInitWords) {
      hits.push(...pendingInitWords);
      socketLogger.debug({
        wordCount: pendingInitWords.length,
      }, 'Processing pending initial words');
      pendingInitWords = null;
    }
    
    logPerformance(logger, 'initial-load', startTime, {
      cursor,
      chunks: last + 1,
      words: hits.length,
    });
    
    // Now safe to render
    render();
  });

  sock.on('init-words', (initial: WordHit[]) => {
    socketLogger.info({
      wordCount: initial.length,
      initialized,
    }, 'Received initial words');
    
    if (initialized) {
      hits.push(...initial);
      render();
    } else {
      pendingInitWords = initial;
    }
  });

  /* New word hits ---------------------------------------------------- */
  sock.on('word', (hit: WordHit) => {
    socketLogger.debug({
      word: hit.word,
      start: hit.start,
      len: hit.len,
    }, 'New word detected');
    
    hits.push(hit);
    if (initialized) render();
  });

  /* Live characters -------------------------------------------------- */
  sock.on('char', ({ index, ch }: CharEvt) => {
    charCount++;
    const id = Math.floor(index / CHUNK);
    const offset = index % CHUNK;

    if (chunks[id] === undefined) chunks[id] = '';

    if (chunks[id].length === offset) {
      chunks[id] += ch;
    } else if (chunks[id].length < offset) {
      // Gap detected - need resync
      socketLogger.warn({
        chunkId: id,
        expectedOffset: chunks[id].length,
        actualOffset: offset,
        gap: offset - chunks[id].length,
      }, 'Character gap detected, resyncing chunk');
      
      fetch(`/v1/chars?start=${id * CHUNK}&len=${CHUNK}`)
        .then(r => r.text())
        .then(txt => { 
          chunks[id] = txt;
          socketLogger.info({ chunkId: id }, 'Chunk resync completed');
          if (initialized) render();
        })
        .catch(error => logError(socketLogger, error, { chunkId: id, context: 'resync' }));
      return;
    }
    cursor = index + 1;
    if (initialized) render();
    
    // Log character statistics every 10 seconds
    if (Date.now() - lastCharCountLog > 10_000) {
      socketLogger.info({
        totalChars: charCount,
        charsPerSecond: (charCount / 10).toFixed(2),
        cursor,
        chunks: Object.keys(chunks).length,
      }, 'Character reception statistics');
      charCount = 0;
      lastCharCountLog = Date.now();
    }
  });
  
  logger.info('Client initialization complete');
})();