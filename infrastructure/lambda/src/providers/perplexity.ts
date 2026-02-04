import { ChatMessageInput } from '../types';
import { ChunkBatcher } from '../chunkBatcher';

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = 'sonar-reasoning-pro';

interface PerplexityMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function streamPerplexity(
  apiKey: string,
  messages: ChatMessageInput[],
  requestId: string,
  userId: string,
  model?: string
): Promise<void> {
  const perplexityMessages: PerplexityMessage[] = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const response = await fetch(PERPLEXITY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: perplexityMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Perplexity API error: ${response.status} ${error}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const batcher = new ChunkBatcher(requestId, userId);

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
        if (data === '[DONE]') {
          await batcher.done();
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            batcher.add(content);
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
        if (data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              batcher.add(content);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }

    // Send final done signal
    await batcher.done();
  } finally {
    reader.releaseLock();
  }
}

export async function judgePerplexity(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<string> {
  const response = await fetch(PERPLEXITY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Perplexity API error: ${response.status} ${error}`);
  }

  const data: any = await response.json();
  return data.choices?.[0]?.message?.content || '';
}
