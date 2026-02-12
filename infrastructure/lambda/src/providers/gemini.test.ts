import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSSEResponse, createMockJSONResponse, createMockErrorResponse } from '../test-helpers';

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

import { streamGemini, judgeGemini } from './gemini';

beforeEach(() => {
  mockFetch.mockReset();
  mockAdd.mockClear();
  mockDone.mockClear();
});

describe('streamGemini - request building', () => {
  function captureRequestBody(): Record<string, unknown> {
    const body = mockFetch.mock.calls[0][1].body;
    return JSON.parse(body);
  }

  function captureUrl(): string {
    return mockFetch.mock.calls[0][0];
  }

  beforeEach(() => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"done"}]}}],"finishReason":"STOP"}',
      ])
    );
  });

  it('uses default model when none specified', async () => {
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(captureUrl()).toContain('/gemini-3-pro-preview:');
  });

  it('uses specified model when provided', async () => {
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user', 'gemini-1.5-pro');
    expect(captureUrl()).toContain('/gemini-1.5-pro:');
  });

  it('sets maxOutputTokens to 8192', async () => {
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    const body = captureRequestBody();
    expect((body.generationConfig as any).maxOutputTokens).toBe(8192);
  });

  it('enables thinkingConfig for gemini-2.5-pro', async () => {
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user', 'gemini-2.5-pro');
    const config = (captureRequestBody().generationConfig as any);
    expect(config.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingBudget: 8192,
    });
  });

  it('enables thinkingConfig for gemini-2.5-flash', async () => {
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user', 'gemini-2.5-flash');
    const config = (captureRequestBody().generationConfig as any);
    expect(config.thinkingConfig).toBeDefined();
  });

  it('does not enable thinkingConfig for gemini-1.5-pro', async () => {
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user', 'gemini-1.5-pro');
    const config = (captureRequestBody().generationConfig as any);
    expect(config.thinkingConfig).toBeUndefined();
  });

  it('converts assistant role to model role', async () => {
    await streamGemini(
      'key',
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      'req', 'user'
    );
    const contents = captureRequestBody().contents as any[];
    expect(contents[1].role).toBe('model');
  });

  it('extracts system message to systemInstruction field', async () => {
    await streamGemini(
      'key',
      [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'hi' },
      ],
      'req', 'user'
    );
    const body = captureRequestBody();
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Be helpful' }] });
    const contents = body.contents as any[];
    expect(contents.every((c: any) => c.role !== 'system')).toBe(true);
  });

  it('does not include systemInstruction when no system message', async () => {
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(captureRequestBody().systemInstruction).toBeUndefined();
  });

  it('includes API key in URL', async () => {
    await streamGemini('my-key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(captureUrl()).toContain('key=my-key');
  });
});

describe('streamGemini - SSE parsing', () => {
  it('opens <think> tag when part.thought is true', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"thinking..."}]}}]}',
      ])
    );
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockAdd).toHaveBeenCalledWith('<think>');
    expect(mockAdd).toHaveBeenCalledWith('thinking...');
  });

  it('closes thinking block when transitioning to non-thought part', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"reasoning"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":"answer"}]}}]}',
      ])
    );
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user');

    const calls = mockAdd.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['<think>', 'reasoning', '</think>\n\n', 'answer']);
  });

  it('closes unclosed thinking block at end of stream', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"still thinking"}]}}]}',
      ])
    );
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user');

    const calls = mockAdd.mock.calls.map((c) => c[0]);
    expect(calls).toContain('</think>\n\n');
  });

  it('adds text for non-thought parts', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"hello world"}]}}]}',
      ])
    );
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockAdd).toHaveBeenCalledWith('hello world');
  });

  it('skips malformed JSON lines', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {broken',
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      ])
    );
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockAdd).toHaveBeenCalledWith('ok');
  });

  it('calls batcher.done() at end of stream', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}',
      ])
    );
    await streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockDone).toHaveBeenCalled();
  });
});

describe('streamGemini - error handling', () => {
  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(createMockErrorResponse(400, 'Bad Request'));
    await expect(
      streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user')
    ).rejects.toThrow('Gemini API error: 400');
  });

  it('throws when response body is null', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: null });
    await expect(
      streamGemini('key', [{ role: 'user', content: 'hi' }], 'req', 'user')
    ).rejects.toThrow('No response body');
  });
});

describe('judgeGemini', () => {
  it('sends systemInstruction and user content correctly', async () => {
    mockFetch.mockResolvedValue(
      createMockJSONResponse({
        candidates: [{ content: { parts: [{ text: 'judge result' }] } }],
      })
    );
    await judgeGemini('key', 'system prompt', 'user prompt');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'system prompt' }] });
    expect(body.contents[0].parts[0].text).toBe('user prompt');
    expect(body.generationConfig.maxOutputTokens).toBe(4096);
  });

  it('returns candidates text', async () => {
    mockFetch.mockResolvedValue(
      createMockJSONResponse({
        candidates: [{ content: { parts: [{ text: 'result' }] } }],
      })
    );
    const result = await judgeGemini('key', 'sys', 'user');
    expect(result).toBe('result');
  });

  it('returns empty string when candidates are missing', async () => {
    mockFetch.mockResolvedValue(createMockJSONResponse({ candidates: [] }));
    const result = await judgeGemini('key', 'sys', 'user');
    expect(result).toBe('');
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValue(createMockErrorResponse(500, 'Server error'));
    await expect(judgeGemini('key', 'sys', 'user')).rejects.toThrow('Gemini API error: 500');
  });
});
