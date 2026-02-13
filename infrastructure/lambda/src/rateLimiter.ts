import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME!;

const MAX_DAILY_REQUESTS = parseInt(process.env.RATE_LIMIT_DAILY_REQUESTS || '200', 10);
const MAX_DAILY_TOKENS = parseInt(process.env.RATE_LIMIT_DAILY_TOKENS || '2000000', 10);

export class RateLimitError extends Error {
  readonly code = 'RATE_LIMIT_EXCEEDED';

  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
}

function getTtlEpoch(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2));
  return Math.floor(tomorrow.getTime() / 1000);
}

/**
 * Check if the user is within their daily token budget.
 * This is a read-only soft check — call before checkAndIncrementRequestCount
 * so that a token-budget rejection doesn't burn a request slot.
 */
export async function checkTokenBudget(internalUserId: string): Promise<void> {
  const todayKey = getTodayKey();

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `RATELIMIT#${internalUserId}`,
        SK: `DAILY#${todayKey}`,
      },
      ProjectionExpression: 'tokenCount',
    })
  );

  const tokenCount = (result.Item?.tokenCount as number) || 0;
  if (tokenCount >= MAX_DAILY_TOKENS) {
    throw new RateLimitError(
      "You've reached today's usage limit. Come back tomorrow!"
    );
  }
}

/**
 * Atomically increment the user's daily request count and reject if over the cap.
 * Uses a conditional UpdateItem so the check-and-increment is a single atomic operation.
 */
export async function checkAndIncrementRequestCount(internalUserId: string): Promise<void> {
  const todayKey = getTodayKey();
  const ttl = getTtlEpoch();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `RATELIMIT#${internalUserId}`,
          SK: `DAILY#${todayKey}`,
        },
        UpdateExpression: 'ADD requestCount :one SET #ttl = if_not_exists(#ttl, :ttlVal), updatedAt = :now',
        ConditionExpression: 'attribute_not_exists(requestCount) OR requestCount < :maxRequests',
        ExpressionAttributeNames: {
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':one': 1,
          ':ttlVal': ttl,
          ':now': new Date().toISOString(),
          ':maxRequests': MAX_DAILY_REQUESTS,
        },
      })
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      throw new RateLimitError(
        "You've reached today's limit of " + MAX_DAILY_REQUESTS + " requests. Come back tomorrow!"
      );
    }
    throw error;
  }
}

/**
 * Record token usage for the user's daily budget tracking.
 * Callers must wrap this in try/catch and log failures silently.
 */
export async function recordTokenUsage(internalUserId: string, tokenCount: number): Promise<void> {
  if (tokenCount <= 0) return;

  const todayKey = getTodayKey();
  const ttl = getTtlEpoch();

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `RATELIMIT#${internalUserId}`,
        SK: `DAILY#${todayKey}`,
      },
      UpdateExpression: 'ADD tokenCount :tokens SET #ttl = if_not_exists(#ttl, :ttlVal), updatedAt = :now',
      ExpressionAttributeNames: {
        '#ttl': 'ttl',
      },
      ExpressionAttributeValues: {
        ':tokens': tokenCount,
        ':ttlVal': ttl,
        ':now': new Date().toISOString(),
      },
    })
  );
}
