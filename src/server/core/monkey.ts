import { EventEmitter } from "events";
import * as prand from "pure-rand";
import type { ChunkStore } from "./chunk-store";

export interface MonkeyTick { index: number; ch: string; }

/**
 * Deterministic pseudo‑random a‑z generator writing straight into a ChunkStore.
 * Injection of the store decouples generation from persistence.
 */
export class Monkey extends EventEmitter {
  private rng = prand.xoroshiro128plus(0x6C656F);
  private readonly store: ChunkStore;

  constructor(store: ChunkStore) {
    super();
    this.store = store;
  }

  /** Generate and persist one character, emitting a Tick event. */
  next(): MonkeyTick {
    const [letter, nextRng] = prand.uniformIntDistribution(0, 25, this.rng);
    this.rng = nextRng;
    const ch = String.fromCharCode(97 + letter);
    const idx = this.store.append(ch);
    const tick = { index: idx, ch } as const;
    this.emit("tick", tick);
    return tick;
  }
}
