// AppSync client for GraphQL operations with WebSocket subscriptions
// Uses Clerk JWT tokens for OIDC authentication
import { getAppSyncConfig, isAppSyncConfigured } from '../config/appsync';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

// Token provider function type - will be set by the auth context
type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;

// Set the token provider (called from auth context)
export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

// Get the current auth token
async function getAuthToken(): Promise<string> {
  if (!tokenProvider) {
    throw new Error('Token provider not set. Ensure auth context is initialized.');
  }

  const token = await tokenProvider();
  if (!token) {
    throw new Error('No auth token available. User may not be signed in.');
  }

  return token;
}

// Execute a GraphQL mutation or query
export async function executeGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const config = getAppSyncConfig();
  const token = await getAuthToken();

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
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

// Create a WebSocket subscription to AppSync with OIDC auth
export async function createSubscription<T>(
  subscription: string,
  variables: Record<string, unknown>,
  callbacks: SubscriptionCallbacks<T>
): Promise<SubscriptionConnection> {
  const config = getAppSyncConfig();
  const token = await getAuthToken();

  // Convert HTTPS endpoint to WSS for real-time
  const realtimeEndpoint = config.endpoint
    .replace('https://', 'wss://')
    .replace('/graphql', '/graphql/realtime');

  // Encode the header for AppSync real-time with OIDC auth
  const header = btoa(
    JSON.stringify({
      host: new URL(config.endpoint).host,
      Authorization: token,
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
                  Authorization: token,
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
