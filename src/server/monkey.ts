/**
 * Pseudo-random “monkey” that types a-z characters forever.
 * Persists the output in memory in CHUNK-sized entries via `chunk-store.ts`.
 */

import seedrandom          from 'seedrandom';
import { CHUNK, append }   from './chunk-store';

export class Monkey {
  /** Fixed seed so multiple runs produce the same stream. */
  private rng = seedrandom('lunaleo');

  /** Global cursor: absolute index of the *next* character to type. */
  private _cursor = 0;
  get cursor() { return this._cursor; }

  /** Generate the next character */
  next(): { index: number; ch: string } {
    const ch  = String.fromCharCode(97 + Math.floor(this.rng() * 26)); // 'a'…'z'
    const idx = this._cursor++;
    
    /** Assign character to proper CHUNK **/
    append(Math.floor(idx / CHUNK), ch); 

    /** Return streamed character information */
    return { index: idx, ch };
  }

}
