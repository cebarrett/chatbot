import { AppSyncEvent } from './types';

// DynamoDB DocumentClient via AWS SDK v3
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchWriteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME!;

interface DeleteChatArgs {
  chatId: string;
}

interface DeleteChatResult {
  chatId: string;
  success: boolean;
}

export async function handler(
  event: AppSyncEvent<DeleteChatArgs>
): Promise<DeleteChatResult> {
  const { chatId } = event.arguments;
  const userId = event.identity.sub;

  console.log(`Deleting chat ${chatId} for user ${userId}`);

  // Step 1: Verify chat ownership
  const metaResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CHAT#${chatId}`, SK: 'META' },
    })
  );

  if (!metaResult.Item) {
    throw new Error('Chat not found');
  }

  if (metaResult.Item.userId !== userId) {
    throw new Error('Unauthorized');
  }

  // Step 2: Query all items with PK = CHAT#{chatId} (metadata + all messages)
  const chatItems: Array<{ PK: string; SK: string }> = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `CHAT#${chatId}` },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (queryResult.Items) {
      chatItems.push(
        ...queryResult.Items.map((item) => ({
          PK: item.PK as string,
          SK: item.SK as string,
        }))
      );
    }

    lastEvaluatedKey = queryResult.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (lastEvaluatedKey);

  // Step 3: Find and add the user-chat index item
  // Query USER#{userId} partition for the entry matching this chatId
  const indexResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'chatId = :chatId',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'CHAT#',
        ':chatId': chatId,
      },
      ProjectionExpression: 'PK, SK, chatId',
    })
  );

  if (indexResult.Items) {
    chatItems.push(
      ...indexResult.Items.map((item) => ({
        PK: item.PK as string,
        SK: item.SK as string,
      }))
    );
  }

  // Step 4: Batch delete all items (DynamoDB allows 25 per batch)
  const BATCH_SIZE = 25;
  for (let i = 0; i < chatItems.length; i += BATCH_SIZE) {
    const batch = chatItems.slice(i, i + BATCH_SIZE);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((item) => ({
            DeleteRequest: {
              Key: { PK: item.PK, SK: item.SK },
            },
          })),
        },
      })
    );
  }

  console.log(
    `Deleted ${chatItems.length} items for chat ${chatId}`
  );

  return { chatId, success: true };
}
