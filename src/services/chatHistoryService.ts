// Chat history service - DynamoDB-backed via AppSync GraphQL
// Replaces localStorage-based chatStorage.ts

import { executeGraphQL, isAppSyncConfigured } from './appsyncClient';
import {
  LIST_CHATS_QUERY,
  GET_CHAT_QUERY,
  CREATE_CHAT_MUTATION,
  UPDATE_CHAT_MUTATION,
  DELETE_CHAT_MUTATION,
  SAVE_MESSAGE_MUTATION,
  UPDATE_MESSAGE_MUTATION,
} from '../graphql/operations';
import type {
  ChatSummary,
  ChatDetail,
  ChatListResult,
  DeleteChatResult,
  CreateChatInput,
  SaveMessageInput,
  UpdateMessageInput,
  UpdateChatInput,
  StoredMessage,
} from '../graphql/operations';
import type { Chat, Message, JudgeRatings } from '../types';

// Convert GraphQL ChatSummary to frontend Chat (without messages)
function chatSummaryToChat(summary: ChatSummary): Chat {
  return {
    id: summary.chatId,
    title: summary.title,
    messages: [],
    createdAt: new Date(summary.createdAt),
    updatedAt: new Date(summary.updatedAt),
    providerId: summary.providerId || undefined,
  };
}

// Convert GraphQL StoredMessage to frontend Message
function storedMessageToMessage(stored: StoredMessage): Message {
  let judgeRatings: JudgeRatings | undefined;
  if (stored.judgeRatings) {
    try {
      judgeRatings = JSON.parse(stored.judgeRatings);
    } catch {
      // Ignore parse errors for judge ratings
    }
  }

  return {
    id: stored.messageId,
    content: stored.content,
    role: stored.role,
    timestamp: new Date(stored.timestamp),
    judgeRatings,
  };
}

// Convert GraphQL ChatDetail to frontend Chat
function chatDetailToChat(detail: ChatDetail): Chat {
  return {
    id: detail.chatId,
    title: detail.title,
    messages: detail.messages.map(storedMessageToMessage),
    createdAt: new Date(detail.createdAt),
    updatedAt: new Date(detail.updatedAt),
    providerId: detail.providerId || undefined,
  };
}

// List all chats for the current user (sidebar display)
export async function listChats(
  limit?: number,
  nextToken?: string
): Promise<{ chats: Chat[]; nextToken: string | null }> {
  const data = await executeGraphQL<{ listChats: ChatListResult }>(
    LIST_CHATS_QUERY,
    { limit, nextToken }
  );

  return {
    chats: data.listChats.chats.map(chatSummaryToChat),
    nextToken: data.listChats.nextToken,
  };
}

// Get a single chat with all its messages
export async function getChat(
  chatId: string,
  messageLimit?: number,
  messageNextToken?: string
): Promise<Chat | null> {
  const data = await executeGraphQL<{ getChat: ChatDetail | null }>(
    GET_CHAT_QUERY,
    { chatId, messageLimit, messageNextToken }
  );

  if (!data.getChat) return null;
  return chatDetailToChat(data.getChat);
}

// Create a new chat
export async function createChat(input: CreateChatInput): Promise<Chat> {
  const data = await executeGraphQL<{ createChat: ChatSummary }>(
    CREATE_CHAT_MUTATION,
    { input }
  );

  return chatSummaryToChat(data.createChat);
}

// Update chat metadata (title, provider)
export async function updateChat(input: UpdateChatInput): Promise<void> {
  await executeGraphQL<{ updateChat: ChatSummary }>(
    UPDATE_CHAT_MUTATION,
    { input }
  );
}

// Delete a chat and all its messages
export async function deleteChat(chatId: string): Promise<void> {
  await executeGraphQL<{ deleteChat: DeleteChatResult }>(
    DELETE_CHAT_MUTATION,
    { chatId }
  );
}

// Save a message to a chat
export async function saveMessage(input: SaveMessageInput): Promise<void> {
  await executeGraphQL<{ saveMessage: StoredMessage }>(
    SAVE_MESSAGE_MUTATION,
    { input }
  );
}

// Update a message (content or judge ratings)
export async function updateMessage(input: UpdateMessageInput): Promise<void> {
  await executeGraphQL<{ updateMessage: StoredMessage }>(
    UPDATE_MESSAGE_MUTATION,
    { input }
  );
}

// Generate a chat title from the first user message
export function generateChatTitle(messages: Message[]): string {
  const firstUserMessage = messages.find((m) => m.role === 'user');
  if (!firstUserMessage) return 'New Chat';
  const content = firstUserMessage.content;
  return content.length > 30 ? content.slice(0, 30) + '...' : content;
}

// Re-export for convenience
export { isAppSyncConfigured };
