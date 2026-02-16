// GraphQL operations for AppSync

export const SEND_MESSAGE_MUTATION = `
  mutation SendMessage($input: SendMessageInput!) {
    sendMessage(input: $input) {
      requestId
      status
      message
    }
  }
`;

export const PUBLISH_CHUNK_MUTATION = `
  mutation PublishChunk($requestId: String!, $userId: String!, $chunk: String!, $done: Boolean!, $sequence: Int!, $error: String) {
    publishChunk(requestId: $requestId, userId: $userId, chunk: $chunk, done: $done, sequence: $sequence, error: $error) {
      requestId
      userId
      chunk
      done
      sequence
      error
    }
  }
`;

export const JUDGE_RESPONSE_MUTATION = `
  mutation JudgeResponse($input: JudgeInput!) {
    judgeResponse(input: $input) {
      score
      explanation
      problems
      judgeProvider
    }
  }
`;

export const JUDGE_FOLLOW_UP_MUTATION = `
  mutation JudgeFollowUp($input: JudgeFollowUpInput!) {
    judgeFollowUp(input: $input) {
      answer
      judgeProvider
    }
  }
`;

export const ON_MESSAGE_CHUNK_SUBSCRIPTION = `
  subscription OnMessageChunk($requestId: String!, $userId: String!) {
    onMessageChunk(requestId: $requestId, userId: $userId) {
      requestId
      userId
      chunk
      done
      sequence
      error
    }
  }
`;

export const HEALTH_QUERY = `
  query Health {
    health
  }
`;

// Chat History operations

export const LIST_CHATS_QUERY = `
  query ListChats($limit: Int, $nextToken: String) {
    listChats(limit: $limit, nextToken: $nextToken) {
      chats {
        chatId
        title
        providerId
        createdAt
        updatedAt
        messageCount
      }
      nextToken
    }
  }
`;

export const GET_CHAT_QUERY = `
  query GetChat($chatId: String!, $messageLimit: Int, $messageNextToken: String) {
    getChat(chatId: $chatId, messageLimit: $messageLimit, messageNextToken: $messageNextToken) {
      chatId
      title
      providerId
      createdAt
      updatedAt
      messages {
        messageId
        role
        content
        timestamp
        judgeRatings
      }
      nextToken
    }
  }
`;

export const CREATE_CHAT_MUTATION = `
  mutation CreateChat($input: CreateChatInput!) {
    createChat(input: $input) {
      chatId
      title
      providerId
      createdAt
      updatedAt
      messageCount
    }
  }
`;

export const UPDATE_CHAT_MUTATION = `
  mutation UpdateChat($input: UpdateChatInput!) {
    updateChat(input: $input) {
      chatId
      title
      providerId
      createdAt
      updatedAt
      messageCount
    }
  }
`;

export const DELETE_CHAT_MUTATION = `
  mutation DeleteChat($chatId: String!) {
    deleteChat(chatId: $chatId) {
      chatId
      success
    }
  }
`;

export const SAVE_MESSAGE_MUTATION = `
  mutation SaveMessage($input: SaveMessageInput!) {
    saveMessage(input: $input) {
      messageId
      role
      content
      timestamp
      judgeRatings
    }
  }
`;

export const UPDATE_MESSAGE_MUTATION = `
  mutation UpdateMessage($input: UpdateMessageInput!) {
    updateMessage(input: $input) {
      messageId
      role
      content
      timestamp
      judgeRatings
    }
  }
`;

export const DELETE_MESSAGE_MUTATION = `
  mutation DeleteMessage($input: DeleteMessageInput!) {
    deleteMessage(input: $input) {
      messageId
      success
    }
  }
`;

// User Preferences operations

export const GET_USER_PREFERENCES_QUERY = `
  query GetUserPreferences {
    getUserPreferences {
      preferences
      updatedAt
    }
  }
`;

export const UPDATE_USER_PREFERENCES_MUTATION = `
  mutation UpdateUserPreferences($input: UpdateUserPreferencesInput!) {
    updateUserPreferences(input: $input) {
      preferences
      updatedAt
    }
  }
`;

export const TRANSCRIBE_AUDIO_MUTATION = `
  mutation TranscribeAudio($input: TranscribeAudioInput!) {
    transcribeAudio(input: $input) {
      text
      duration
    }
  }
`;

// Types matching the GraphQL schema
export type ChatProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'PERPLEXITY' | 'GROK';

export interface ChatMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface SendMessageInput {
  requestId: string;
  provider: ChatProvider;
  messages: ChatMessageInput[];
  model?: string;
}

export interface SendMessageResponse {
  requestId: string;
  status: string;
  message?: string;
}

export interface MessageChunk {
  requestId: string;
  userId: string;
  chunk: string;
  done: boolean;
  sequence: number;
  error?: string;
}

export interface JudgeInput {
  judgeProvider: ChatProvider;
  originalPrompt: string;
  responseToJudge: string;
  respondingProvider: string;
  conversationHistory?: ChatMessageInput[];
  model?: string;
}

export interface JudgeResponse {
  score: number;
  explanation: string;
  problems: string[];
  judgeProvider: string;
}

export interface JudgeFollowUpInput {
  judgeProvider: ChatProvider;
  originalPrompt: string;
  responseToJudge: string;
  respondingProvider: string;
  conversationHistory?: ChatMessageInput[];
  previousScore: number;
  previousExplanation: string;
  previousProblems: string[];
  followUpQuestion: string;
  model?: string;
}

export interface JudgeFollowUpResponse {
  answer: string;
  judgeProvider: string;
}

// Chat History types

export interface ChatSummary {
  chatId: string;
  title: string;
  providerId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number | null;
}

export interface StoredMessage {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  judgeRatings: string | null; // AWSJSON - serialized JSON string
}

export interface ChatDetail {
  chatId: string;
  title: string;
  providerId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
  nextToken: string | null;
}

export interface ChatListResult {
  chats: ChatSummary[];
  nextToken: string | null;
}

export interface DeleteChatResult {
  chatId: string;
  success: boolean;
}

export interface CreateChatInput {
  chatId: string;
  title: string;
  providerId?: string;
}

export interface SaveMessageInput {
  chatId: string;
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface UpdateMessageInput {
  chatId: string;
  messageId: string;
  content?: string;
  judgeRatings?: string; // AWSJSON
  timestamp: string;
}

export interface UpdateChatInput {
  chatId: string;
  title?: string;
  providerId?: string;
}

export interface DeleteMessageInput {
  chatId: string;
  messageId: string;
  timestamp: string;
}

export interface DeleteMessageResult {
  messageId: string;
  success: boolean;
}

// User Preferences types

export interface UserPreferencesResult {
  preferences: string; // AWSJSON - serialized JSON string
  updatedAt: string;
}

export interface UpdateUserPreferencesInput {
  preferences: string; // AWSJSON
}

// Voice transcription types

export interface TranscribeAudioInput {
  audio: string;
  mimeType: string;
}

export interface TranscriptionResult {
  text: string;
  duration: number | null;
}
