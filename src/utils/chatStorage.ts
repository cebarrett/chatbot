import type { Chat, Message } from '../types'

const STORAGE_KEY = 'chatbot_history'

interface StoredChat {
  id: string
  title: string
  messages: Array<{
    id: string
    content: string
    role: 'user' | 'assistant'
    timestamp: string
  }>
  createdAt: string
  updatedAt: string
}

function parseChat(stored: StoredChat): Chat {
  return {
    ...stored,
    messages: stored.messages.map((m) => ({
      ...m,
      timestamp: new Date(m.timestamp),
    })),
    createdAt: new Date(stored.createdAt),
    updatedAt: new Date(stored.updatedAt),
  }
}

function serializeChat(chat: Chat): StoredChat {
  return {
    ...chat,
    messages: chat.messages.map((m) => ({
      ...m,
      timestamp: m.timestamp.toISOString(),
    })),
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  }
}

export function loadChats(): Chat[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return []
    const stored: StoredChat[] = JSON.parse(data)
    return stored.map(parseChat).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  } catch {
    return []
  }
}

export function saveChats(chats: Chat[]): void {
  try {
    const serialized = chats.map(serializeChat)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized))
  } catch {
    console.error('Failed to save chats to localStorage')
  }
}

export function generateChatTitle(messages: Message[]): string {
  const firstUserMessage = messages.find((m) => m.role === 'user')
  if (!firstUserMessage) return 'New Chat'
  const content = firstUserMessage.content
  return content.length > 30 ? content.slice(0, 30) + '...' : content
}
