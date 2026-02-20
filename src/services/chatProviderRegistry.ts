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
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic Claude Sonnet 4.6',
    color: '#D97706', // Amber/orange
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('claude'),
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini 3 Pro',
    color: '#4285F4', // Google blue
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('gemini'),
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
    description: 'xAI Grok 4.1',
    color: '#EF4444', // xAI red
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('grok'),
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Perplexity Sonar Reasoning Pro',
    color: '#20808D', // Perplexity teal
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('perplexity'),
  },
  {
    id: 'gemini-image',
    name: 'Gemini Image',
    description: 'Google Nano Banana Pro',
    color: '#E37400', // Google amber for image
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('gemini-image'),
  },
  {
    id: 'openai-image',
    name: 'GPT Image',
    description: 'OpenAI GPT Image 1.5',
    color: '#6B4EFF', // Purple for image
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('openai-image'),
  },
]

// Image providers - used to detect when to skip judges and show image UI
export const IMAGE_PROVIDER_IDS = new Set(['gemini-image', 'openai-image'])

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
