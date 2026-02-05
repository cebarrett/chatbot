import { ChatMessageInput } from '../types';
import { ChunkBatcher } from '../chunkBatcher';

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = 'sonar-reasoning-pro';

/**
 * Filters out source reference markers like [1], [2], etc. from streaming content.
 * These are Perplexity's citation markers that aren't useful without the source list.
 */
class SourceReferenceFilter {
  private buffer = '';

  /**
   * Process incoming content and return content with source references removed.
   * Buffers potential partial references to handle them correctly when split across chunks.
   */
  filter(content: string): string {
    this.buffer += content;
    let output = '';

    while (this.buffer.length > 0) {
      const bracketIndex = this.buffer.indexOf('[');

      if (bracketIndex === -1) {
        // No '[' in buffer, output everything
        output += this.buffer;
        this.buffer = '';
        break;
      }

      // Output everything before the '['
      output += this.buffer.slice(0, bracketIndex);
      this.buffer = this.buffer.slice(bracketIndex);

      // Now buffer starts with '['
      // Look for closing ']'
      const closeIndex = this.buffer.indexOf(']');

      if (closeIndex === -1) {
        // No closing bracket yet - might be incomplete, keep buffered
        break;
      }

      // Check if content between brackets is only digits
      const inner = this.buffer.slice(1, closeIndex);
      if (inner.length > 0 && /^\d+$/.test(inner)) {
        // It's a source reference - skip it
        this.buffer = this.buffer.slice(closeIndex + 1);
      } else {
        // Not a source reference - output the '[' and continue
        output += '[';
        this.buffer = this.buffer.slice(1);
      }
    }

    return output;
  }

  /**
   * Flush any remaining buffered content.
   */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    return remaining;
  }
}

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
  const sourceFilter = new SourceReferenceFilter();

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
          // Flush any remaining content from the source filter
          const sourceRemaining = sourceFilter.flush();
          if (sourceRemaining) {
            batcher.add(sourceRemaining);
          }
          await batcher.done();
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            const filtered = sourceFilter.filter(content);
            if (filtered) {
              batcher.add(filtered);
            }
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
              const filtered = sourceFilter.filter(content);
              if (filtered) {
                batcher.add(filtered);
              }
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }

    // Flush any remaining content from the source filter
    const sourceRemaining = sourceFilter.flush();
    if (sourceRemaining) {
      batcher.add(sourceRemaining);
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
  const content = data.choices?.[0]?.message?.content || '';
  // Remove any <think>...</think> blocks and source references [1], [2], etc. from the response
  return content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/\[\d+\]/g, '')
    .trim();
}
