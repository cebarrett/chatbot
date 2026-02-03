import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { MessageChunk } from './types';

const APPSYNC_URL = process.env.APPSYNC_URL;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const PUBLISH_CHUNK_MUTATION = `
  mutation PublishChunk($requestId: String!, $userId: String!, $chunk: String!, $done: Boolean!, $sequence: Int!, $error: String) {
    publishChunk(requestId: $requestId, userId: $userId, chunk: $chunk, done: $done, sequence: $sequence, error: $error) {
      requestId
      userId
      chunk
      done
      sequence
      error
    }
  }
`;

// Create a SigV4 signer for AppSync
const signer = new SignatureV4({
  credentials: defaultProvider(),
  region: AWS_REGION,
  service: 'appsync',
  sha256: Sha256,
});

export async function publishChunk(
  requestId: string,
  userId: string,
  chunk: string,
  done: boolean,
  sequence: number,
  error?: string
): Promise<MessageChunk> {
  if (!APPSYNC_URL) {
    throw new Error('APPSYNC_URL environment variable not set');
  }

  const url = new URL(APPSYNC_URL);
  const body = JSON.stringify({
    query: PUBLISH_CHUNK_MUTATION,
    variables: {
      requestId,
      userId,
      chunk,
      done,
      sequence,
      error: error || null,
    },
  });

  // Create the HTTP request for signing
  const request = new HttpRequest({
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      'Content-Type': 'application/json',
      host: url.hostname,
    },
    body,
  });

  // Sign the request with IAM credentials
  const signedRequest = await signer.sign(request);

  // Make the request
  const response = await fetch(APPSYNC_URL, {
    method: 'POST',
    headers: signedRequest.headers as Record<string, string>,
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AppSync request failed: ${response.status} ${text}`);
  }

  const result: any = await response.json();

  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data.publishChunk;
}
