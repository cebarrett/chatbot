import {
  AppSyncEvent,
  TranscribeAudioInput,
  TranscriptionResult,
} from './types';
import { getSecrets } from './secrets';
import { validateTranscribeInput, ValidationError } from './validation';
import { resolveInternalUserId } from './userService';
import { checkTokenBudget, checkAndIncrementRequestCount, RateLimitError } from './rateLimiter';

interface TranscribeEventArgs {
  input: TranscribeAudioInput;
}

/**
 * Converts a MIME type to a file extension for the Whisper API upload.
 * Whisper infers format from the file extension.
 */
function mimeToExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  switch (normalized) {
    case 'audio/webm': return 'webm';
    case 'audio/mp4': return 'mp4';
    case 'audio/mpeg': return 'mp3';
    case 'audio/wav': return 'wav';
    default: return 'webm';
  }
}

export async function handler(
  event: AppSyncEvent<TranscribeEventArgs>
): Promise<TranscriptionResult> {
  const { input } = event.arguments;
  const identity = event.identity;

  // Validate input
  try {
    validateTranscribeInput(input);
  } catch (error) {
    const errorMessage = error instanceof ValidationError
      ? error.message
      : 'Input validation failed';
    console.error('Validation error:', errorMessage);
    throw new Error(errorMessage);
  }

  // Resolve internal user ID and check rate limits
  const internalUserId = await resolveInternalUserId(identity);
  console.log(`Processing transcription request for internalUser: ${internalUserId}`);

  try {
    await checkTokenBudget(internalUserId);
    await checkAndIncrementRequestCount(internalUserId);
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw new Error(error.message);
    }
    throw error;
  }

  // Get OpenAI API key
  const secrets = await getSecrets();
  const apiKey = secrets.OPENAI_API_KEY;

  // Decode base64 audio
  const audioBuffer = Buffer.from(input.audio, 'base64');
  if (audioBuffer.length === 0) {
    throw new Error('Audio data is empty after decoding');
  }

  // Build multipart/form-data request for Whisper API
  const extension = mimeToExtension(input.mimeType);
  const boundary = `----FormBoundary${Date.now()}`;
  const mimeForHeader = input.mimeType.toLowerCase().split(';')[0].trim();

  const preamble = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="audio.${extension}"`,
    `Content-Type: ${mimeForHeader}`,
    '',
    '',
  ].join('\r\n');

  const modelField = [
    '',
    `--${boundary}`,
    'Content-Disposition: form-data; name="model"',
    '',
    'whisper-1',
  ].join('\r\n');

  const responseFormatField = [
    '',
    `--${boundary}`,
    'Content-Disposition: form-data; name="response_format"',
    '',
    'verbose_json',
  ].join('\r\n');

  const epilogue = `\r\n--${boundary}--\r\n`;

  const preambleBuffer = Buffer.from(preamble, 'utf-8');
  const modelBuffer = Buffer.from(modelField, 'utf-8');
  const responseFormatBuffer = Buffer.from(responseFormatField, 'utf-8');
  const epilogueBuffer = Buffer.from(epilogue, 'utf-8');

  const body = Buffer.concat([
    preambleBuffer,
    audioBuffer,
    modelBuffer,
    responseFormatBuffer,
    epilogueBuffer,
  ]);

  // Call Whisper API
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Whisper API error: ${response.status} ${errorBody}`);
    if (response.status === 429) {
      throw new Error('Service busy, please try again.');
    }
    throw new Error('Transcription failed. Please try again.');
  }

  const result = await response.json() as {
    text: string;
    language?: string;
    duration?: number;
  };

  if (!result.text || result.text.trim().length === 0) {
    throw new Error('No speech detected. Please try again.');
  }

  // Check for extremely short audio
  if (result.duration !== undefined && result.duration < 0.5) {
    throw new Error('Recording too short. Please speak for at least 1 second.');
  }

  console.log(`Transcription complete: ${result.text.length} chars, duration: ${result.duration}s`);

  return {
    text: result.text,
    duration: result.duration ?? null,
  };
}
