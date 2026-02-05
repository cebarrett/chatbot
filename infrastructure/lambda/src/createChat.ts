/**
 * Lambda resolver for creating a new chat.
 * Resolves the internal user ID before creating the chat.
 */

import { AppSyncEvent } from './types';
import { resolveInternalUserId } from './userService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME!;

interface CreateChatInput {
  chatId: string;
  title: string;
  providerId?: string;
}

interface CreateChatArgs {
  input: CreateChatInput;
}

interface Chat {
  chatId: string;
  title: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export async function handler(
  event: AppSyncEvent<CreateChatArgs>
): Promise<Chat> {
  const { input } = event.arguments;
  const { chatId, title, providerId = 'claude' } = input;

  // Get external (Clerk) user ID for VTL auth checks
  const clerkId = event.identity.sub;

  // Resolve internal user ID from Clerk ID (creates mapping if first login)
  const internalUserId = await resolveInternalUserId(event.identity);

  console.log(`Creating chat ${chatId} for internalUser: ${internalUserId}, clerkId: ${clerkId}`);

  const now = new Date().toISOString();

  // Create both the chat metadata and user-chat index items
  await docClient.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: [
          // Chat metadata item
          // Stores both internalUserId (for data organization) and clerkId (for VTL auth)
          {
            PutRequest: {
              Item: {
                PK: `CHAT#${chatId}`,
                SK: 'META',
                internalUserId,
                clerkId, // For VTL authorization checks (can compare with $context.identity.sub)
                chatId,
                title,
                providerId,
                createdAt: now,
                updatedAt: now,
                messageCount: 0,
              },
            },
          },
          // User-chat index item (for listing user's chats)
          // Uses internal user ID for partition key (decoupled from auth provider)
          {
            PutRequest: {
              Item: {
                PK: `USER#${internalUserId}`,
                SK: `CHAT#${now}#${chatId}`,
                chatId,
                title,
                providerId,
                createdAt: now,
                updatedAt: now,
                messageCount: 0,
              },
            },
          },
        ],
      },
    })
  );

  return {
    chatId,
    title,
    providerId,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
}
