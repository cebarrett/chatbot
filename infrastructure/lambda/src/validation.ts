import { ChatProvider, ChatMessageInput, SendMessageInput, JudgeInput } from './types';

// Validation constants
export const VALIDATION_LIMITS = {
  MAX_MESSAGES: 100,
  MAX_MESSAGE_SIZE_BYTES: 32 * 1024, // 32KB per message
  MAX_TOTAL_PAYLOAD_BYTES: 200 * 1024, // 200KB total
  MAX_TITLE_LENGTH: 500,
  MAX_REQUEST_ID_LENGTH: 100,
  MAX_PROVIDER_NAME_LENGTH: 50,
} as const;

// Model allowlists per provider - only these models can be used
export const ALLOWED_MODELS: Record<ChatProvider, string[]> = {
  OPENAI: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
  ],
  ANTHROPIC: [
    'claude-sonnet-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-haiku-20240307',
  ],
  GEMINI: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
  PERPLEXITY: [
    'sonar-reasoning-pro',
    'sonar-reasoning',
    'sonar-pro',
    'sonar',
  ],
};

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validates that the provider is one of the allowed values
 */
export function validateProvider(provider: string): asserts provider is ChatProvider {
  const validProviders: ChatProvider[] = ['OPENAI', 'ANTHROPIC', 'GEMINI', 'PERPLEXITY'];
  if (!validProviders.includes(provider as ChatProvider)) {
    throw new ValidationError(`Invalid provider: ${provider}. Must be one of: ${validProviders.join(', ')}`);
  }
}

/**
 * Validates that the model is allowed for the given provider
 */
export function validateModel(provider: ChatProvider, model: string | undefined): void {
  if (!model) {
    return; // undefined model is ok - will use default
  }

  const allowedModels = ALLOWED_MODELS[provider];
  if (!allowedModels.includes(model)) {
    throw new ValidationError(
      `Invalid model "${model}" for provider ${provider}. Allowed models: ${allowedModels.join(', ')}`
    );
  }
}

/**
 * Validates message array constraints
 */
export function validateMessages(messages: ChatMessageInput[]): void {
  if (!Array.isArray(messages)) {
    throw new ValidationError('Messages must be an array');
  }

  if (messages.length === 0) {
    throw new ValidationError('Messages array cannot be empty');
  }

  if (messages.length > VALIDATION_LIMITS.MAX_MESSAGES) {
    throw new ValidationError(
      `Too many messages: ${messages.length}. Maximum allowed: ${VALIDATION_LIMITS.MAX_MESSAGES}`
    );
  }

  let totalSize = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Validate message structure
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError(`Message at index ${i} is invalid`);
    }

    // Validate role
    const validRoles = ['user', 'assistant', 'system'];
    if (!validRoles.includes(msg.role)) {
      throw new ValidationError(
        `Invalid role "${msg.role}" at index ${i}. Must be one of: ${validRoles.join(', ')}`
      );
    }

    // Validate content exists and is a string
    if (typeof msg.content !== 'string') {
      throw new ValidationError(`Message content at index ${i} must be a string`);
    }

    // Check individual message size
    const messageSize = Buffer.byteLength(msg.content, 'utf8');
    if (messageSize > VALIDATION_LIMITS.MAX_MESSAGE_SIZE_BYTES) {
      throw new ValidationError(
        `Message at index ${i} exceeds size limit: ${messageSize} bytes. Maximum: ${VALIDATION_LIMITS.MAX_MESSAGE_SIZE_BYTES} bytes`
      );
    }

    totalSize += messageSize;
  }

  // Check total payload size
  if (totalSize > VALIDATION_LIMITS.MAX_TOTAL_PAYLOAD_BYTES) {
    throw new ValidationError(
      `Total message payload exceeds limit: ${totalSize} bytes. Maximum: ${VALIDATION_LIMITS.MAX_TOTAL_PAYLOAD_BYTES} bytes`
    );
  }
}

/**
 * Validates request ID format
 */
export function validateRequestId(requestId: string): void {
  if (!requestId || typeof requestId !== 'string') {
    throw new ValidationError('Request ID is required and must be a string');
  }

  if (requestId.length > VALIDATION_LIMITS.MAX_REQUEST_ID_LENGTH) {
    throw new ValidationError(
      `Request ID exceeds maximum length: ${requestId.length}. Maximum: ${VALIDATION_LIMITS.MAX_REQUEST_ID_LENGTH}`
    );
  }

  // Basic format validation - alphanumeric, hyphens, and underscores only
  if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) {
    throw new ValidationError('Request ID contains invalid characters');
  }
}

/**
 * Validates string field size
 */
export function validateStringField(
  value: string,
  fieldName: string,
  maxBytes: number
): void {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`);
  }

  const size = Buffer.byteLength(value, 'utf8');
  if (size > maxBytes) {
    throw new ValidationError(
      `${fieldName} exceeds size limit: ${size} bytes. Maximum: ${maxBytes} bytes`
    );
  }
}

/**
 * Validates complete SendMessageInput
 */
export function validateSendMessageInput(input: SendMessageInput): void {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('Input is required');
  }

  validateRequestId(input.requestId);
  validateProvider(input.provider);
  validateModel(input.provider, input.model);
  validateMessages(input.messages);
}

/**
 * Validates complete JudgeInput
 */
export function validateJudgeInput(input: JudgeInput): void {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('Input is required');
  }

  validateProvider(input.judgeProvider);
  validateModel(input.judgeProvider, input.model);

  // Validate required string fields
  validateStringField(
    input.originalPrompt,
    'originalPrompt',
    VALIDATION_LIMITS.MAX_MESSAGE_SIZE_BYTES
  );
  validateStringField(
    input.responseToJudge,
    'responseToJudge',
    VALIDATION_LIMITS.MAX_MESSAGE_SIZE_BYTES
  );
  validateStringField(
    input.respondingProvider,
    'respondingProvider',
    VALIDATION_LIMITS.MAX_PROVIDER_NAME_LENGTH
  );

  // Validate conversation history if provided
  if (input.conversationHistory) {
    validateMessages(input.conversationHistory);
  }
}
