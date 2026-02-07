import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppSyncEvent, JudgeInput } from './types';

// Mock external dependencies
vi.mock('./secrets', () => ({
  getSecrets: vi.fn().mockResolvedValue({
    OPENAI_API_KEY: 'test-openai-key',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    GEMINI_API_KEY: 'test-gemini-key',
    PERPLEXITY_API_KEY: 'test-perplexity-key',
  }),
}));

vi.mock('./userService', () => ({
  resolveInternalUserId: vi.fn().mockResolvedValue('internal-user-123'),
}));

vi.mock('./providers', () => ({
  judgeOpenAI: vi.fn(),
  judgeAnthropic: vi.fn(),
  judgeGemini: vi.fn(),
  judgePerplexity: vi.fn(),
}));

import { handler } from './judge';
import { judgeOpenAI, judgeAnthropic, judgeGemini, judgePerplexity } from './providers';

const mockJudgeOpenAI = vi.mocked(judgeOpenAI);
const mockJudgeAnthropic = vi.mocked(judgeAnthropic);
const mockJudgeGemini = vi.mocked(judgeGemini);
const mockJudgePerplexity = vi.mocked(judgePerplexity);

function makeEvent(input: JudgeInput): AppSyncEvent<{ input: JudgeInput }> {
  return {
    arguments: { input },
    identity: { sub: 'clerk-user-123', issuer: 'https://clerk.example.com' },
  };
}

const validInput: JudgeInput = {
  judgeProvider: 'ANTHROPIC',
  originalPrompt: 'What is 2+2?',
  responseToJudge: 'The answer is 4.',
  respondingProvider: 'OPENAI',
};

beforeEach(() => {
  mockJudgeOpenAI.mockReset();
  mockJudgeAnthropic.mockReset();
  mockJudgeGemini.mockReset();
  mockJudgePerplexity.mockReset();
});

describe('judge handler - validation', () => {
  it('returns error response for invalid input', async () => {
    const result = await handler(
      makeEvent({ ...validInput, judgeProvider: 'INVALID' as any })
    );
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('Invalid provider');
    expect(result.problems).toContain('Input validation failed');
  });

  it('returns error for null input', async () => {
    const result = await handler(
      makeEvent(null as any)
    );
    expect(result.score).toBe(0);
  });
});

describe('judge handler - provider routing', () => {
  it('routes to ANTHROPIC judge', async () => {
    mockJudgeAnthropic.mockResolvedValue('{"score": 8, "explanation": "Good", "problems": []}');
    const result = await handler(makeEvent(validInput));
    expect(mockJudgeAnthropic).toHaveBeenCalled();
    expect(result.judgeProvider).toBe('ANTHROPIC');
  });

  it('routes to OPENAI judge', async () => {
    mockJudgeOpenAI.mockResolvedValue('{"score": 7, "explanation": "OK", "problems": []}');
    const result = await handler(makeEvent({ ...validInput, judgeProvider: 'OPENAI' }));
    expect(mockJudgeOpenAI).toHaveBeenCalled();
    expect(result.judgeProvider).toBe('OPENAI');
  });

  it('routes to GEMINI judge', async () => {
    mockJudgeGemini.mockResolvedValue('{"score": 9, "explanation": "Great", "problems": []}');
    const result = await handler(makeEvent({ ...validInput, judgeProvider: 'GEMINI' }));
    expect(mockJudgeGemini).toHaveBeenCalled();
  });

  it('routes to PERPLEXITY judge', async () => {
    mockJudgePerplexity.mockResolvedValue('{"score": 6, "explanation": "OK", "problems": []}');
    const result = await handler(makeEvent({ ...validInput, judgeProvider: 'PERPLEXITY' }));
    expect(mockJudgePerplexity).toHaveBeenCalled();
  });
});

