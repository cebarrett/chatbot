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
  const { limit = 50, nextToken } = event.arguments;

  // Resolve internal user ID from Clerk ID (creates mapping if first login)
  const internalUserId = await resolveInternalUserId(event.identity);

  console.log(`Listing chats for user ${internalUserId}`);

  // Query user's chats from the user-chat index
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${internalUserId}`,
        ':sk': 'CHAT#',
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit,
      ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined,
    })
  );

  const chats: Chat[] = (result.Items || []).map((item) => ({
    chatId: item.chatId as string,
    title: item.title as string,
    providerId: (item.providerId as string) || 'claude',
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    messageCount: (item.messageCount as number) || 0,
  }));

  // Encode the next token for pagination
  const encodedNextToken = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return {
    chats,
    nextToken: encodedNextToken,
  };
}
