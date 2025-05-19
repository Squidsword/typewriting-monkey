import { EventEmitter } from "events";
import seedrandom from "seedrandom";
import type { ChunkStore } from "./chunk-store";

export interface MonkeyTick { index: number; ch: string; }

/**
 * Deterministic pseudo‑random a‑z generator writing straight into a ChunkStore.
 * Injection of the store decouples generation from persistence.
 */
export class Monkey extends EventEmitter {
  private readonly rng = seedrandom("lunaleo"); // reproducible seed
  private readonly store: ChunkStore;

  constructor(store: ChunkStore) {
    super();
    this.store = store;
  }

  /** Generate and persist one character, emitting a Tick event. */
  next(): MonkeyTick {
    const ch  = String.fromCharCode(97 + Math.floor(this.rng() * 26));
    const idx = this.store.append(ch);
    const tick = { index: idx, ch } as const;
    this.emit("tick", tick);
    return tick;
  }
}
