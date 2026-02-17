/**
 * Lambda resolver for listing user's chats.
 * Resolves the internal user ID before querying chats.
 */

import { AppSyncEvent } from './types';
import { resolveInternalUserId } from './userService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME!;

interface ListChatsArgs {
  limit?: number;
  nextToken?: string;
}

interface Chat {
  chatId: string;
  title: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface ChatListResult {
  chats: Chat[];
  nextToken?: string;
}

export async function handler(
  event: AppSyncEvent<ListChatsArgs>
): Promise<ChatListResult> {
  const { limit: rawLimit, nextToken } = event.arguments;
  const limit = rawLimit ?? 50;

  // Resolve internal user ID from Clerk ID (creates mapping if first login)
  const internalUserId = await resolveInternalUserId(event.identity);

  console.log(`Listing chats for user ${internalUserId}`);

  // Query user's chats from the user-chat index
  // Fetch all index entries (no server-side limit) so we can deduplicate and sort client-side.
  // Index entries now use SK = CHAT#${chatId} (stable), but legacy entries may use
  // SK = CHAT#${updatedAt}#${chatId} from before the fix, so we deduplicate by chatId
  // and keep the entry with the latest updatedAt.
  const allItems: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${internalUserId}`,
          ':sk': 'CHAT#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      allItems.push(...result.Items);
    }
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  // Deduplicate by chatId — keep the entry with the latest updatedAt.
  // This handles both legacy duplicate entries and the old-to-new SK format transition.
  const chatMap = new Map<string, Chat>();
  for (const item of allItems) {
    const chatId = item.chatId as string;
    const chat: Chat = {
      chatId,
      title: item.title as string,
      providerId: (item.providerId as string) || 'claude',
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
      messageCount: (item.messageCount as number) || 0,
    };
    const existing = chatMap.get(chatId);
    if (!existing || chat.updatedAt > existing.updatedAt) {
      chatMap.set(chatId, chat);
    }
  }

  // Sort by updatedAt descending (most recent first)
  const chats = Array.from(chatMap.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // Apply pagination in-memory
  const startIndex = nextToken ? parseInt(Buffer.from(nextToken, 'base64').toString(), 10) : 0;
  const page = chats.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < chats.length;
  const encodedNextToken = hasMore
    ? Buffer.from(String(startIndex + limit)).toString('base64')
    : undefined;

  return {
    chats: page,
    nextToken: encodedNextToken,
  };
}
