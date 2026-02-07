import { ChatMessageInput, GeminiContent } from '../types';
import { ChunkBatcher } from '../chunkBatcher';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-pro';

const THINKING_CAPABLE_MODELS = new Set([
  'gemini-2.5-pro',
  'gemini-2.5-flash',
]);

export async function streamGemini(
  apiKey: string,
  messages: ChatMessageInput[],
  requestId: string,
  userId: string,
  model?: string
): Promise<void> {
  const modelName = model || DEFAULT_MODEL;

  // Extract system instruction if present
  let systemInstruction: string | undefined;
  const geminiContents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = msg.content;
    } else {
      geminiContents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
  }

  const useThinking = THINKING_CAPABLE_MODELS.has(modelName);

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: 4096,
    temperature: 0.7,
  };

  if (useThinking) {
    generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: 8192,
    };
  }

  const requestBody: Record<string, unknown> = {
    contents: geminiContents,
    generationConfig,
  };

  if (systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const url = `${GEMINI_API_BASE}/${modelName}:streamGenerateContent?key=${apiKey}&alt=sse`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${error}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const batcher = new ChunkBatcher(requestId, userId);
  let inThinking = false;

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
          const parts = parsed.candidates?.[0]?.content?.parts;
          if (parts && Array.isArray(parts)) {
            for (const part of parts) {
              if (part.thought) {
                if (!inThinking) {
                  batcher.add('<think>');
                  inThinking = true;
                }
                if (part.text) {
                  batcher.add(part.text);
                }
              } else if (part.text) {
                if (inThinking) {
                  batcher.add('</think>\n\n');
                  inThinking = false;
                }
                batcher.add(part.text);
              }
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
        try {
          const parsed = JSON.parse(data);
          const parts = parsed.candidates?.[0]?.content?.parts;
          if (parts && Array.isArray(parts)) {
            for (const part of parts) {
              if (part.thought) {
                if (!inThinking) {
                  batcher.add('<think>');
                  inThinking = true;
                }
                if (part.text) {
                  batcher.add(part.text);
                }
              } else if (part.text) {
                if (inThinking) {
                  batcher.add('</think>\n\n');
                  inThinking = false;
                }
                batcher.add(part.text);
              }
            }
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Close any unclosed thinking block
    if (inThinking) {
      batcher.add('</think>\n\n');
    }

    // Send final done signal
    await batcher.done();
  } finally {
    reader.releaseLock();
  }
}

export async function judgeGemini(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<string> {
  const modelName = model || DEFAULT_MODEL;
  const url = `${GEMINI_API_BASE}/${modelName}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.3,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${error}`);
  }

  const data: any = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}
