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

export async function handler(
  event: AppSyncEvent<ChatEventArgs>
): Promise<SendMessageResponse> {
  const { input } = event.arguments;
  const { requestId, provider, messages, model } = input;
  const identity = event.identity;

  console.log(`Processing chat request: ${requestId} for provider: ${provider}, user: ${identity.sub}`);

  try {
    // Get API keys from Secrets Manager
    const secrets = await getSecrets();

    // Stream the response — publishes chunks via AppSync subscriptions
    await streamInBackground(secrets, provider, messages, requestId, model);

    return {
      requestId,
      status: 'COMPLETE',
      message: 'Message streaming complete.',
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
