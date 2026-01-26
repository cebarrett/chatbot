import type { Message } from '../types'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

export class ClaudeChatError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ClaudeChatError'
    this.status = status
  }
}

function getApiKey(): string {
  const apiKey = import.meta.env.VITE_CLAUDE_API_KEY
  if (!apiKey) {
    throw new ClaudeChatError(
      'Claude API key not configured. Please set VITE_CLAUDE_API_KEY in your .env file.'
    )
  }
  return apiKey
}

function buildClaudeMessages(messages: Message[]): ClaudeMessage[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }))
}

export async function sendMessage(messages: Message[], systemPrompt?: string): Promise<string> {
  const apiKey = getApiKey()
  const claudeMessages = buildClaudeMessages(messages)

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: import.meta.env.VITE_CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: claudeMessages,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage =
      errorData.error?.message || `API request failed with status ${response.status}`
    throw new ClaudeChatError(errorMessage, response.status)
  }

  const data = await response.json()

  if (!data.content?.[0]?.text) {
    throw new ClaudeChatError('Invalid response from Claude API')
  }

  return data.content[0].text
}

export async function sendMessageStream(
  messages: Message[],
  systemPrompt: string | undefined,
  onChunk: (content: string) => void
): Promise<string> {
  const apiKey = getApiKey()
  const claudeMessages = buildClaudeMessages(messages)

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: import.meta.env.VITE_CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: claudeMessages,
      stream: true,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage =
      errorData.error?.message || `API request failed with status ${response.status}`
    throw new ClaudeChatError(errorMessage, response.status)
  }

  if (!response.body) {
    throw new ClaudeChatError('Response body is not available')
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
        // Claude streaming format uses content_block_delta events
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          fullContent += parsed.delta.text
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
  return !!import.meta.env.VITE_CLAUDE_API_KEY
}
