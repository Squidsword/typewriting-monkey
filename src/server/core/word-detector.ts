import fs from "fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "events";

export interface WordHit { start: number; len: number; word: string; }

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIN_LEN = 3;
const DICT_FILE = path.join(__dirname, "../../data/words.txt");
const WORDS = new Set(
  fs.readFileSync(DICT_FILE, "utf8")
    .split(/\r?\n/)
    .filter(w => w.length >= MIN_LEN)
);
const MAX_LEN = 12;

export const DICTIONARY_SIZE = WORDS.size;

/** 
 * Emits a WordHit when a valid English word ends at the current character.
 * The caller is responsible for providing absolute positions.
 */
export class WordDetector extends EventEmitter {
  private window = ""; // sliding buffer ≤ MAX_LEN

  /**
   * Process a character at the given absolute position
   * @param ch The character to process
   * @param absolutePosition The absolute position of this character in the stream
   */
  push(ch: string, absolutePosition: number) { 
    this.window += ch;
    if (this.window.length > MAX_LEN) this.window = this.window.slice(1);

    // scan longest → shortest to avoid nested duplicates
    for (let n = Math.min(MAX_LEN, this.window.length); n >= MIN_LEN; n--) {
      const w = this.window.slice(-n);
      if (WORDS.has(w)) {
        this.emit("word", { 
          start: absolutePosition - n + 1, 
          len: n, 
          word: w 
        } as WordHit);
        break;
      }
    }
  }
}