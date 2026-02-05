/**
 * User Service - Maps external auth provider user IDs (e.g., Clerk) to internal user IDs.
 *
 * This decouples our data model from the auth provider, making future migrations easier.
 * External IDs are stored with a provider prefix (e.g., EXTUSER#clerk#{clerkId}) to support
 * multiple auth providers in the future.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME!;

// Auth provider identifiers
export type AuthProvider = 'clerk';

export interface UserMapping {
  internalUserId: string;
  externalUserId: string;
  authProvider: AuthProvider;
  createdAt: string;
}

export interface InternalUser {
  internalUserId: string;
  authProvider: AuthProvider;
  externalUserId: string;
  createdAt: string;
}

/**
 * Get or create an internal user ID for an external auth provider user.
 * This is the main entry point for user resolution.
 *
 * @param externalUserId - The user ID from the auth provider (e.g., Clerk's sub claim)
 * @param authProvider - The auth provider identifier (defaults to 'clerk')
 * @returns The internal user ID (UUID)
 */
export async function getOrCreateInternalUserId(
  externalUserId: string,
  authProvider: AuthProvider = 'clerk'
): Promise<string> {
  // First, try to get existing mapping
  const existingMapping = await getUserMapping(externalUserId, authProvider);
  if (existingMapping) {
    return existingMapping.internalUserId;
  }

  // No mapping exists, create a new internal user
  const internalUserId = randomUUID();
  const now = new Date().toISOString();

  // Create the external-to-internal mapping
  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `EXTUSER#${authProvider}#${externalUserId}`,
          SK: 'MAPPING',
          internalUserId,
          externalUserId,
          authProvider,
          createdAt: now,
        },
        // Only create if it doesn't exist (handles race conditions)
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );
  } catch (error) {
    // If condition failed, another request created the mapping - fetch and return it
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      const mapping = await getUserMapping(externalUserId, authProvider);
      if (mapping) {
        return mapping.internalUserId; // Early return from function
      }
    }
    throw error;
  }

  // Create the internal user record
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `IUSER#${internalUserId}`,
        SK: 'PROFILE',
        internalUserId,
        authProvider,
        externalUserId,
        createdAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  ).catch((error) => {
    // Ignore if already exists (from race condition handling above)
    if (error.name !== 'ConditionalCheckFailedException') {
      throw error;
    }
  });

  console.log(`Created new internal user ${internalUserId} for ${authProvider}:${externalUserId}`);
  return internalUserId;
}

/**
 * Get the mapping from external user ID to internal user ID.
 */
async function getUserMapping(
  externalUserId: string,
  authProvider: AuthProvider
): Promise<UserMapping | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `EXTUSER#${authProvider}#${externalUserId}`,
        SK: 'MAPPING',
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return {
    internalUserId: result.Item.internalUserId as string,
    externalUserId: result.Item.externalUserId as string,
    authProvider: result.Item.authProvider as AuthProvider,
    createdAt: result.Item.createdAt as string,
  };
}

/**
 * Get an internal user by their internal user ID.
 */
export async function getInternalUser(
  internalUserId: string
): Promise<InternalUser | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `IUSER#${internalUserId}`,
        SK: 'PROFILE',
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return {
    internalUserId: result.Item.internalUserId as string,
    authProvider: result.Item.authProvider as AuthProvider,
    externalUserId: result.Item.externalUserId as string,
    createdAt: result.Item.createdAt as string,
  };
}

/**
 * Resolve the internal user ID from an AppSync event identity.
 * This is the convenience method for Lambda handlers.
 *
 * @param identity - The identity object from the AppSync event
 * @returns The internal user ID
 */
export async function resolveInternalUserId(
  identity: { sub: string }
): Promise<string> {
  return getOrCreateInternalUserId(identity.sub, 'clerk');
}
