import type { Message } from '../types'

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

interface GeminiContent {
  role: 'user' | 'model'
  parts: { text: string }[]
}

export class GeminiChatError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GeminiChatError'
    this.status = status
  }
}

function getApiKey(): string {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    throw new GeminiChatError(
      'Gemini API key not configured. Please set VITE_GEMINI_API_KEY in your .env file.'
    )
  }
  return apiKey
}

function buildGeminiContents(messages: Message[], systemPrompt?: string): GeminiContent[] {
  const contents: GeminiContent[] = []

  // Add system prompt as first user message if provided (Gemini handles system differently)
  if (systemPrompt && messages.length > 0) {
    // We'll prepend system context to the first user message instead
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    let text = msg.content

    // Prepend system prompt to first user message
    if (i === 0 && msg.role === 'user' && systemPrompt) {
      text = `[System: ${systemPrompt}]\n\n${text}`
    }

    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text }],
    })
  }

  return contents
}

export async function sendMessage(messages: Message[], systemPrompt?: string): Promise<string> {
  const apiKey = getApiKey()
  const model = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.0-flash'
  const url = `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`

  const contents = buildGeminiContents(messages, systemPrompt)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage =
      errorData.error?.message || `API request failed with status ${response.status}`
    throw new GeminiChatError(errorMessage, response.status)
  }

  const data = await response.json()

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new GeminiChatError('Invalid response from Gemini API')
  }

  return text
}

export async function sendMessageStream(
  messages: Message[],
  systemPrompt: string | undefined,
  onChunk: (content: string) => void
): Promise<string> {
  const apiKey = getApiKey()
  const model = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.0-flash'
  const url = `${GEMINI_API_URL}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`

  const contents = buildGeminiContents(messages, systemPrompt)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage =
      errorData.error?.message || `API request failed with status ${response.status}`
    throw new GeminiChatError(errorMessage, response.status)
  }

  if (!response.body) {
    throw new GeminiChatError('Response body is not available')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue

      const data = trimmed.slice(6)
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) {
          fullContent += text
          onChunk(fullContent)
        }
      } catch {
        // Skip malformed JSON chunks
      }
    }
  }

  return fullContent
}

export function isConfigured(): boolean {
  return !!import.meta.env.VITE_GEMINI_API_KEY
}
