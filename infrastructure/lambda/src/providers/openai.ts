import { ChatMessageInput, OpenAIMessage } from '../types';
import { ChunkBatcher } from '../chunkBatcher';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-5.2';

export async function streamOpenAI(
  apiKey: string,
  messages: ChatMessageInput[],
  requestId: string,
  userId: string,
  model?: string
): Promise<number> {
  const openaiMessages: OpenAIMessage[] = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const batcher = new ChunkBatcher(requestId, userId);
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
        if (data === '[DONE]') {
          await batcher.done();
          return totalTokens;
        }

        try {
          const parsed = JSON.parse(data);
          if (parsed.usage?.total_tokens) {
            totalTokens = parsed.usage.total_tokens;
          }
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
            if (parsed.usage?.total_tokens) {
              totalTokens = parsed.usage.total_tokens;
            }
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
    return totalTokens;
  } finally {
    reader.releaseLock();
  }
}

export async function judgeOpenAI(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<{ text: string; tokenCount: number }> {
  const response = await fetch(OPENAI_API_URL, {
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
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  const data: any = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  const tokenCount = data.usage?.total_tokens || Math.ceil(text.length / 4);
  return { text, tokenCount };
}
