import fs from "fs";
import path from "path";
import { EventEmitter } from "events";

export interface WordHit { start: number; len: number; word: string; }

const MIN_LEN = 3;
const DICT_FILE = path.join(__dirname, "../../data/words.txt");
const WORDS = new Set(
  fs.readFileSync(DICT_FILE, "utf8")
    .split(/\r?\n/)
    .filter(w => w.length >= MIN_LEN)
);
const MAX_LEN = Math.max(...[...WORDS].map(w => w.length));

export const DICTIONARY_SIZE = WORDS.size;

/** Emits a WordHit when a valid English word ends at the current cursor. */
export class WordDetector extends EventEmitter {
  private window = ""; // sliding buffer ≤ MAX_LEN
  private cursor = 0;   // index of *next* char

  push(ch: string) { 
    this.window += ch;
    if (this.window.length > MAX_LEN) this.window = this.window.slice(1);

    // scan longest → shortest to avoid nested duplicates
    for (let n = Math.min(MAX_LEN, this.window.length); n >= MIN_LEN; n--) {
      const w = this.window.slice(-n);
      if (WORDS.has(w)) {
        this.emit("word", { start: this.cursor - n + 1, len: n, word: w } as WordHit);
        break;
      }
    }
    this.cursor++;
  }
}