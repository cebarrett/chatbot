import { ChatMessageInput, AnthropicMessage } from '../types';
import { ChunkBatcher } from '../chunkBatcher';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-opus-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

const THINKING_CAPABLE_MODELS = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514',
]);

export async function streamAnthropic(
  apiKey: string,
  messages: ChatMessageInput[],
  requestId: string,
  userId: string,
  model?: string
): Promise<void> {
  // Extract system message if present
  let systemPrompt: string | undefined;
  const anthropicMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else {
      anthropicMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  const selectedModel = model || DEFAULT_MODEL;
  const useThinking = THINKING_CAPABLE_MODELS.has(selectedModel);

  const requestBody: Record<string, unknown> = {
    model: selectedModel,
    messages: anthropicMessages,
    max_tokens: useThinking ? 32000 : 8192,
    stream: true,
  };

  if (useThinking) {
    requestBody.thinking = {
      type: 'enabled',
      budget_tokens: 10000,
    };
  }

  if (systemPrompt) {
    requestBody.system = systemPrompt;
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${error}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const batcher = new ChunkBatcher(requestId, userId);
  let currentBlockType: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);

        try {
          const parsed = JSON.parse(data);

          if (parsed.type === 'content_block_start') {
            currentBlockType = parsed.content_block?.type || null;
            if (currentBlockType === 'thinking') {
              batcher.add('<think>');
            }
          } else if (parsed.type === 'content_block_delta') {
            if (parsed.delta?.type === 'thinking_delta') {
              const thinking = parsed.delta?.thinking;
              if (thinking) {
                batcher.add(thinking);
              }
            } else if (parsed.delta?.type === 'text_delta') {
              const text = parsed.delta?.text;
              if (text) {
                batcher.add(text);
              }
            }
          } else if (parsed.type === 'content_block_stop') {
            if (currentBlockType === 'thinking') {
              batcher.add('</think>\n\n');
            }
            currentBlockType = null;
          } else if (parsed.type === 'message_stop') {
            await batcher.done();
            return;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Flush any remaining bytes from the decoder and process leftover buffer
    buffer += decoder.decode();
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta') {
            if (parsed.delta?.type === 'thinking_delta') {
              const thinking = parsed.delta?.thinking;
              if (thinking) {
                batcher.add(thinking);
              }
            } else if (parsed.delta?.type === 'text_delta') {
              const text = parsed.delta?.text;
              if (text) {
                batcher.add(text);
              }
            }
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Send final done signal
    await batcher.done();
  } finally {
    reader.releaseLock();
  }
}

export async function judgeAnthropic(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${error}`);
  }

  const data: any = await response.json();
  return data.content?.[0]?.text || '';
}
