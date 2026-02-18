import { ChatProvider, ChatMessageInput, SendMessageInput, JudgeInput, JudgeFollowUpInput, TranscribeAudioInput } from './types';

// Validation constants
export const VALIDATION_LIMITS = {
  MAX_MESSAGES: 100,
  MAX_MESSAGE_SIZE_BYTES: 32 * 1024, // 32KB per message
  MAX_RESPONSE_SIZE_BYTES: 128 * 1024, // 128KB for LLM responses sent to judges
  MAX_TOTAL_PAYLOAD_BYTES: 200 * 1024, // 200KB total
  MAX_TITLE_LENGTH: 500,
  MAX_REQUEST_ID_LENGTH: 100,
  MAX_PROVIDER_NAME_LENGTH: 50,
  MAX_FOLLOW_UP_QUESTION_BYTES: 4 * 1024, // 4KB for follow-up questions
  MAX_AUDIO_DECODED_BYTES: 25 * 1024 * 1024, // 25MB Whisper API limit
} as const;

const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
] as const;

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
  const validProviders: ChatProvider[] = ['OPENAI', 'ANTHROPIC', 'GEMINI', 'PERPLEXITY', 'GROK', 'GEMINI_IMAGE', 'OPENAI_IMAGE'];
  if (!validProviders.includes(provider as ChatProvider)) {
    throw new ValidationError(`Invalid provider: ${provider}. Must be one of: ${validProviders.join(', ')}`);
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

  // Validate required string fields
  validateStringField(
    input.originalPrompt,
    'originalPrompt',
    VALIDATION_LIMITS.MAX_MESSAGE_SIZE_BYTES
  );
  validateStringField(
    input.responseToJudge,
    'responseToJudge',
    VALIDATION_LIMITS.MAX_RESPONSE_SIZE_BYTES
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

/**
 * Validates complete JudgeFollowUpInput
 */
/**
 * Validates TranscribeAudioInput
 */
export function validateTranscribeInput(input: TranscribeAudioInput): void {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('Input is required');
  }

  if (typeof input.audio !== 'string' || input.audio.length === 0) {
    throw new ValidationError('Audio data is required and must be a non-empty string');
  }

  if (typeof input.mimeType !== 'string' || input.mimeType.length === 0) {
    throw new ValidationError('MIME type is required');
  }

  // Normalize MIME type for comparison (lowercase, trim whitespace around semicolons)
  const normalizedMime = input.mimeType.toLowerCase().replace(/\s*;\s*/g, ';');
  if (!ALLOWED_AUDIO_MIME_TYPES.includes(normalizedMime as typeof ALLOWED_AUDIO_MIME_TYPES[number])) {
    throw new ValidationError(
      `Unsupported audio MIME type: ${input.mimeType}. Allowed: ${ALLOWED_AUDIO_MIME_TYPES.join(', ')}`
    );
  }

  // Check decoded audio size (base64 is ~4/3 the size of the original)
  const estimatedDecodedSize = Math.ceil(input.audio.length * 3 / 4);
  if (estimatedDecodedSize > VALIDATION_LIMITS.MAX_AUDIO_DECODED_BYTES) {
    throw new ValidationError(
      `Audio data exceeds maximum size of ${VALIDATION_LIMITS.MAX_AUDIO_DECODED_BYTES} bytes`
    );
  }
}

export function validateJudgeFollowUpInput(input: JudgeFollowUpInput): void {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('Input is required');
  }

  validateProvider(input.judgeProvider);

  // Validate required string fields
  validateStringField(
    input.originalPrompt,
    'originalPrompt',
    VALIDATION_LIMITS.MAX_MESSAGE_SIZE_BYTES
  );
  validateStringField(
    input.responseToJudge,
    'responseToJudge',
    VALIDATION_LIMITS.MAX_RESPONSE_SIZE_BYTES
  );
  validateStringField(
    input.respondingProvider,
    'respondingProvider',
    VALIDATION_LIMITS.MAX_PROVIDER_NAME_LENGTH
  );
  validateStringField(
    input.previousExplanation,
    'previousExplanation',
    VALIDATION_LIMITS.MAX_MESSAGE_SIZE_BYTES
  );
  validateStringField(
    input.followUpQuestion,
    'followUpQuestion',
    VALIDATION_LIMITS.MAX_FOLLOW_UP_QUESTION_BYTES
  );

  // Validate score
  if (typeof input.previousScore !== 'number' || input.previousScore < 1 || input.previousScore > 10) {
    throw new ValidationError('previousScore must be a number between 1 and 10');
  }

  // Validate problems array
  if (!Array.isArray(input.previousProblems)) {
    throw new ValidationError('previousProblems must be an array');
  }

  // Validate conversation history if provided
  if (input.conversationHistory) {
    validateMessages(input.conversationHistory);
  }
}
