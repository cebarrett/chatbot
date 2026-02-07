import { describe, it, expect } from 'vitest';
import {
  validateProvider,
  validateModel,
  validateMessages,
  validateRequestId,
  validateSendMessageInput,
  validateJudgeInput,
  validateJudgeFollowUpInput,
  ValidationError,
  ALLOWED_MODELS,
  VALIDATION_LIMITS,
} from './validation';
import { ChatProvider } from './types';

describe('validateProvider', () => {
  it.each(['OPENAI', 'ANTHROPIC', 'GEMINI', 'PERPLEXITY'] as const)(
    'accepts valid provider: %s',
    (provider) => {
      expect(() => validateProvider(provider)).not.toThrow();
    }
  );

  it('rejects lowercase provider names', () => {
    expect(() => validateProvider('openai')).toThrow(ValidationError);
  });

  it('rejects empty string', () => {
    expect(() => validateProvider('')).toThrow(ValidationError);
  });

  it('rejects unknown provider', () => {
    expect(() => validateProvider('INVALID')).toThrow(ValidationError);
  });
});

describe('validateModel', () => {
  it('accepts undefined model', () => {
    expect(() => validateModel('OPENAI', undefined)).not.toThrow();
  });

  it.each<[ChatProvider, string]>([
    ['OPENAI', 'gpt-4o'],
    ['ANTHROPIC', 'claude-sonnet-4-20250514'],
    ['GEMINI', 'gemini-2.5-pro'],
    ['PERPLEXITY', 'sonar-reasoning-pro'],
  ])('accepts valid model for %s: %s', (provider, model) => {
    expect(() => validateModel(provider, model)).not.toThrow();
  });

  it('rejects model for wrong provider', () => {
    expect(() => validateModel('ANTHROPIC', 'gpt-4o')).toThrow(ValidationError);
  });

  it('rejects non-existent model', () => {
    expect(() => validateModel('OPENAI', 'gpt-99')).toThrow(ValidationError);
  });

  it('treats empty string model same as undefined (uses default)', () => {
    expect(() => validateModel('OPENAI', '')).not.toThrow();
  });
});

describe('validateMessages', () => {
  const validMessage = { role: 'user' as const, content: 'Hello' };

  it('accepts a single valid user message', () => {
    expect(() => validateMessages([validMessage])).not.toThrow();
  });

  it('accepts user + assistant messages', () => {
    expect(() =>
      validateMessages([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ])
    ).not.toThrow();
  });

  it('accepts system role', () => {
    expect(() =>
      validateMessages([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
      ])
    ).not.toThrow();
  });

  it('rejects empty array', () => {
    expect(() => validateMessages([])).toThrow(ValidationError);
  });

  it('rejects non-array input', () => {
    expect(() => validateMessages('not an array' as any)).toThrow(ValidationError);
  });

  it('rejects when exceeding MAX_MESSAGES', () => {
    const messages = Array.from({ length: 101 }, () => validMessage);
    expect(() => validateMessages(messages)).toThrow(ValidationError);
  });

  it('accepts exactly MAX_MESSAGES', () => {
    const messages = Array.from({ length: 100 }, () => validMessage);
    expect(() => validateMessages(messages)).not.toThrow();
  });

  it('rejects invalid role', () => {
    expect(() =>
      validateMessages([{ role: 'tool' as any, content: 'data' }])
    ).toThrow(ValidationError);
  });

  it('rejects non-string content', () => {
    expect(() =>
      validateMessages([{ role: 'user', content: 123 as any }])
    ).toThrow(ValidationError);
  });

  it('rejects null message in array', () => {
    expect(() => validateMessages([null as any])).toThrow(ValidationError);
  });

  it('rejects message exceeding MAX_MESSAGE_SIZE_BYTES', () => {
    const bigContent = 'x'.repeat(VALIDATION_LIMITS.MAX_MESSAGE_SIZE_BYTES + 1);
    expect(() =>
      validateMessages([{ role: 'user', content: bigContent }])
    ).toThrow(ValidationError);
  });

  it('rejects when total payload exceeds MAX_TOTAL_PAYLOAD_BYTES', () => {
    // Each message just under individual limit, but total exceeds 200KB
    const content = 'x'.repeat(VALIDATION_LIMITS.MAX_MESSAGE_SIZE_BYTES - 1);
    const messages = Array.from({ length: 7 }, () => ({
      role: 'user' as const,
      content,
    }));
    expect(() => validateMessages(messages)).toThrow(ValidationError);
  });
});

describe('validateRequestId', () => {
  it('accepts valid alphanumeric ID', () => {
    expect(() => validateRequestId('abc-123_DEF')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateRequestId('')).toThrow(ValidationError);
  });

  it('rejects ID exceeding max length', () => {
    const longId = 'a'.repeat(VALIDATION_LIMITS.MAX_REQUEST_ID_LENGTH + 1);
    expect(() => validateRequestId(longId)).toThrow(ValidationError);
  });

  it('rejects IDs with spaces', () => {
    expect(() => validateRequestId('req id')).toThrow(ValidationError);
  });

  it('rejects IDs with special characters', () => {
    expect(() => validateRequestId('req/id')).toThrow(ValidationError);
    expect(() => validateRequestId('req.id')).toThrow(ValidationError);
  });
});

