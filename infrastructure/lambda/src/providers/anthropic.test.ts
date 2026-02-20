import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSSEResponse, createMockJSONResponse, createMockErrorResponse } from '../test-helpers';

// Mock ChunkBatcher before importing the module under test
const mockAdd = vi.fn();
const mockDone = vi.fn().mockResolvedValue(undefined);
vi.mock('../chunkBatcher', () => ({
  ChunkBatcher: vi.fn().mockImplementation(() => ({
    add: mockAdd,
    done: mockDone,
  })),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { streamAnthropic, judgeAnthropic } from './anthropic';

beforeEach(() => {
  mockFetch.mockReset();
  mockAdd.mockClear();
  mockDone.mockClear();
});

describe('streamAnthropic - request building', () => {
  // Helper: capture the fetch call's request body
  function captureRequestBody(): Record<string, unknown> {
    const body = mockFetch.mock.calls[0][1].body;
    return JSON.parse(body);
  }

  beforeEach(() => {
    // Default: return a minimal SSE stream that ends immediately
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"type":"message_stop"}',
      ])
    );
  });

  it('uses default model when none specified', async () => {
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(captureRequestBody().model).toBe('claude-sonnet-4-6-20250819');
  });

  it('uses specified model when provided', async () => {
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user', 'claude-3-5-haiku-20241022');
    expect(captureRequestBody().model).toBe('claude-3-5-haiku-20241022');
  });

  it('sets max_tokens to 32000 for thinking-capable model', async () => {
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user', 'claude-sonnet-4-20250514');
    expect(captureRequestBody().max_tokens).toBe(32000);
  });

  it('sets max_tokens to 8192 for non-thinking models', async () => {
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user', 'claude-3-5-haiku-20241022');
    expect(captureRequestBody().max_tokens).toBe(8192);
  });

  it('enables thinking config for thinking-capable model', async () => {
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user', 'claude-sonnet-4-20250514');
    expect(captureRequestBody().thinking).toEqual({
      type: 'enabled',
      budget_tokens: 10000,
    });
  });

  it('does not include thinking config for non-thinking models', async () => {
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user', 'claude-3-5-haiku-20241022');
    expect(captureRequestBody().thinking).toBeUndefined();
  });

  it('extracts system message to top-level system field', async () => {
    await streamAnthropic(
      'key',
      [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'hi' },
      ],
      'req', 'user'
    );
    const body = captureRequestBody();
    expect(body.system).toBe('You are helpful');
    expect((body.messages as any[]).every((m: any) => m.role !== 'system')).toBe(true);
  });

  it('does not include system field when no system message', async () => {
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(captureRequestBody().system).toBeUndefined();
  });

  it('sets correct headers', async () => {
    await streamAnthropic('my-api-key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['x-api-key']).toBe('my-api-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('sets stream: true', async () => {
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(captureRequestBody().stream).toBe(true);
  });
});

describe('streamAnthropic - SSE parsing', () => {
  it('adds <think> tag on thinking content_block_start', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"type":"content_block_start","content_block":{"type":"thinking"}}',
        'data: {"type":"message_stop"}',
      ])
    );
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockAdd).toHaveBeenCalledWith('<think>');
  });

  it('adds thinking text from thinking_delta', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"type":"content_block_start","content_block":{"type":"thinking"}}',
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Let me think..."}}',
        'data: {"type":"message_stop"}',
      ])
    );
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockAdd).toHaveBeenCalledWith('Let me think...');
  });

  it('adds </think> on content_block_stop after thinking', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"type":"content_block_start","content_block":{"type":"thinking"}}',
        'data: {"type":"content_block_stop"}',
        'data: {"type":"message_stop"}',
      ])
    );
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockAdd).toHaveBeenCalledWith('</think>\n\n');
  });

  it('adds text from text_delta', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"type":"content_block_start","content_block":{"type":"text"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello world"}}',
        'data: {"type":"message_stop"}',
      ])
    );
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockAdd).toHaveBeenCalledWith('Hello world');
  });

  it('calls batcher.done() on message_stop', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"type":"message_stop"}',
      ])
    );
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockDone).toHaveBeenCalled();
  });

  it('handles full thinking + text sequence', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"type":"content_block_start","content_block":{"type":"thinking"}}',
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"reasoning"}}',
        'data: {"type":"content_block_stop"}',
        'data: {"type":"content_block_start","content_block":{"type":"text"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"answer"}}',
        'data: {"type":"content_block_stop"}',
        'data: {"type":"message_stop"}',
      ])
    );
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user');

    const calls = mockAdd.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['<think>', 'reasoning', '</think>\n\n', 'answer']);
  });

  it('skips malformed JSON lines', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {not valid json}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
        'data: {"type":"message_stop"}',
      ])
    );
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockAdd).toHaveBeenCalledWith('ok');
  });

  it('skips non-data lines', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'event: ping',
        '',
        'data: {"type":"message_stop"}',
      ])
    );
    await streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockDone).toHaveBeenCalled();
  });
});

describe('streamAnthropic - error handling', () => {
  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(createMockErrorResponse(401, 'Unauthorized'));
    await expect(
      streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user')
    ).rejects.toThrow('Anthropic API error: 401');
  });

  it('throws when response body is null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    });
    await expect(
      streamAnthropic('key', [{ role: 'user', content: 'hi' }], 'req', 'user')
    ).rejects.toThrow('No response body');
  });
});

describe('judgeAnthropic', () => {
  it('sends system prompt and user prompt correctly', async () => {
    mockFetch.mockResolvedValue(
      createMockJSONResponse({ content: [{ text: '{"score": 8}' }] })
    );
    await judgeAnthropic('key', 'system prompt', 'user prompt');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system).toBe('system prompt');
    expect(body.messages).toEqual([{ role: 'user', content: 'user prompt' }]);
    expect(body.max_tokens).toBe(16000);
  });

  it('returns content text from response', async () => {
    mockFetch.mockResolvedValue(
      createMockJSONResponse({ content: [{ text: 'judge result' }] })
    );
    const result = await judgeAnthropic('key', 'sys', 'user');
    expect(result).toEqual({ text: 'judge result', tokenCount: Math.ceil('judge result'.length / 4) });
  });

  it('returns empty string when content is missing', async () => {
    mockFetch.mockResolvedValue(createMockJSONResponse({ content: [] }));
    const result = await judgeAnthropic('key', 'sys', 'user');
    expect(result).toEqual({ text: '', tokenCount: 0 });
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValue(createMockErrorResponse(500, 'Server error'));
    await expect(judgeAnthropic('key', 'sys', 'user')).rejects.toThrow('Anthropic API error: 500');
  });
});
