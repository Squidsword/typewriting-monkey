// src/word-detector.ts
import fs from "fs"
import path from "path"
import { EventEmitter } from "events"

const MIN_LEN  = 3
const WORDS    = new Set(
  fs.readFileSync(path.join(__dirname, "data/words.txt"), "utf8")
    .split(/\r?\n/)
    .filter(w => w.length >= MIN_LEN)          // ignore short entries
)

const MAX_LEN  = Math.max(...Array.from(WORDS, w => w.length))

export interface WordHit { start:number; len:number }

export class WordDetector extends EventEmitter {
  private window = ""          // sliding buffer ≤ MAX_LEN
  private cursor = 0           // index of next char

  push(ch:string){
    this.window += ch
    if (this.window.length > MAX_LEN) this.window = this.window.slice(1)
    this.scan()
    return this.cursor++
  }

  /** emit longest word (≥ MIN_LEN) that ends at current cursor */
  private scan(){
    for (let n = Math.min(MAX_LEN, this.window.length); n >= MIN_LEN; n--){
      const slice = this.window.slice(-n)
      if (WORDS.has(slice)){
        this.emit("word",{start:this.cursor - n + 1, len:n} as WordHit)
        break
      }
    }
  }
}