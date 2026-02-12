import { describe, it, expect } from 'vitest';
import {
  validateProvider,
  validateMessages,
  validateRequestId,
  validateSendMessageInput,
  validateJudgeInput,
  validateJudgeFollowUpInput,
  ValidationError,
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

  it('rejects null input', () => {
    expect(() => validateSendMessageInput(null as any)).toThrow(ValidationError);
  });

  it('rejects invalid provider', () => {
    expect(() =>
      validateSendMessageInput({ ...validInput, provider: 'INVALID' as any })
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

