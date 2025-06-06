import { EventEmitter } from "events";
import * as prand from "pure-rand";
import type { ChunkStore } from "../storage/chunk-store";
import { monkeyLogger as logger } from "../utils/logger";

export interface MonkeyTick { index: number; ch: string; }

/**
 * Deterministic pseudo‑random a‑z generator writing straight into a ChunkStore.
 * Injection of the store decouples generation from persistence.
 */
export class Monkey extends EventEmitter {
  private rng = prand.xoroshiro128plus(0x6C656F);
  private readonly store: ChunkStore;
  private generatedCount = 0;
  private lastLogTime = Date.now();

  constructor(store: ChunkStore, startPosition: number = 0) {
    super();
    this.store = store;
    
    logger.info({
      startPosition,
      seed: '0x6C656F',
    }, 'Initializing Monkey generator');
    
    // Fast-forward the RNG to match the current position
    this.advanceRngToPosition(startPosition);
  }
  
  /**
   * Advance the RNG state to match the given position.
   * This is crucial for maintaining deterministic behavior across restarts.
   */
  private advanceRngToPosition(position: number): void {
    if (position > 0) {
      const startTime = Date.now();
      logger.debug({ position }, 'Advancing RNG to position');
      
      this.rng = prand.skipN(this.rng, position);
      
      logger.info({
        position,
        duration: Date.now() - startTime,
      }, 'RNG advanced to position');
    }
  }

  /** Generate and persist one character, emitting an async Tick event. */
  async next(): Promise<MonkeyTick> {
    const [letter, nextRng] = prand.uniformIntDistribution(0, 25, this.rng);
    this.rng = nextRng;
    const ch = String.fromCharCode(97 + letter);
    
    try {
      const idx = await this.store.append(ch);
      const tick = { index: idx, ch } as const;
      this.emit("tick", tick);
      
      this.generatedCount++;
      
      // Log generation statistics every 60 seconds
      if (Date.now() - this.lastLogTime > 60_000) {
        logger.info({
          totalGenerated: this.generatedCount,
          rate: (this.generatedCount / 60).toFixed(2),
          currentIndex: idx,
        }, 'Generation statistics');
        this.generatedCount = 0;
        this.lastLogTime = Date.now();
      }
      
      logger.trace({ index: idx, char: ch }, 'Character generated');
      
      return tick;
    } catch (error) {
      logger.error({
        error,
        char: ch,
      }, 'Failed to generate character');
      throw error;
    }
  }
}