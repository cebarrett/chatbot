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

// Strip numeric-string keys from preferences — these are the hallmark of a
// past bug where spreading a string (`{...jsonString, key:val}`) indexed each
// character by position, bloating the object to hundreds of junk entries.
// Stripping them is safe: no real preference key is a plain integer string.
function sanitizePreferences(prefs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(prefs).filter(([key]) => isNaN(Number(key)))
  );
}

// --- localStorage cache ---

export function loadCachedPreferences(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return sanitizePreferences(parsed as Record<string, unknown>);
      }
    }
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

  // AppSync VTL serializes the Lambda result with $util.toJson, so the
  // `preferences` AWSJSON field arrives as a JSON string in the HTTP response.
  // Guard against it arriving as an already-parsed object just in case.
  const raw = data.getUserPreferences.preferences as unknown;
  let prefs: Record<string, unknown>;
  if (typeof raw === 'string') {
    prefs = JSON.parse(raw) as Record<string, unknown>;
  } else if (raw !== null && typeof raw === 'object') {
    prefs = raw as Record<string, unknown>;
  } else {
    prefs = {};
  }

  // Sanitize before caching and returning — removes any corruption from the
  // past string-spread bug so it can never re-enter the React state or be
  // sent back to AppSync.
  const sanitized = sanitizePreferences(prefs);
  writeCachePreferences(sanitized);
  return sanitized;
}

export async function savePreferences(
  prefs: Record<string, unknown>
): Promise<void> {
  // Sanitize before saving to guarantee we never write or send bloated prefs.
  const sanitized = sanitizePreferences(prefs);

  // Write to cache immediately for fast reads
  writeCachePreferences(sanitized);

  if (!isAppSyncConfigured()) return;

  const input: UpdateUserPreferencesInput = {
    preferences: JSON.stringify(sanitized),
  };

  await executeGraphQL<{ updateUserPreferences: UserPreferencesResult }>(
    UPDATE_USER_PREFERENCES_MUTATION,
    { input }
  );
}
