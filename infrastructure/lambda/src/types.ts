// GraphQL input types
export interface SendMessageInput {
  requestId: string;
  provider: ChatProvider;
  messages: ChatMessageInput[];
  model?: string;
}

export interface ChatMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface JudgeInput {
  judgeProvider: ChatProvider;
  originalPrompt: string;
  responseToJudge: string;
  respondingProvider: string;
  model?: string;
}

export type ChatProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI';

// GraphQL output types
export interface SendMessageResponse {
  requestId: string;
  status: string;
  message?: string;
}

export interface MessageChunk {
  requestId: string;
  chunk: string;
  done: boolean;
  error?: string;
}

export interface JudgeResponse {
  score: number;
  explanation: string;
  problems: string[];
  judgeProvider: string;
}

// Lambda event types
export interface AppSyncEvent<T> {
  arguments: T;
  identity?: {
    sub?: string;
    issuer?: string;
    username?: string;
    claims?: Record<string, unknown>;
  };
  source?: Record<string, unknown>;
  request: {
    headers: Record<string, string>;
  };
  info: {
    fieldName: string;
    parentTypeName: string;
    variables: Record<string, unknown>;
  };
}

// Secrets structure
export interface LLMSecrets {
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GEMINI_API_KEY: string;
}

// Provider-specific message formats
export interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}
