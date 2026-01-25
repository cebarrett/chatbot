import type { Message } from '../types'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface OpenAIResponse {
  choices: {
    message: {
      content: string
    }
  }[]
}

export class OpenAIError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'OpenAIError'
    this.status = status
  }
}

function getApiKey(): string {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY
  if (!apiKey) {
    throw new OpenAIError('OpenAI API key not configured. Please set VITE_OPENAI_API_KEY in your .env file.')
  }
  return apiKey
}

function buildOpenAIMessages(messages: Message[], systemPrompt?: string): OpenAIMessage[] {
  const openAIMessages: OpenAIMessage[] = []

  if (systemPrompt) {
    openAIMessages.push({
      role: 'system',
      content: systemPrompt,
    })
  }

  for (const msg of messages) {
    openAIMessages.push({
      role: msg.role,
      content: msg.content,
    })
  }

  return openAIMessages
}

export async function sendMessage(
  messages: Message[],
  systemPrompt?: string
): Promise<string> {
  const apiKey = getApiKey()
  const openAIMessages = buildOpenAIMessages(messages, systemPrompt)

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: import.meta.env.VITE_OPENAI_MODEL || 'gpt-5.2',
      messages: openAIMessages,
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage = errorData.error?.message || `API request failed with status ${response.status}`
    throw new OpenAIError(errorMessage, response.status)
  }

  const data: OpenAIResponse = await response.json()

  if (!data.choices?.[0]?.message?.content) {
    throw new OpenAIError('Invalid response from OpenAI API')
  }

  return data.choices[0].message.content
}

export async function sendMessageStream(
  messages: Message[],
  systemPrompt: string | undefined,
  onChunk: (content: string) => void
): Promise<string> {
  const apiKey = getApiKey()
  const openAIMessages = buildOpenAIMessages(messages, systemPrompt)

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: import.meta.env.VITE_OPENAI_MODEL || 'gpt-5.2',
      messages: openAIMessages,
      temperature: 0.7,
      stream: true,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage = errorData.error?.message || `API request failed with status ${response.status}`
    throw new OpenAIError(errorMessage, response.status)
  }

  if (!response.body) {
    throw new OpenAIError('Response body is not available')
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
        const content = parsed.choices?.[0]?.delta?.content
        if (content) {
          fullContent += content
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
  return !!import.meta.env.VITE_OPENAI_API_KEY
}
