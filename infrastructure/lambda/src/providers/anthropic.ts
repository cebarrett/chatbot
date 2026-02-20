import { ChatMessageInput, AnthropicMessage } from '../types';
import { ChunkBatcher } from '../chunkBatcher';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6-20250819';
const ANTHROPIC_VERSION = '2023-06-01';

const THINKING_CAPABLE_MODELS = new Set([
  'claude-sonnet-4-6-20250819',
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
): Promise<number> {
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
  let totalTokens = 0;

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

          if (parsed.type === 'message_start' && parsed.message?.usage) {
            totalTokens += parsed.message.usage.input_tokens || 0;
          } else if (parsed.type === 'message_delta' && parsed.usage) {
            totalTokens += parsed.usage.output_tokens || 0;
          } else if (parsed.type === 'content_block_start') {
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
            return totalTokens;
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
    return totalTokens;
  } finally {
    reader.releaseLock();
  }
}

export async function judgeAnthropic(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<{ text: string; tokenCount: number }> {
  const selectedModel = model || DEFAULT_MODEL;
  const useThinking = THINKING_CAPABLE_MODELS.has(selectedModel);

  const requestBody: Record<string, unknown> = {
    model: selectedModel,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    max_tokens: useThinking ? 16000 : 4096,
  };

  if (useThinking) {
    requestBody.thinking = {
      type: 'enabled',
      budget_tokens: 10000,
    };
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

  const data: any = await response.json();

  // With thinking enabled, content has thinking + text blocks — extract only text
  let text = '';
  if (data.content && Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'text' && block.text) {
        text += block.text;
      }
    }
  }
  if (!text) {
    text = data.content?.[0]?.text || '';
  }

  const tokenCount = ((data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)) || Math.ceil(text.length / 4);
  return { text, tokenCount };
}
