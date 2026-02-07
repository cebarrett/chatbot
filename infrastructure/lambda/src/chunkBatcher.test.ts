import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publishChunk } from './appsync';
import { ChunkBatcher } from './chunkBatcher';

vi.mock('./appsync', () => ({
  publishChunk: vi.fn().mockResolvedValue({}),
}));

const mockPublishChunk = vi.mocked(publishChunk);

describe('ChunkBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPublishChunk.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not publish immediately on add()', () => {
    const batcher = new ChunkBatcher('req-1', 'user-1');
    batcher.add('hello');
    expect(mockPublishChunk).not.toHaveBeenCalled();
  });

  it('publishes buffered content after interval', async () => {
    const batcher = new ChunkBatcher('req-1', 'user-1', 100);
    batcher.add('hello');

    vi.advanceTimersByTime(100);
    // Let the microtask (promise chain) resolve
    await vi.runAllTimersAsync();

    expect(mockPublishChunk).toHaveBeenCalledWith('req-1', 'user-1', 'hello', false, 0);
  });

  it('concatenates multiple add() calls before flush', async () => {
    const batcher = new ChunkBatcher('req-1', 'user-1', 100);
    batcher.add('hel');
    batcher.add('lo');

    await vi.advanceTimersByTimeAsync(100);

    expect(mockPublishChunk).toHaveBeenCalledWith('req-1', 'user-1', 'hello', false, 0);
    expect(mockPublishChunk).toHaveBeenCalledTimes(1);
  });

  it('increments sequence number on each flush', async () => {
    const batcher = new ChunkBatcher('req-1', 'user-1', 100);

    batcher.add('first');
    await vi.advanceTimersByTimeAsync(100);

    batcher.add('second');
    await vi.advanceTimersByTimeAsync(100);

    expect(mockPublishChunk).toHaveBeenNthCalledWith(1, 'req-1', 'user-1', 'first', false, 0);
    expect(mockPublishChunk).toHaveBeenNthCalledWith(2, 'req-1', 'user-1', 'second', false, 1);
  });

  it('done() flushes remaining buffer and sends done signal', async () => {
    const batcher = new ChunkBatcher('req-1', 'user-1', 100);
    batcher.add('final');

    await batcher.done();

    // Should have flushed the buffer, then sent done
    expect(mockPublishChunk).toHaveBeenCalledWith('req-1', 'user-1', 'final', false, 0);
    expect(mockPublishChunk).toHaveBeenCalledWith('req-1', 'user-1', '', true, 1, undefined);
    expect(mockPublishChunk).toHaveBeenCalledTimes(2);
  });

  it('done() with error passes error string', async () => {
    const batcher = new ChunkBatcher('req-1', 'user-1', 100);

    await batcher.done('something went wrong');

    expect(mockPublishChunk).toHaveBeenCalledWith(
      'req-1', 'user-1', '', true, 0, 'something went wrong'
    );
  });

  it('does not publish empty buffer on timer flush', async () => {
    const batcher = new ChunkBatcher('req-1', 'user-1', 100);
    batcher.add('text');

    await vi.advanceTimersByTimeAsync(100);
    mockPublishChunk.mockClear();

    // No new content added, advance timer — nothing should publish
    await vi.advanceTimersByTimeAsync(200);
    expect(mockPublishChunk).not.toHaveBeenCalled();
  });

  it('done() with no pending content only sends done signal', async () => {
    const batcher = new ChunkBatcher('req-1', 'user-1', 100);

    await batcher.done();

    expect(mockPublishChunk).toHaveBeenCalledTimes(1);
    expect(mockPublishChunk).toHaveBeenCalledWith('req-1', 'user-1', '', true, 0, undefined);
  });
});
