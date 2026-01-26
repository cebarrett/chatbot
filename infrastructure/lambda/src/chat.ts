import {
  AppSyncEvent,
  SendMessageInput,
  SendMessageResponse,
  ChatProvider,
} from './types';
import { getSecrets } from './secrets';
import { publishChunk } from './appsync';
import { streamOpenAI, streamAnthropic, streamGemini } from './providers';

interface ChatEvent {
  input: SendMessageInput;
}

export async function handler(
  event: AppSyncEvent<ChatEvent>
): Promise<SendMessageResponse> {
  const { input } = event.arguments;
  const { requestId, provider, messages, model } = input;

  console.log(`Processing chat request: ${requestId} for provider: ${provider}`);

  try {
    // Get API keys from Secrets Manager
    const secrets = await getSecrets();

    // Start streaming in background and return immediately
    // The streaming will publish chunks via AppSync subscriptions
    streamInBackground(secrets, provider, messages, requestId, model);

    return {
      requestId,
      status: 'STREAMING',
      message: 'Message streaming started. Subscribe to onMessageChunk for updates.',
    };
  } catch (error) {
    console.error('Error processing chat request:', error);

    // Publish error to subscribers
    await publishChunk(
      requestId,
      '',
      true,
      error instanceof Error ? error.message : 'Unknown error'
    );

    return {
      requestId,
      status: 'ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function streamInBackground(
  secrets: { OPENAI_API_KEY: string; ANTHROPIC_API_KEY: string; GEMINI_API_KEY: string },
  provider: ChatProvider,
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  requestId: string,
  model?: string
): Promise<void> {
  try {
    switch (provider) {
      case 'OPENAI':
        await streamOpenAI(secrets.OPENAI_API_KEY, messages, requestId, model);
        break;
      case 'ANTHROPIC':
        await streamAnthropic(secrets.ANTHROPIC_API_KEY, messages, requestId, model);
        break;
      case 'GEMINI':
        await streamGemini(secrets.GEMINI_API_KEY, messages, requestId, model);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (error) {
    console.error(`Streaming error for ${provider}:`, error);
    await publishChunk(
      requestId,
      '',
      true,
      error instanceof Error ? error.message : 'Streaming error'
    );
  }
}
