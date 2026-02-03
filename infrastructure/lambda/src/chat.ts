import {
  AppSyncEvent,
  SendMessageInput,
  SendMessageResponse,
  ChatProvider,
} from './types';
import { getSecrets } from './secrets';
import { publishChunk } from './appsync';
import { streamOpenAI, streamAnthropic, streamGemini } from './providers';

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
  const { requestId, provider, messages, model } = input;
  const identity = event.identity;

  const userId = identity.sub;
  console.log(`Processing chat request: ${requestId} for provider: ${provider}, user: ${userId}`);

  // Start the async work
  getSecrets()
    .then((secrets) => {
      // Return response to AppSync immediately — don't wait for streaming to finish.
      // This avoids the ~30s AppSync resolver timeout for long responses.
      callback(null, {
        requestId,
        status: 'STREAMING',
        message: 'Stream started',
      });

      // Stream in the background — Lambda stays alive until this completes
      return streamInBackground(secrets, provider, messages, requestId, userId, model);
    })
    .catch((error) => {
      console.error('Error processing chat request:', error);

      // Publish error to subscribers
      publishChunk(
        requestId,
        userId,
        '',
        true,
        0,
        error instanceof Error ? error.message : 'Unknown error'
      ).finally(() => {
        callback(null, {
          requestId,
          status: 'ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    });
}

async function streamInBackground(
  secrets: { OPENAI_API_KEY: string; ANTHROPIC_API_KEY: string; GEMINI_API_KEY: string },
  provider: ChatProvider,
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  requestId: string,
  userId: string,
  model?: string
): Promise<void> {
  try {
    switch (provider) {
      case 'OPENAI':
        await streamOpenAI(secrets.OPENAI_API_KEY, messages, requestId, userId, model);
        break;
      case 'ANTHROPIC':
        await streamAnthropic(secrets.ANTHROPIC_API_KEY, messages, requestId, userId, model);
        break;
      case 'GEMINI':
        await streamGemini(secrets.GEMINI_API_KEY, messages, requestId, userId, model);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
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
