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
  mutation PublishChunk($requestId: String!, $chunk: String!, $done: Boolean!, $error: String) {
    publishChunk(requestId: $requestId, chunk: $chunk, done: $done, error: $error) {
      requestId
      chunk
      done
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

export const ON_MESSAGE_CHUNK_SUBSCRIPTION = `
  subscription OnMessageChunk($requestId: String!) {
    onMessageChunk(requestId: $requestId) {
      requestId
      chunk
      done
      error
    }
  }
`;

export const HEALTH_QUERY = `
  query Health {
    health
  }
`;

// Types matching the GraphQL schema
export type ChatProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI';

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
  chunk: string;
  done: boolean;
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
