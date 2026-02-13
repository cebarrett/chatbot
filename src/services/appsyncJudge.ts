// AppSync-based judge service
import type { QualityRating, Message, JudgeFollowUp } from '../types';
import { executeGraphQL, isAppSyncConfigured } from './appsyncClient';
import {
  JUDGE_RESPONSE_MUTATION,
  JUDGE_FOLLOW_UP_MUTATION,
  type ChatProvider,
  type JudgeInput,
  type JudgeResponse,
  type JudgeFollowUpInput,
  type JudgeFollowUpResponse,
} from '../graphql/operations';

export class AppSyncJudgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppSyncJudgeError';
  }
}

// Map frontend judge IDs to GraphQL enum values
function mapJudgeToEnum(judgeId: string): ChatProvider {
  switch (judgeId) {
    case 'openai':
      return 'OPENAI';
    case 'claude':
      return 'ANTHROPIC';
    case 'gemini':
      return 'GEMINI';
    case 'perplexity':
      return 'PERPLEXITY';
    case 'grok':
      return 'GROK';
    default:
      throw new AppSyncJudgeError(`Unknown judge: ${judgeId}`);
  }
}

// Get a quality rating from a specific judge
export async function getQualityRating(
  judgeId: string,
  conversationHistory: Message[],
  latestResponse: string,
  respondingProvider: string,
  signal?: AbortSignal
): Promise<QualityRating> {
  if (!isAppSyncConfigured()) {
    throw new AppSyncJudgeError(
      'AppSync not configured. Please set VITE_APPSYNC_URL and VITE_APPSYNC_API_KEY.'
    );
  }

  // Extract the latest user message as the original prompt
  const userMessages = conversationHistory.filter((m) => m.role === 'user');
  const originalPrompt = userMessages.length > 0
    ? userMessages[userMessages.length - 1].content
    : '';

  // Pass prior conversation history (everything except the last user message)
  const priorMessages = conversationHistory.slice(0, -1);
  const history = priorMessages.length > 0
    ? priorMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    : undefined;

  const input: JudgeInput = {
    judgeProvider: mapJudgeToEnum(judgeId),
    originalPrompt,
    responseToJudge: latestResponse,
    respondingProvider,
    conversationHistory: history,
  };

  const response = await executeGraphQL<{ judgeResponse: JudgeResponse }>(
    JUDGE_RESPONSE_MUTATION,
    { input },
    signal
  );

  const { score, explanation, problems } = response.judgeResponse;

  // Backend returns score 0 for errors (valid scores are always 1.0-10.0).
  // Detect this and throw so the error flows through the onError path
  // instead of being displayed as a "0.0" rating.
  if (score === 0) {
    // Strip the "Error evaluating response: " prefix if present for a cleaner message
    const detail = explanation.replace(/^Error evaluating response:\s*/i, '');
    throw new AppSyncJudgeError(detail || 'Evaluation failed');
  }

  return {
    score,
    explanation,
    problems,
  };
}

// Ask a follow-up question to a judge about their rating
export async function askFollowUpQuestion(
  judgeId: string,
  conversationHistory: Message[],
  latestResponse: string,
  respondingProvider: string,
  rating: QualityRating,
  followUpQuestion: string,
  signal?: AbortSignal
): Promise<JudgeFollowUp> {
  if (!isAppSyncConfigured()) {
    throw new AppSyncJudgeError(
      'AppSync not configured. Please set VITE_APPSYNC_URL and VITE_APPSYNC_API_KEY.'
    );
  }

  // Extract the latest user message as the original prompt
  const userMessages = conversationHistory.filter((m) => m.role === 'user');
  const originalPrompt = userMessages.length > 0
    ? userMessages[userMessages.length - 1].content
    : '';

  // Pass prior conversation history (everything except the last user message)
  const priorMessages = conversationHistory.slice(0, -1);
  const history = priorMessages.length > 0
    ? priorMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    : undefined;

  const input: JudgeFollowUpInput = {
    judgeProvider: mapJudgeToEnum(judgeId),
    originalPrompt,
    responseToJudge: latestResponse,
    respondingProvider,
    conversationHistory: history,
    previousScore: rating.score,
    previousExplanation: rating.explanation,
    previousProblems: rating.problems,
    followUpQuestion,
  };

  const response = await executeGraphQL<{ judgeFollowUp: JudgeFollowUpResponse }>(
    JUDGE_FOLLOW_UP_MUTATION,
    { input },
    signal
  );

  return {
    question: followUpQuestion,
    answer: response.judgeFollowUp.answer,
  };
}

// Re-export isConfigured
export function isConfigured(): boolean {
  return isAppSyncConfigured();
}
