import {
  AppSyncEvent,
  SendMessageInput,
  SendMessageResponse,
  ChatProvider,
  UserIdentity,
} from './types';
import { getSecrets } from './secrets';
import { publishChunk } from './appsync';
import { streamOpenAI, streamAnthropic, streamGemini, streamPerplexity, streamGrok } from './providers';
import { validateSendMessageInput, ValidationError } from './validation';
import { resolveInternalUserId } from './userService';
import { checkTokenBudget, checkAndIncrementRequestCount, recordTokenUsage, RateLimitError } from './rateLimiter';
import { resolveModel, weightedTokens } from './modelCosts';

interface ChatEventArgs {
  input: SendMessageInput;
}

// Use callback-based handler so we can return a response to AppSync immediately
// while keeping the Lambda alive for background streaming.
// With callbackWaitsForEmptyEventLoop = true (default), the Lambda stays running
// until all pending promises complete, even after callback() returns the response.
export function handler(
  event: AppSyncEvent<ChatEventArgs>,
  context: { callbackWaitsForEmptyEventLoop: boolean },
  callback: (error: Error | null, result?: SendMessageResponse) => void
): void {
  const { input } = event.arguments;
  const identity = event.identity;

  // Validate input before processing
  try {
    validateSendMessageInput(input);
  } catch (error) {
    const errorMessage = error instanceof ValidationError
      ? error.message
      : 'Input validation failed';
    console.error('Validation error:', errorMessage);
    callback(null, {
      requestId: input?.requestId || 'unknown',
      status: 'ERROR',
      message: errorMessage,
    });
    return;
  }

  const { requestId, provider, messages, model } = input;
  // External user ID (Clerk) - used for subscription routing (must match frontend filter)
  const externalUserId = identity.sub;

  // Return STREAMING response to AppSync immediately to avoid the ~30s resolver timeout.
  // Rate limits, secrets, and streaming all happen in the background.
  // Any errors are published as error chunks via the subscription.
  callback(null, {
    requestId,
    status: 'STREAMING',
    message: 'Stream started',
  });

  // Everything else runs in the background — Lambda stays alive until all promises complete
  initAndStream(identity, requestId, provider, messages, model, externalUserId);
}

async function initAndStream(
  identity: UserIdentity,
  requestId: string,
  provider: ChatProvider,
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  model: string | undefined,
  externalUserId: string,
): Promise<void> {
  let internalUserId: string;

  try {
    internalUserId = await resolveInternalUserId(identity);
    console.log(`Processing chat request: ${requestId} for provider: ${provider}, internalUser: ${internalUserId}, externalUser: ${externalUserId}`);

    // Check rate limits: token budget first (read-only), then request count (atomic write)
    await checkTokenBudget(internalUserId);
    await checkAndIncrementRequestCount(internalUserId);
  } catch (error) {
    console.error('Error processing chat request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await publishChunk(requestId, externalUserId, '', true, 0, errorMessage);
    return;
  }

  try {
    const secrets = await getSecrets();
    await streamInBackground(secrets, provider, messages, requestId, externalUserId, internalUserId, model);
  } catch (error) {
    console.error('Error processing chat request:', error);
    await publishChunk(
      requestId,
      externalUserId,
      '',
      true,
      0,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

async function streamInBackground(
  secrets: { OPENAI_API_KEY: string; ANTHROPIC_API_KEY: string; GEMINI_API_KEY: string; PERPLEXITY_API_KEY: string; GROK_API_KEY: string },
  provider: ChatProvider,
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  requestId: string,
  userId: string,
  internalUserId: string,
  model?: string
): Promise<void> {
  try {
    let tokenCount = 0;
    switch (provider) {
      case 'OPENAI':
        tokenCount = await streamOpenAI(secrets.OPENAI_API_KEY, messages, requestId, userId, model);
        break;
      case 'ANTHROPIC':
        tokenCount = await streamAnthropic(secrets.ANTHROPIC_API_KEY, messages, requestId, userId, model);
        break;
      case 'GEMINI':
        tokenCount = await streamGemini(secrets.GEMINI_API_KEY, messages, requestId, userId, model);
        break;
      case 'PERPLEXITY':
        tokenCount = await streamPerplexity(secrets.PERPLEXITY_API_KEY, messages, requestId, userId, model);
        break;
      case 'GROK':
        tokenCount = await streamGrok(secrets.GROK_API_KEY, messages, requestId, userId, model);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    try {
      const effectiveModel = resolveModel(provider, model);
      const weighted = weightedTokens(tokenCount, effectiveModel);
      console.log(`Token usage: ${tokenCount} raw, ${weighted} weighted (model: ${effectiveModel})`);
      await recordTokenUsage(internalUserId, weighted);
    } catch (err) {
      console.error('Failed to record token usage:', err);
    }
  } catch (error) {
    console.error(`Streaming error for ${provider}:`, error);
    await publishChunk(
      requestId,
      userId,
      '',
      true,
      0,
      error instanceof Error ? error.message : 'Streaming error'
    );
  }
}
