// AppSync-based judge service
import type { QualityRating, Message } from '../types';
import { executeGraphQL, isAppSyncConfigured } from './appsyncClient';
import {
  JUDGE_RESPONSE_MUTATION,
  type ChatProvider,
  type JudgeInput,
  type JudgeResponse,
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
    default:
      throw new AppSyncJudgeError(`Unknown judge: ${judgeId}`);
  }
}

// Get a quality rating from a specific judge
export async function getQualityRating(
  judgeId: string,
  conversationHistory: Message[],
  latestResponse: string,
  respondingProvider: string
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
    { input }
  );

  const { score, explanation, problems } = response.judgeResponse;

  return {
    score,
    explanation,
    problems,
  };
}

// Re-export isConfigured
export function isConfigured(): boolean {
  return isAppSyncConfigured();
}
