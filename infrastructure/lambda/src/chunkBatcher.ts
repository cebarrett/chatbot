import { publishChunk } from './appsync';

/**
 * Batches token deltas and publishes them as larger chunks at a fixed interval.
 * This reduces the number of AppSync publishChunk mutations, avoiding
 * subscription message drops under high throughput.
 */
export class ChunkBatcher {
  private buffer = '';
  private sequence = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private publishQueue: Promise<void> = Promise.resolve();

  constructor(
    private requestId: string,
    private userId: string,
    private intervalMs = 100
  ) {}

  /** Buffer text content to be published in the next batch. */
  add(text: string): void {
    this.buffer += text;
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushBuffer();
      }, this.intervalMs);
    }
  }

  private flushBuffer(): void {
    if (!this.buffer) return;
    const text = this.buffer;
    const seq = this.sequence++;
    this.buffer = '';
    this.publishQueue = this.publishQueue.then(() =>
      publishChunk(this.requestId, this.userId, text, false, seq).then(() => {})
    );
  }

  /** Flush remaining content, send the done signal, and wait for all publishes. */
  async done(error?: string): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushBuffer();
    const seq = this.sequence++;
    this.publishQueue = this.publishQueue.then(() =>
      publishChunk(this.requestId, this.userId, '', true, seq, error).then(() => {})
    );
    await this.publishQueue;
  }
}
