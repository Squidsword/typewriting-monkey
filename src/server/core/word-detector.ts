import fs from "fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "events";
import { detectorLogger as logger } from "../utils/logger";

export interface WordHit { start: number; len: number; word: string; }

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIN_LEN = 3;
const DICT_FILE = path.join(__dirname, "../../data/words.txt");

logger.info({ dictFile: DICT_FILE }, 'Loading dictionary');
const startLoad = Date.now();

const WORDS = new Set(
  fs.readFileSync(DICT_FILE, "utf8")
    .split(/\r?\n/)
    .filter(w => w.length >= MIN_LEN)
);
const MAX_LEN = 12;

export const DICTIONARY_SIZE = WORDS.size;

logger.info({
  dictionarySize: DICTIONARY_SIZE,
  minLength: MIN_LEN,
  maxLength: MAX_LEN,
  loadTime: Date.now() - startLoad,
}, 'Dictionary loaded');

/** 
 * Emits a WordHit when a valid English word ends at the current character.
 * The caller is responsible for providing absolute positions.
 */
export class WordDetector extends EventEmitter {
  private window = ""; // sliding buffer ≤ MAX_LEN
  private processedChars = 0;
  private detectedWords = 0;
  private lastLogTime = Date.now();

  constructor() {
    super();
    logger.debug('WordDetector initialized');
  }

  /**
   * Process a character at the given absolute position
   * @param ch The character to process
   * @param absolutePosition The absolute position of this character in the stream
   */
  push(ch: string, absolutePosition: number) { 
    this.window += ch;
    if (this.window.length > MAX_LEN) this.window = this.window.slice(1);
    
    this.processedChars++;
    
    logger.trace({
      char: ch,
      position: absolutePosition,
      windowLength: this.window.length,
    }, 'Processing character');

    // scan longest → shortest to avoid nested duplicates
    for (let n = Math.min(MAX_LEN, this.window.length); n >= MIN_LEN; n--) {
      const w = this.window.slice(-n);
      if (WORDS.has(w)) {
        const hit: WordHit = { 
          start: absolutePosition - n + 1, 
          len: n, 
          word: w 
        };
        
        this.emit("word", hit);
        this.detectedWords++;
        
        logger.info({
          word: w,
          start: hit.start,
          len: n,
          totalDetected: this.detectedWords,
        }, 'Word detected');
        
        break;
      }
    }
    
    // Log statistics every 60 seconds
    if (Date.now() - this.lastLogTime > 60_000) {
      logger.info({
        processedChars: this.processedChars,
        detectedWords: this.detectedWords,
        detectionRate: ((this.detectedWords / this.processedChars) * 100).toFixed(2) + '%',
      }, 'Detection statistics');
      
      this.processedChars = 0;
      this.detectedWords = 0;
      this.lastLogTime = Date.now();
    }
  }
}