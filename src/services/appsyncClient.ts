// AppSync client for GraphQL operations with WebSocket subscriptions
import { getAppSyncConfig, isAppSyncConfigured } from '../config/appsync';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

// Execute a GraphQL mutation or query
export async function executeGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const config = getAppSyncConfig();

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphQL request failed: ${response.status} ${text}`);
  }

  const result: GraphQLResponse<T> = await response.json();

  if (result.errors && result.errors.length > 0) {
    throw new Error(`GraphQL errors: ${result.errors.map((e) => e.message).join(', ')}`);
  }

  if (!result.data) {
    throw new Error('No data returned from GraphQL');
  }

  return result.data;
}

// WebSocket subscription connection
interface SubscriptionConnection {
  close: () => void;
}

interface SubscriptionCallbacks<T> {
  onData: (data: T) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}

// Create a WebSocket subscription to AppSync
export function createSubscription<T>(
  subscription: string,
  variables: Record<string, unknown>,
  callbacks: SubscriptionCallbacks<T>
): SubscriptionConnection {
  const config = getAppSyncConfig();

  // Convert HTTPS endpoint to WSS for real-time
  const realtimeEndpoint = config.endpoint
    .replace('https://', 'wss://')
    .replace('/graphql', '/graphql/realtime');

  // Encode the header and payload for AppSync real-time
  const header = btoa(
    JSON.stringify({
      host: new URL(config.endpoint).host,
      'x-api-key': config.apiKey,
    })
  );

  const payload = btoa(JSON.stringify({}));

  const wsUrl = `${realtimeEndpoint}?header=${header}&payload=${payload}`;

  const ws = new WebSocket(wsUrl, ['graphql-ws']);

  let isConnected = false;
  let subscriptionId: string | null = null;

  ws.onopen = () => {
    // Send connection init
    ws.send(JSON.stringify({ type: 'connection_init' }));
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    switch (message.type) {
      case 'connection_ack':
        isConnected = true;
        // Now send the subscription
        subscriptionId = crypto.randomUUID();
        ws.send(
          JSON.stringify({
            id: subscriptionId,
            type: 'start',
            payload: {
              data: JSON.stringify({ query: subscription, variables }),
              extensions: {
                authorization: {
                  host: new URL(config.endpoint).host,
                  'x-api-key': config.apiKey,
                },
              },
            },
          })
        );
        break;

      case 'data':
        if (message.payload?.data) {
          // Extract the subscription field data
          const data = Object.values(message.payload.data)[0] as T;
          callbacks.onData(data);
        }
        break;

      case 'error':
        console.error('Subscription error:', message.payload);
        callbacks.onError?.(new Error(JSON.stringify(message.payload)));
        break;

      case 'complete':
        callbacks.onComplete?.();
        break;

      case 'ka':
        // Keep-alive, ignore
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    callbacks.onError?.(new Error('WebSocket connection error'));
  };

  ws.onclose = () => {
    if (isConnected) {
      callbacks.onComplete?.();
    }
  };

  return {
    close: () => {
      if (subscriptionId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: subscriptionId, type: 'stop' }));
      }
      ws.close();
    },
  };
}

// Check if AppSync is configured
export { isAppSyncConfigured };
