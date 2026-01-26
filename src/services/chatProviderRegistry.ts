import type { Message } from '../types'
import {
  sendMessageStream as sendOpenAIStream,
  isConfigured as isOpenAIConfigured,
} from './openai'
import {
  sendMessageStream as sendClaudeStream,
  isConfigured as isClaudeConfigured,
} from './claudeChat'
import {
  sendMessageStream as sendGeminiStream,
  isConfigured as isGeminiConfigured,
} from './geminiChat'

export interface ChatProviderConfig {
  id: string
  name: string
  description: string
  color: string
  getApiKeyEnvVar: string
  isConfigured: () => boolean
  sendMessageStream: (
    messages: Message[],
    systemPrompt: string | undefined,
    onChunk: (content: string) => void
  ) => Promise<string>
}

// Registry of all available chat providers
export const chatProviderRegistry: ChatProviderConfig[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic Claude AI',
    color: '#D97706', // Amber/orange
    getApiKeyEnvVar: 'VITE_CLAUDE_API_KEY',
    isConfigured: isClaudeConfigured,
    sendMessageStream: sendClaudeStream,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI GPT',
    color: '#10A37F', // OpenAI green
    getApiKeyEnvVar: 'VITE_OPENAI_API_KEY',
    isConfigured: isOpenAIConfigured,
    sendMessageStream: sendOpenAIStream,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini AI',
    color: '#4285F4', // Google blue
    getApiKeyEnvVar: 'VITE_GEMINI_API_KEY',
    isConfigured: isGeminiConfigured,
    sendMessageStream: sendGeminiStream,
  },
]

// Default provider ID
export const DEFAULT_PROVIDER_ID = 'claude'

// Helper to get a provider by ID
export function getProviderById(id: string): ChatProviderConfig | undefined {
  return chatProviderRegistry.find((provider) => provider.id === id)
}

// Helper to get the default provider
export function getDefaultProvider(): ChatProviderConfig {
  return chatProviderRegistry.find((p) => p.id === DEFAULT_PROVIDER_ID) || chatProviderRegistry[0]
}

// Helper to get all provider IDs
export function getAllProviderIds(): string[] {
  return chatProviderRegistry.map((provider) => provider.id)
}

// Check if any provider is configured
export function isAnyProviderConfigured(): boolean {
  return chatProviderRegistry.some((provider) => provider.isConfigured())
}
