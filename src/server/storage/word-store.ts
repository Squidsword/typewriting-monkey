import { db } from "./firebase";
import type { WordHit } from "../core/word-detector";
import { Timestamp } from "firebase-admin/firestore";

const WORDS_COLLECTION = "words";
const WORD_BATCH_SIZE = 16; // Batch words for efficient writes

interface WordDocument {
  start: number;
  len: number;
  word: string;
  timestamp: Timestamp;
}

export class WordStore {
  private pendingWords: WordHit[] = [];
  private flushTimer?: NodeJS.Timeout;
  private lastPersistedPosition = 0;

  /**
   * Load all persisted words from Firestore
   * Returns sorted array of word hits
   */
  async loadWords(): Promise<WordHit[]> {
    const snapshot = await db
      .collection(WORDS_COLLECTION)
      .orderBy("start", "asc")
      .get();

    const words = snapshot.docs.map(doc => {
      const data = doc.data() as WordDocument;
      return {
        start: data.start,
        len: data.len,
        word: data.word
      };
    });

    // Track the position of the last word we've persisted
    if (words.length > 0) {
      const lastWord = words[words.length - 1];
      this.lastPersistedPosition = lastWord.start + lastWord.len;
    }

    return words;
  }

  /**
   * Add a newly detected word
   * Batches writes for efficiency
   */
  async addWord(hit: WordHit): Promise<void> {
    this.pendingWords.push(hit);

    // Update our tracking of the last position
    const endPosition = hit.start + hit.len;
    if (endPosition > this.lastPersistedPosition) {
      this.lastPersistedPosition = endPosition;
    }

    // If we have enough words, flush immediately
    if (this.pendingWords.length >= WORD_BATCH_SIZE) {
      await this.flush();
    } else {
      // Otherwise, set a timer to flush soon
      this.scheduleFlush();
    }
  }

  /**
   * Schedule a flush operation in 5 seconds
   * Resets any existing timer
   */
  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flush().catch(console.error);
    }, 5000);
  }

  /**
   * Write all pending words to Firestore
   */
  async flush(): Promise<void> {
    if (this.pendingWords.length === 0) return;

    const batch = db.batch();
    const now = Timestamp.now();

    for (const word of this.pendingWords) {
      // Use position as document ID for easy deduplication
      const docId = `word_${word.start}_${word.len}`;
      const ref = db.collection(WORDS_COLLECTION).doc(docId);
      
      batch.set(ref, {
        start: word.start,
        len: word.len,
        word: word.word,
        timestamp: now
      } as WordDocument);
    }

    await batch.commit();
    this.pendingWords = [];

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  /**
   * Get the position up to which words have been persisted
   */
  getLastPersistedPosition(): number {
    return this.lastPersistedPosition;
  }

  /**
   * Clean up resources
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    await this.flush();
  }
}