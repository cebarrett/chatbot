import { MessageChunk } from './types';

const APPSYNC_URL = process.env.APPSYNC_URL;
const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY;

const PUBLISH_CHUNK_MUTATION = `
  mutation PublishChunk($requestId: String!, $chunk: String!, $done: Boolean!, $error: String) {
    publishChunk(requestId: $requestId, chunk: $chunk, done: $done, error: $error) {
      requestId
      chunk
      done
      error
    }
  }
`;

export async function publishChunk(
  requestId: string,
  chunk: string,
  done: boolean,
  error?: string
): Promise<MessageChunk> {
  if (!APPSYNC_URL || !APPSYNC_API_KEY) {
    throw new Error('AppSync configuration missing');
  }

  const response = await fetch(APPSYNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': APPSYNC_API_KEY,
    },
    body: JSON.stringify({
      query: PUBLISH_CHUNK_MUTATION,
      variables: {
        requestId,
        chunk,
        done,
        error: error || null,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AppSync request failed: ${response.status} ${text}`);
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data.publishChunk;
}