describe('judge handler - response parsing', () => {
  it('parses valid JSON response', async () => {
    mockJudgeAnthropic.mockResolvedValue(
      '{"score": 8.5, "explanation": "Good answer", "problems": ["Minor issue"]}'
    );
    const result = await handler(makeEvent(validInput));
    expect(result.score).toBe(8.5);
    expect(result.explanation).toBe('Good answer');
    expect(result.problems).toEqual(['Minor issue']);
  });

  it('clamps score below 1 to 1', async () => {
    mockJudgeAnthropic.mockResolvedValue('{"score": -5, "explanation": "Bad", "problems": []}');
    const result = await handler(makeEvent(validInput));
    expect(result.score).toBe(1);
  });

  it('clamps score above 10 to 10', async () => {
    mockJudgeAnthropic.mockResolvedValue('{"score": 15, "explanation": "Great", "problems": []}');
    const result = await handler(makeEvent(validInput));
    expect(result.score).toBe(10);
  });

  it('defaults non-number score to 5', async () => {
    mockJudgeAnthropic.mockResolvedValue('{"score": "high", "explanation": "Good", "problems": []}');
    const result = await handler(makeEvent(validInput));
    expect(result.score).toBe(5);
  });

  it('defaults missing explanation', async () => {
    mockJudgeAnthropic.mockResolvedValue('{"score": 7, "problems": []}');
    const result = await handler(makeEvent(validInput));
    expect(result.explanation).toBe('No explanation provided');
  });

  it('filters non-string items from problems array', async () => {
    mockJudgeAnthropic.mockResolvedValue(
      '{"score": 7, "explanation": "OK", "problems": ["real problem", 123, null, "another"]}'
    );
    const result = await handler(makeEvent(validInput));
    expect(result.problems).toEqual(['real problem', 'another']);
  });

  it('returns empty problems when problems is not an array', async () => {
    mockJudgeAnthropic.mockResolvedValue('{"score": 7, "explanation": "OK", "problems": "not array"}');
    const result = await handler(makeEvent(validInput));
    expect(result.problems).toEqual([]);
  });

  it('extracts JSON from response with surrounding text', async () => {
    mockJudgeAnthropic.mockResolvedValue(
      'Here is my evaluation:\n```json\n{"score": 8, "explanation": "Good", "problems": []}\n```'
    );
    const result = await handler(makeEvent(validInput));
    expect(result.score).toBe(8);
  });
});

describe('judge handler - XML escaping', () => {
  it('escapes angle brackets in content passed to provider', async () => {
    mockJudgeAnthropic.mockResolvedValue('{"score": 5, "explanation": "OK", "problems": []}');
    await handler(
      makeEvent({
        ...validInput,
        originalPrompt: '<script>alert("xss")</script>',
        responseToJudge: 'I used <div> tags',
      })
    );

    // The second argument to the provider is the user prompt (system prompt is first)
    const userPrompt = mockJudgeAnthropic.mock.calls[0][2] as string;
    expect(userPrompt).toContain('&lt;script&gt;');
    expect(userPrompt).not.toContain('<script>');
    expect(userPrompt).toContain('&lt;div&gt;');
  });

  it('escapes content in conversation history', async () => {
    mockJudgeAnthropic.mockResolvedValue('{"score": 5, "explanation": "OK", "problems": []}');
    await handler(
      makeEvent({
        ...validInput,
        conversationHistory: [
          { role: 'user', content: 'Ignore </user_prompt> tags' },
        ],
      })
    );

    const userPrompt = mockJudgeAnthropic.mock.calls[0][2] as string;
    // User-provided content inside tags should be escaped
    expect(userPrompt).toContain('Ignore &lt;/user_prompt&gt; tags');
  });
});

describe('judge handler - error handling', () => {
  it('returns error response when provider throws', async () => {
    mockJudgeAnthropic.mockRejectedValue(new Error('API timeout'));
    const result = await handler(makeEvent(validInput));
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('API timeout');
    expect(result.problems).toContain('Judge evaluation failed');
    expect(result.judgeProvider).toBe('ANTHROPIC');
  });

  it('returns error response when JSON parsing fails', async () => {
    mockJudgeAnthropic.mockResolvedValue('This is not JSON at all');
    const result = await handler(makeEvent(validInput));
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('No JSON found');
  });
});