describe('validateSendMessageInput', () => {
  const validInput = {
    requestId: 'req-123',
    provider: 'OPENAI' as ChatProvider,
    messages: [{ role: 'user' as const, content: 'Hello' }],
  };

  it('accepts complete valid input', () => {
    expect(() => validateSendMessageInput(validInput)).not.toThrow();
  });

  it('accepts input with optional model', () => {
    expect(() =>
      validateSendMessageInput({ ...validInput, model: 'gpt-4o' })
    ).not.toThrow();
  });

  it('rejects null input', () => {
    expect(() => validateSendMessageInput(null as any)).toThrow(ValidationError);
  });

  it('rejects invalid provider', () => {
    expect(() =>
      validateSendMessageInput({ ...validInput, provider: 'INVALID' as any })
    ).toThrow(ValidationError);
  });

  it('rejects invalid model for provider', () => {
    expect(() =>
      validateSendMessageInput({ ...validInput, model: 'claude-sonnet-4-20250514' })
    ).toThrow(ValidationError);
  });
});

describe('validateJudgeInput', () => {
  const validInput = {
    judgeProvider: 'ANTHROPIC' as ChatProvider,
    originalPrompt: 'What is 2+2?',
    responseToJudge: 'The answer is 4.',
    respondingProvider: 'OPENAI',
  };

  it('accepts complete valid input', () => {
    expect(() => validateJudgeInput(validInput)).not.toThrow();
  });

  it('accepts input with conversation history', () => {
    expect(() =>
      validateJudgeInput({
        ...validInput,
        conversationHistory: [{ role: 'user', content: 'Hi' }],
      })
    ).not.toThrow();
  });

  it('rejects null input', () => {
    expect(() => validateJudgeInput(null as any)).toThrow(ValidationError);
  });

  it('rejects oversized originalPrompt', () => {
    expect(() =>
      validateJudgeInput({
        ...validInput,
        originalPrompt: 'x'.repeat(VALIDATION_LIMITS.MAX_MESSAGE_SIZE_BYTES + 1),
      })
    ).toThrow(ValidationError);
  });

  it('rejects oversized responseToJudge', () => {
    expect(() =>
      validateJudgeInput({
        ...validInput,
        responseToJudge: 'x'.repeat(VALIDATION_LIMITS.MAX_MESSAGE_SIZE_BYTES + 1),
      })
    ).toThrow(ValidationError);
  });

  it('rejects oversized respondingProvider', () => {
    expect(() =>
      validateJudgeInput({
        ...validInput,
        respondingProvider: 'x'.repeat(VALIDATION_LIMITS.MAX_PROVIDER_NAME_LENGTH + 1),
      })
    ).toThrow(ValidationError);
  });
});

describe('validateJudgeFollowUpInput', () => {
  const validInput = {
    judgeProvider: 'ANTHROPIC' as ChatProvider,
    originalPrompt: 'What is 2+2?',
    responseToJudge: 'The answer is 4.',
    respondingProvider: 'OPENAI',
    previousScore: 7.5,
    previousExplanation: 'Good answer',
    previousProblems: ['Minor formatting issue'],
    followUpQuestion: 'Can you elaborate?',
  };

  it('accepts complete valid input', () => {
    expect(() => validateJudgeFollowUpInput(validInput)).not.toThrow();
  });

  it('accepts score at lower boundary (1)', () => {
    expect(() =>
      validateJudgeFollowUpInput({ ...validInput, previousScore: 1 })
    ).not.toThrow();
  });

  it('accepts score at upper boundary (10)', () => {
    expect(() =>
      validateJudgeFollowUpInput({ ...validInput, previousScore: 10 })
    ).not.toThrow();
  });

  it('rejects score below 1', () => {
    expect(() =>
      validateJudgeFollowUpInput({ ...validInput, previousScore: 0.5 })
    ).toThrow(ValidationError);
  });

  it('rejects score above 10', () => {
    expect(() =>
      validateJudgeFollowUpInput({ ...validInput, previousScore: 10.1 })
    ).toThrow(ValidationError);
  });

  it('rejects non-number score', () => {
    expect(() =>
      validateJudgeFollowUpInput({ ...validInput, previousScore: 'seven' as any })
    ).toThrow(ValidationError);
  });

  it('rejects non-array previousProblems', () => {
    expect(() =>
      validateJudgeFollowUpInput({ ...validInput, previousProblems: 'not array' as any })
    ).toThrow(ValidationError);
  });

  it('accepts empty previousProblems array', () => {
    expect(() =>
      validateJudgeFollowUpInput({ ...validInput, previousProblems: [] })
    ).not.toThrow();
  });

  it('rejects oversized followUpQuestion', () => {
    expect(() =>
      validateJudgeFollowUpInput({
        ...validInput,
        followUpQuestion: 'x'.repeat(VALIDATION_LIMITS.MAX_FOLLOW_UP_QUESTION_BYTES + 1),
      })
    ).toThrow(ValidationError);
  });
});

describe('ALLOWED_MODELS', () => {
  it('every provider has at least one model', () => {
    for (const provider of Object.keys(ALLOWED_MODELS) as ChatProvider[]) {
      expect(ALLOWED_MODELS[provider].length).toBeGreaterThan(0);
    }
  });

  // Regression guards for specific models
  it('includes claude-sonnet-4-20250514 for ANTHROPIC', () => {
    expect(ALLOWED_MODELS.ANTHROPIC).toContain('claude-sonnet-4-20250514');
  });

  it('includes gemini-2.5-pro for GEMINI', () => {
    expect(ALLOWED_MODELS.GEMINI).toContain('gemini-2.5-pro');
  });

  it('includes gpt-4o for OPENAI', () => {
    expect(ALLOWED_MODELS.OPENAI).toContain('gpt-4o');
  });

  it('includes sonar-reasoning-pro for PERPLEXITY', () => {
    expect(ALLOWED_MODELS.PERPLEXITY).toContain('sonar-reasoning-pro');
  });
});
