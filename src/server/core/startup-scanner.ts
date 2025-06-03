import type { ChunkStore } from "../storage/chunk-store";
import { WordDetector } from "./word-detector";
import type { WordHit } from "./word-detector";

export class StartupScanner {
    private store: ChunkStore;

    constructor(store: ChunkStore) {
        this.store = store;
    }

    async scanMissingWords(lastPersistedPosition: number): Promise<WordHit[]> {
        const currentCursor = this.store.cursor;
        
        if (lastPersistedPosition >= currentCursor) {
            return [];
        }

        console.log(`Scanning for missing words from ${lastPersistedPosition} to ${currentCursor}`);

        const scanner = new WordDetector();
        const foundWords: WordHit[] = [];

        scanner.on("word", (hit: WordHit) => {
            // No position adjustment needed! The detector already has correct positions
            if (hit.start >= lastPersistedPosition) {
                foundWords.push(hit);
            }
        });

        // Start a bit earlier for context, but track absolute position
        const startPosition = Math.max(0, lastPersistedPosition - 20);
        let absolutePosition = startPosition;

        const SCAN_CHUNK_SIZE = 8192;
        let readPosition = startPosition;

        while (readPosition < currentCursor) {
            const len = Math.min(SCAN_CHUNK_SIZE, currentCursor - readPosition);
            const text = await this.store.readSlice(readPosition, len);
            
            // Feed each character with its absolute position
            for (const ch of text) {
                scanner.push(ch, absolutePosition);
                absolutePosition++;
            }
            
            readPosition += len;
        }

        return foundWords;
    }
} 