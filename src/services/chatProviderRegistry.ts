import type { Message } from '../types'
import {
  sendMessageStream as sendAppSyncStream,
  isConfigured as isAppSyncConfigured,
  type StreamResult,
  type StreamResponse,
} from './appsyncChat'

export type { StreamResult, StreamResponse }

export interface ChatProviderConfig {
  id: string
  name: string
  description: string
  color: string
  isConfigured: () => boolean
  sendMessageStream: (
    messages: Message[],
    systemPrompt: string | undefined,
    onChunk: (content: string) => void
  ) => StreamResult
}

// Create a wrapper that binds the provider ID
function createProviderStream(providerId: string) {
  return (
    messages: Message[],
    systemPrompt: string | undefined,
    onChunk: (content: string) => void
  ): StreamResult => sendAppSyncStream(providerId, messages, systemPrompt, onChunk)
}

// Registry of all available chat providers
// Now all providers use AppSync backend - no direct API calls
export const chatProviderRegistry: ChatProviderConfig[] = [
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Perplexity Sonar Reasoning Pro',
    color: '#20808D', // Perplexity teal
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('perplexity'),
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini 2.5 Pro',
    color: '#4285F4', // Google blue
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('gemini'),
  },
  {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic Claude Opus 4',
    color: '#D97706', // Amber/orange
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('claude'),
  },
  {
    id: 'openai',
    name: 'ChatGPT',
    description: 'OpenAI GPT-5.2',
    color: '#10A37F', // OpenAI green
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('openai'),
  },
  {
    id: 'grok',
    name: 'Grok',
    description: 'xAI Grok 3',
    color: '#EF4444', // xAI red
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('grok'),
  },
]

// Default provider ID
export const DEFAULT_PROVIDER_ID = 'gemini'

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
