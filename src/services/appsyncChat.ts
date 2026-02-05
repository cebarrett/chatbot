// AppSync-based chat service with real-time streaming via subscriptions
import type { Message } from '../types';
import { executeGraphQL, createSubscription, isAppSyncConfigured, getCurrentUserId } from './appsyncClient';
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
    case 'perplexity':
      return 'PERPLEXITY';
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

// Result type for streaming response
export interface StreamResponse {
  content: string
  cancelled: boolean
}

// Result type for streaming with cancellation support
export interface StreamResult {
  promise: Promise<StreamResponse>
  cancel: () => void
}

// Send a message and stream the response via subscription
export function sendMessageStream(
  providerId: string,
  messages: Message[],
  systemPrompt: string | undefined,
  onChunk: (content: string) => void
): StreamResult {
  if (!isAppSyncConfigured()) {
    const error = new AppSyncChatError(
      'AppSync not configured. Please set VITE_APPSYNC_URL in your .env file.'
    );
    return {
      promise: Promise.reject(error),
      cancel: () => {},
    };
  }

  const requestId = crypto.randomUUID();
  const provider = mapProviderToEnum(providerId);
  const graphqlMessages = convertMessages(messages, systemPrompt);

  let fullContent = '';
  let streamDone = false;
  let cancelled = false;
  let subscriptionError: Error | null = null;

  // Deferred pattern for promise resolution
  const deferred: {
    resolve: (value: StreamResponse) => void;
    reject: (error: Error) => void;
  } = {
    resolve: () => {},
    reject: () => {},
  };

  const resultPromise = new Promise<StreamResponse>((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
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
    if (cancelled) return;
    while (pendingChunks.has(nextExpectedSeq)) {
      clearStallTimer();
      const chunk = pendingChunks.get(nextExpectedSeq)!;
      pendingChunks.delete(nextExpectedSeq);
      nextExpectedSeq++;

      if (chunk.chunk && !cancelled) {
        fullContent += chunk.chunk;
        onChunk(fullContent);
      }

      if (chunk.done) {
        streamDone = true;
        subscription?.close();
        if (!cancelled) {
          deferred.resolve({ content: fullContent, cancelled: false });
        }
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

  // Cancel function to stop the stream
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    clearStallTimer();
    subscription?.close();
    deferred.resolve({ content: fullContent, cancelled: true });
  };

  // Async initialization - set up subscription and send mutation
  (async () => {
    try {
      const userId = await getCurrentUserId();

      // First, set up the subscription (now async)
      // Pass userId to filter subscription - prevents eavesdropping on other users' streams
      subscription = await createSubscription<MessageChunk>(
        ON_MESSAGE_CHUNK_SUBSCRIPTION,
        { requestId, userId },
        {
          onData: (chunk) => {
            if (cancelled) return;
            if (chunk.error) {
              clearStallTimer();
              subscriptionError = new AppSyncChatError(chunk.error);
              subscription?.close();
              deferred.reject(subscriptionError);
              return;
            }

            // Buffer the chunk and emit in sequence order
            pendingChunks.set(chunk.sequence, chunk);
            processInOrder();
          },
          onError: (error) => {
            if (cancelled) return;
            clearStallTimer();
            subscriptionError = error;
            subscription?.close();
            deferred.reject(error);
          },
          onComplete: () => {
            clearStallTimer();
            if (streamDone || cancelled) {
              // Normal close after done chunk or cancellation — already resolved
              return;
            }
            // WebSocket closed before stream finished. Resolve with what we have
            // rather than hanging forever.
            if (!subscriptionError && fullContent) {
              console.warn('WebSocket closed before done chunk received. Resolving with partial content.');
              deferred.resolve({ content: fullContent, cancelled: false });
            }
          },
        }
      );

      if (cancelled) {
        subscription?.close();
        return;
      }

      // Send the mutation to start streaming
      // (createSubscription now waits for start_ack, so the subscription is fully ready)
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
        if (!cancelled) {
          deferred.reject(new AppSyncChatError(response.sendMessage.message || 'Unknown error'));
        }
      }
      // Status 'STREAMING' means Lambda returned immediately and is streaming
      // in the background. The subscription will receive the chunks.
    } catch (error) {
      if (cancelled) return;
      if (error instanceof AppSyncChatError) {
        subscription?.close();
        deferred.reject(error);
      } else {
        // Non-fatal mutation errors (e.g., network issues) — keep subscription
        // open since Lambda may still be streaming.
        console.warn('sendMessage mutation error (streaming may continue):', error);
      }
    }
  })();

  return { promise: resultPromise, cancel };
}

// Re-export isConfigured
export function isConfigured(): boolean {
  return isAppSyncConfigured();
}
