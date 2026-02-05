/**
 * Lambda resolver for creating a new chat.
 * Resolves the internal user ID before creating the chat.
 */

import { AppSyncEvent } from './types';
import { resolveInternalUserId } from './userService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

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

  // Create both the chat metadata and user-chat index items using TransactWrite
  // to ensure atomicity and allow condition expressions to prevent overwrites
  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Chat metadata item
          // Stores both internalUserId (for data organization) and clerkId (for VTL auth)
          // ConditionExpression prevents overwriting existing chats (security fix)
          {
            Put: {
              TableName: TABLE_NAME,
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
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          // User-chat index item (for listing user's chats)
          // Uses internal user ID for partition key (decoupled from auth provider)
          {
            Put: {
              TableName: TABLE_NAME,
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
      })
    );
  } catch (error: unknown) {
    // Handle the case where a chat with this ID already exists
    if (
      error instanceof Error &&
      error.name === 'TransactionCanceledException'
    ) {
      const txError = error as Error & {
        CancellationReasons?: Array<{ Code?: string }>;
      };
      // Check if the first item (chat metadata) failed due to condition check
      if (txError.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed') {
        throw new Error(`Chat with ID ${chatId} already exists`);
      }
    }
    throw error;
  }

  return {
    chatId,
    title,
    providerId,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
}
