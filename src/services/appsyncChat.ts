// AppSync-based chat service with real-time streaming via subscriptions
import type { Message } from '../types';
import { executeGraphQL, createSubscription, isAppSyncConfigured } from './appsyncClient';
import {
  SEND_MESSAGE_MUTATION,
  ON_MESSAGE_CHUNK_SUBSCRIPTION,
  type ChatProvider,
  type SendMessageInput,
  type SendMessageResponse,
  type MessageChunk,
  type ChatMessageInput,
} from '../graphql/operations';

export class AppSyncChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppSyncChatError';
  }
}

// Map frontend provider IDs to GraphQL enum values
function mapProviderToEnum(providerId: string): ChatProvider {
  switch (providerId) {
    case 'openai':
      return 'OPENAI';
    case 'claude':
      return 'ANTHROPIC';
    case 'gemini':
      return 'GEMINI';
    default:
      throw new AppSyncChatError(`Unknown provider: ${providerId}`);
  }
}

// Convert frontend messages to GraphQL input format
function convertMessages(
  messages: Message[],
  systemPrompt?: string
): ChatMessageInput[] {
  const graphqlMessages: ChatMessageInput[] = [];

  // Add system prompt if provided
  if (systemPrompt) {
    graphqlMessages.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  // Add conversation messages
  for (const msg of messages) {
    graphqlMessages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  return graphqlMessages;
}

// Send a message and stream the response via subscription
export async function sendMessageStream(
  providerId: string,
  messages: Message[],
  systemPrompt: string | undefined,
  onChunk: (content: string) => void
): Promise<string> {
  if (!isAppSyncConfigured()) {
    throw new AppSyncChatError(
      'AppSync not configured. Please set VITE_APPSYNC_URL in your .env file.'
    );
  }

  const requestId = crypto.randomUUID();
  const provider = mapProviderToEnum(providerId);
  const graphqlMessages = convertMessages(messages, systemPrompt);

  let fullContent = '';
  let streamDone = false;
  let subscriptionError: Error | null = null;
  let resolvePromise: ((value: string) => void) | null = null;
  let rejectPromise: ((error: Error) => void) | null = null;

  const resultPromise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  // Reordering state: buffer out-of-order chunks and emit in sequence
  let nextExpectedSeq = 0;
  const pendingChunks = new Map<number, MessageChunk>();
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const STALL_TIMEOUT_MS = 2000;

  function clearStallTimer() {
    if (stallTimer !== null) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  }

  function skipToNextAvailable() {
    if (pendingChunks.size === 0) return;
    const nextAvailable = Math.min(...pendingChunks.keys());
    console.warn(
      `Sequence stall: skipping missing chunk(s) ${nextExpectedSeq}–${nextAvailable - 1}`
    );
    nextExpectedSeq = nextAvailable;
    processInOrder();
  }

  function processInOrder() {
    while (pendingChunks.has(nextExpectedSeq)) {
      clearStallTimer();
      const chunk = pendingChunks.get(nextExpectedSeq)!;
      pendingChunks.delete(nextExpectedSeq);
      nextExpectedSeq++;

      if (chunk.chunk) {
        fullContent += chunk.chunk;
        onChunk(fullContent);
      }

      if (chunk.done) {
        streamDone = true;
        subscription?.close();
        resolvePromise?.(fullContent);
        return;
      }
    }

    // If chunks are buffered beyond the expected sequence, a gap exists.
    // Start a timer to skip missing sequence(s) if the gap isn't filled.
    if (pendingChunks.size > 0 && stallTimer === null) {
      stallTimer = setTimeout(skipToNextAvailable, STALL_TIMEOUT_MS);
    }
  }

  // Variable to hold subscription reference
  let subscription: { close: () => void } | null = null;

  // First, set up the subscription (now async)
  try {
    subscription = await createSubscription<MessageChunk>(
      ON_MESSAGE_CHUNK_SUBSCRIPTION,
      { requestId },
      {
        onData: (chunk) => {
          if (chunk.error) {
            clearStallTimer();
            subscriptionError = new AppSyncChatError(chunk.error);
            subscription?.close();
            rejectPromise?.(subscriptionError);
            return;
          }

          // Buffer the chunk and emit in sequence order
          pendingChunks.set(chunk.sequence, chunk);
          processInOrder();
        },
        onError: (error) => {
          clearStallTimer();
          subscriptionError = error;
          subscription?.close();
          rejectPromise?.(error);
        },
        onComplete: () => {
          clearStallTimer();
          if (streamDone) {
            // Normal close after done chunk — already resolved by processInOrder
            return;
          }
          // WebSocket closed before stream finished. Resolve with what we have
          // rather than hanging forever.
          if (!subscriptionError && fullContent) {
            console.warn('WebSocket closed before done chunk received. Resolving with partial content.');
            resolvePromise?.(fullContent);
          }
        },
      }
    );
  } catch (error) {
    throw error instanceof Error ? error : new AppSyncChatError('Failed to create subscription');
  }

  // Send the mutation to start streaming
  // (createSubscription now waits for start_ack, so the subscription is fully ready)
  try {
    const input: SendMessageInput = {
      requestId,
      provider,
      messages: graphqlMessages,
    };

    const response = await executeGraphQL<{ sendMessage: SendMessageResponse }>(
      SEND_MESSAGE_MUTATION,
      { input }
    );

    if (response.sendMessage.status === 'ERROR') {
      subscription?.close();
      throw new AppSyncChatError(response.sendMessage.message || 'Unknown error');
    }
    // Status 'STREAMING' means Lambda returned immediately and is streaming
    // in the background. The subscription will receive the chunks.
  } catch (error) {
    if (error instanceof AppSyncChatError) {
      subscription?.close();
      throw error;
    }
    // Non-fatal mutation errors (e.g., network issues) — keep subscription
    // open since Lambda may still be streaming.
    console.warn('sendMessage mutation error (streaming may continue):', error);
  }

  return resultPromise;
}

// Re-export isConfigured
export function isConfigured(): boolean {
  return isAppSyncConfigured();
}
