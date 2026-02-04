import { ChatMessageInput } from '../types';
import { ChunkBatcher } from '../chunkBatcher';

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = 'sonar-reasoning-pro';

/**
 * Filters out <think>...</think> blocks from streaming content.
 * Handles the case where tags may be split across multiple chunks.
 */
class ThinkBlockFilter {
  private insideThinkBlock = false;
  private buffer = '';

  /**
   * Process incoming content and return only the content outside think blocks.
   * Buffers partial tags to handle them correctly when split across chunks.
   */
  filter(content: string): string {
    this.buffer += content;
    let output = '';

    while (this.buffer.length > 0) {
      if (this.insideThinkBlock) {
        // Look for closing </think> tag
        const closeIndex = this.buffer.indexOf('</think>');
        if (closeIndex !== -1) {
          // Found closing tag - skip everything up to and including it
          this.buffer = this.buffer.slice(closeIndex + 8);
          this.insideThinkBlock = false;
        } else {
          // Check if buffer might contain partial closing tag
          // Keep potential partial tag in buffer (up to 7 chars: "</think" without ">")
          let partialStart = -1;
          for (let i = Math.max(0, this.buffer.length - 7); i < this.buffer.length; i++) {
            const suffix = this.buffer.slice(i);
            if ('</think>'.startsWith(suffix)) {
              partialStart = i;
              break;
            }
          }
          if (partialStart !== -1) {
            this.buffer = this.buffer.slice(partialStart);
          } else {
            this.buffer = '';
          }
          break;
        }
      } else {
        // Look for opening <think> tag
        const openIndex = this.buffer.indexOf('<think>');
        if (openIndex !== -1) {
          // Found opening tag - output everything before it
          output += this.buffer.slice(0, openIndex);
          this.buffer = this.buffer.slice(openIndex + 7);
          this.insideThinkBlock = true;
        } else {
          // Check if buffer might contain partial opening tag
          // Keep potential partial tag in buffer (up to 6 chars: "<think" without ">")
          let partialStart = -1;
          for (let i = Math.max(0, this.buffer.length - 6); i < this.buffer.length; i++) {
            const suffix = this.buffer.slice(i);
            if ('<think>'.startsWith(suffix)) {
              partialStart = i;
              break;
            }
          }
          if (partialStart !== -1) {
            output += this.buffer.slice(0, partialStart);
            this.buffer = this.buffer.slice(partialStart);
          } else {
            output += this.buffer;
            this.buffer = '';
          }
          break;
        }
      }
    }

    return output;
  }

  /**
   * Flush any remaining buffered content. Call this when streaming is complete.
   * Returns any content that was being held in case of partial tags.
   */
  flush(): string {
    if (this.insideThinkBlock) {
      // Still inside a think block at end of stream - discard buffer
      this.buffer = '';
      return '';
    }
    // Return any remaining buffer (partial tag that never completed)
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
  const thinkFilter = new ThinkBlockFilter();

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
          // Flush any remaining content from the think filter
          const remaining = thinkFilter.flush();
          if (remaining) {
            batcher.add(remaining);
          }
          await batcher.done();
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            const filtered = thinkFilter.filter(content);
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
              const filtered = thinkFilter.filter(content);
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

    // Flush any remaining content from the think filter
    const remaining = thinkFilter.flush();
    if (remaining) {
      batcher.add(remaining);
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
  // Remove any <think>...</think> blocks from the response
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
