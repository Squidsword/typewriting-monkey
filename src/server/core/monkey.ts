import { EventEmitter } from "events";
import * as prand from "pure-rand";
import type { ChunkStore } from "../storage/chunk-store";

export interface MonkeyTick { index: number; ch: string; }

/**
 * Deterministic pseudo‑random a‑z generator writing straight into a ChunkStore.
 * Injection of the store decouples generation from persistence.
 */
export class Monkey extends EventEmitter {
  private rng = prand.xoroshiro128plus(0x6C656F);
  private readonly store: ChunkStore;

  constructor(store: ChunkStore, startPosition: number = 0) {
    super();
    this.store = store;
    
    // Fast-forward the RNG to match the current position
    // This ensures we continue generating from where we left off
    this.advanceRngToPosition(startPosition);
  }
  
 /**
   * Advance the RNG state to match the given position.
   * This is crucial for maintaining deterministic behavior across restarts.
   */
  private advanceRngToPosition(position: number): void {
    this.rng = prand.skipN(this.rng, position);
  }

  /** Generate and persist one character, emitting an async Tick event. */
  async next(): Promise<MonkeyTick> {
    const [letter, nextRng] = prand.uniformIntDistribution(0, 25, this.rng);
    this.rng = nextRng;
    const ch = String.fromCharCode(97 + letter);
    const idx = await this.store.append(ch);
    const tick = { index: idx, ch } as const;
    this.emit("tick", tick);
    return tick;
  }
}