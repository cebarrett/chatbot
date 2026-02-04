import type { Message } from '../types'
import {
  sendMessageStream as sendAppSyncStream,
  isConfigured as isAppSyncConfigured,
} from './appsyncChat'

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
  ) => Promise<string>
}

// Create a wrapper that binds the provider ID
function createProviderStream(providerId: string) {
  return (
    messages: Message[],
    systemPrompt: string | undefined,
    onChunk: (content: string) => void
  ) => sendAppSyncStream(providerId, messages, systemPrompt, onChunk)
}

// Registry of all available chat providers
// Now all providers use AppSync backend - no direct API calls
export const chatProviderRegistry: ChatProviderConfig[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic Claude AI',
    color: '#D97706', // Amber/orange
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('claude'),
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI GPT',
    color: '#10A37F', // OpenAI green
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('openai'),
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini AI',
    color: '#4285F4', // Google blue
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('gemini'),
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Perplexity Sonar AI',
    color: '#20808D', // Perplexity teal
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('perplexity'),
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
