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

// We need to access SourceReferenceFilter which is not exported.
// Test it indirectly via streamPerplexity and judgePerplexity.
import { streamPerplexity, judgePerplexity } from './perplexity';

beforeEach(() => {
  mockFetch.mockReset();
  mockAdd.mockClear();
  mockDone.mockClear();
});

describe('streamPerplexity - source reference filtering', () => {
  it('removes source references [1], [2] from streamed content', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"choices":[{"delta":{"content":"Answer [1] with sources [2]."}}]}',
        'data: [DONE]',
      ])
    );
    await streamPerplexity('key', [{ role: 'user', content: 'hi' }], 'req', 'user');

    const added = mockAdd.mock.calls.map((c) => c[0]).join('');
    expect(added).toBe('Answer  with sources .');
  });

  it('preserves non-numeric brackets', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"choices":[{"delta":{"content":"array[abc] and [10]"}}]}',
        'data: [DONE]',
      ])
    );
    await streamPerplexity('key', [{ role: 'user', content: 'hi' }], 'req', 'user');

    const added = mockAdd.mock.calls.map((c) => c[0]).join('');
    expect(added).toBe('array[abc] and ');
  });

  it('handles split reference across chunks', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"choices":[{"delta":{"content":"text ["}}]}',
        'data: {"choices":[{"delta":{"content":"1] more"}}]}',
        'data: [DONE]',
      ])
    );
    await streamPerplexity('key', [{ role: 'user', content: 'hi' }], 'req', 'user');

    const added = mockAdd.mock.calls.map((c) => c[0]).join('');
    expect(added).toBe('text  more');
  });
});

describe('streamPerplexity - request building', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse(['data: [DONE]'])
    );
  });

  it('uses default model when none specified', async () => {
    await streamPerplexity('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('sonar-reasoning-pro');
  });

  it('sets Authorization Bearer header', async () => {
    await streamPerplexity('my-key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer my-key');
  });

  it('sets stream: true', async () => {
    await streamPerplexity('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
  });

  it('passes messages directly (no role conversion)', async () => {
    await streamPerplexity(
      'key',
      [
        { role: 'system', content: 'be helpful' },
        { role: 'user', content: 'hi' },
      ],
      'req', 'user'
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be helpful' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });
});

describe('streamPerplexity - SSE parsing', () => {
  it('calls batcher.done() on [DONE]', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse(['data: [DONE]'])
    );
    await streamPerplexity('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockDone).toHaveBeenCalled();
  });

  it('adds content from delta', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {"choices":[{"delta":{"content":"hello"}}]}',
        'data: [DONE]',
      ])
    );
    await streamPerplexity('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockAdd).toHaveBeenCalledWith('hello');
  });

  it('skips malformed JSON', async () => {
    mockFetch.mockResolvedValue(
      createMockSSEResponse([
        'data: {broken',
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        'data: [DONE]',
      ])
    );
    await streamPerplexity('key', [{ role: 'user', content: 'hi' }], 'req', 'user');
    expect(mockAdd).toHaveBeenCalledWith('ok');
  });
});

describe('streamPerplexity - error handling', () => {
  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(createMockErrorResponse(429, 'Rate limited'));
    await expect(
      streamPerplexity('key', [{ role: 'user', content: 'hi' }], 'req', 'user')
    ).rejects.toThrow('Perplexity API error: 429');
  });
});

describe('judgePerplexity', () => {
  it('strips <think> blocks from response', async () => {
    mockFetch.mockResolvedValue(
      createMockJSONResponse({
        choices: [{ message: { content: '<think>internal reasoning</think>The answer is 42.' } }],
      })
    );
    const result = await judgePerplexity('key', 'sys', 'user');
    expect(result).toEqual({ text: 'The answer is 42.', tokenCount: Math.ceil('The answer is 42.'.length / 4) });
  });

  it('strips source reference markers from response', async () => {
    mockFetch.mockResolvedValue(
      createMockJSONResponse({
        choices: [{ message: { content: 'Answer [1] with refs [2].' } }],
      })
    );
    const result = await judgePerplexity('key', 'sys', 'user');
    expect(result).toEqual({ text: 'Answer  with refs .', tokenCount: Math.ceil('Answer  with refs .'.length / 4) });
  });

  it('handles response with both think blocks and source references', async () => {
    mockFetch.mockResolvedValue(
      createMockJSONResponse({
        choices: [{ message: { content: '<think>hmm</think>Result [1] here [3].' } }],
      })
    );
    const result = await judgePerplexity('key', 'sys', 'user');
    expect(result).toEqual({ text: 'Result  here .', tokenCount: Math.ceil('Result  here .'.length / 4) });
  });

  it('trims whitespace', async () => {
    mockFetch.mockResolvedValue(
      createMockJSONResponse({
        choices: [{ message: { content: '  <think>x</think>  result  ' } }],
      })
    );
    const result = await judgePerplexity('key', 'sys', 'user');
    expect(result).toEqual({ text: 'result', tokenCount: Math.ceil('result'.length / 4) });
  });

  it('sends system and user messages', async () => {
    mockFetch.mockResolvedValue(
      createMockJSONResponse({
        choices: [{ message: { content: 'ok' } }],
      })
    );
    await judgePerplexity('key', 'system prompt', 'user prompt');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ]);
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValue(createMockErrorResponse(500, 'Error'));
    await expect(judgePerplexity('key', 'sys', 'user')).rejects.toThrow('Perplexity API error: 500');
  });
});
