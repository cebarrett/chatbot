// User preferences service - DynamoDB-backed via AppSync GraphQL
// Preferences are stored as an opaque JSON object; the frontend owns the schema.
// localStorage is used as a write-through cache for fast initial loads.

import { executeGraphQL, isAppSyncConfigured } from './appsyncClient';
import {
  GET_USER_PREFERENCES_QUERY,
  UPDATE_USER_PREFERENCES_MUTATION,
} from '../graphql/operations';
import type {
  UserPreferencesResult,
  UpdateUserPreferencesInput,
} from '../graphql/operations';

const STORAGE_KEY = 'chatbot_user_preferences';

// --- localStorage cache ---

export function loadCachedPreferences(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore corrupt cache
  }
  return {};
}

function writeCachePreferences(prefs: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage full or unavailable — not critical
  }
}

// --- GraphQL operations ---

export async function fetchPreferences(): Promise<Record<string, unknown>> {
  if (!isAppSyncConfigured()) return loadCachedPreferences();

  const data = await executeGraphQL<{ getUserPreferences: UserPreferencesResult }>(
    GET_USER_PREFERENCES_QUERY
  );

  const prefs = JSON.parse(data.getUserPreferences.preferences) as Record<string, unknown>;
  writeCachePreferences(prefs);
  return prefs;
}

export async function savePreferences(
  prefs: Record<string, unknown>
): Promise<void> {
  // Write to cache immediately for fast reads
  writeCachePreferences(prefs);

  if (!isAppSyncConfigured()) return;

  const input: UpdateUserPreferencesInput = {
    preferences: JSON.stringify(prefs),
  };

  await executeGraphQL<{ updateUserPreferences: UserPreferencesResult }>(
    UPDATE_USER_PREFERENCES_MUTATION,
    { input }
  );
}
