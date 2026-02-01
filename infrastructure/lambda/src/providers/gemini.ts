import { ChatMessageInput, GeminiContent } from '../types';
import { publishChunk } from '../appsync';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-pro';

export async function streamGemini(
  apiKey: string,
  messages: ChatMessageInput[],
  requestId: string,
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

  const requestBody: Record<string, unknown> = {
    contents: geminiContents,
    generationConfig: {
      maxOutputTokens: 4096,
      temperature: 0.7,
    },
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
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            await publishChunk(requestId, text, false);
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Send final done signal
    await publishChunk(requestId, '', true);
  } finally {
    reader.releaseLock();
  }
}

export async function judgeGemini(
  apiKey: string,
  prompt: string,
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
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
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
