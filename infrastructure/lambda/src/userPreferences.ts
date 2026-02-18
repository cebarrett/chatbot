/**
 * Lambda resolver for user preferences.
 * Stores per-user preferences as a JSON blob in DynamoDB (IUSER#{id} / PREFS).
 * The preferences object is opaque to the backend — the frontend owns the schema.
 */

import { AppSyncEvent } from './types';
import { resolveInternalUserId } from './userService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME!;

interface UserPreferencesResult {
  preferences: string; // AWSJSON - serialized JSON string
  updatedAt: string;
}

// --- getUserPreferences ---

type GetPreferencesArgs = Record<string, never>;

export async function getHandler(
  event: AppSyncEvent<GetPreferencesArgs>
): Promise<UserPreferencesResult> {
  const internalUserId = await resolveInternalUserId(event.identity);

  console.log(`Getting preferences for user ${internalUserId}`);

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `IUSER#${internalUserId}`,
        SK: 'PREFS',
      },
    })
  );

  if (!result.Item) {
    // Return empty preferences for new users
    return {
      preferences: '{}',
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    preferences: result.Item.preferences as string,
    updatedAt: result.Item.updatedAt as string,
  };
}

// --- updateUserPreferences ---

interface UpdatePreferencesArgs {
  input: {
    preferences: string | Record<string, unknown>; // AWSJSON – may arrive as object after AppSync deserialization
  };
}

export async function updateHandler(
  event: AppSyncEvent<UpdatePreferencesArgs>
): Promise<UserPreferencesResult> {
  const internalUserId = await resolveInternalUserId(event.identity);
  const raw = event.arguments.input.preferences;

  // AppSync deserializes AWSJSON inputs into native objects before the VTL
  // template forwards them to Lambda, so `raw` may already be an object.
  // Normalise to a JSON string for storage.
  let preferences: string;
  if (typeof raw === 'string') {
    // Validate that the string is valid JSON
    try {
      JSON.parse(raw);
    } catch {
      throw new Error('Invalid JSON in preferences');
    }
    preferences = raw;
  } else if (raw !== null && typeof raw === 'object') {
    preferences = JSON.stringify(raw);
  } else {
    throw new Error('Invalid JSON in preferences');
  }

  console.log(`Updating preferences for user ${internalUserId}`);

  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `IUSER#${internalUserId}`,
        SK: 'PREFS',
        internalUserId,
        preferences,
        updatedAt: now,
      },
    })
  );

  return {
    preferences,
    updatedAt: now,
  };
}
