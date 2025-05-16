/**
 * Sliding-window detector that emits a “word” event whenever a valid English
 * word (length ≥ 3) ends at the current cursor position.
 *
 * 1. Load dictionary from ../data/words.txt at startup.
 * 2. Keep a moving buffer of up to MAX_LEN recent chars.
 * 3. On every push(), scan from longest→shortest prospective word; emit once.
 */

import fs           from 'fs';
import path         from 'path';
import { EventEmitter } from 'events';

// ----------------------------------------------------------------------------
// Dictionary setup
// ----------------------------------------------------------------------------
const MIN_LEN = 3;
const WORDS_FILE = path.join(__dirname, '../data/words.txt');

const WORDS = new Set(
  fs.readFileSync(WORDS_FILE, 'utf8')
    .split(/\r?\n/)
    .filter(w => w.length >= MIN_LEN)
);

const MAX_LEN = 12;

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
export interface WordHit { start: number; len: number }

// ----------------------------------------------------------------------------
// Detector
// ----------------------------------------------------------------------------
export class WordDetector extends EventEmitter {
  private window = '';  // sliding buffer (≤ MAX_LEN)
  private cursor = 0;   // index *after* the most recently pushed char

  /**
   * Feed a single character into the detector.
   * Returns the cursor *before* the push (mirrors original behaviour).
   */
  push(ch: string): number {
    this.window += ch;
    if (this.window.length > MAX_LEN) this.window = this.window.slice(1);

    this.scanForWord();
    return this.cursor++;
  }

  /** Scan the current buffer for the *longest* valid word that ends here. */
  private scanForWord(): void {
    for (let n = Math.min(MAX_LEN, this.window.length); n >= MIN_LEN; n--) {
      const candidate = this.window.slice(-n);
      if (WORDS.has(candidate)) {
        this.emit('word', { start: this.cursor - n + 1, len: n } as WordHit);
        break; // emit only the longest match
      }
    }
  }
}
