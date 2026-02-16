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
  conversationHistory?: ChatMessageInput[];
  model?: string;
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

export type ChatProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'PERPLEXITY' | 'GROK';

// GraphQL output types
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

export interface JudgeResponse {
  score: number;
  explanation: string;
  problems: string[];
  judgeProvider: string;
}

export interface JudgeFollowUpResponse {
  answer: string;
  judgeProvider: string;
}

// User identity from OIDC token (Clerk)
export interface UserIdentity {
  sub: string; // User ID
  issuer: string; // Clerk issuer URL
  claims?: Record<string, unknown>; // Additional claims from JWT
}

// Lambda event types - matches the resolver payload structure
export interface AppSyncEvent<T> {
  arguments: T;
  identity: UserIdentity;
}

// Secrets structure
export interface LLMSecrets {
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GEMINI_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  GROK_API_KEY: string;
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
