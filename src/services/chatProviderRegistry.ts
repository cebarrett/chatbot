import type { Message } from '../types'
import {
  sendMessageStream as sendAppSyncStream,
  isConfigured as isAppSyncConfigured,
  type StreamResult,
  type StreamResponse,
} from './appsyncChat'

export type { StreamResult, StreamResponse }

export type CostTier = 'premium' | 'standard' | 'economy'

export interface ChatProviderConfig {
  id: string
  name: string
  description: string
  color: string
  /** Provider family for grouping in the UI (e.g., 'anthropic', 'openai') */
  providerFamily: string
  /** Cost tier for visual indication */
  costTier: CostTier
  /** How many times more messages a user effectively gets compared to the most expensive model.
   *  e.g., quotaMultiplier=5 means "5x more messages" relative to premium tier. */
  quotaMultiplier: number
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
  // Anthropic family
  {
    id: 'claude',
    name: 'Claude Opus',
    description: 'Anthropic Claude Opus 4.6 — most capable',
    color: '#D97706', // Amber/orange
    providerFamily: 'anthropic',
    costTier: 'premium',
    quotaMultiplier: 1,
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('claude'),
  },
  {
    id: 'claude-sonnet',
    name: 'Claude Sonnet',
    description: 'Anthropic Claude Sonnet 4.5 — fast & smart',
    color: '#D97706',
    providerFamily: 'anthropic',
    costTier: 'standard',
    quotaMultiplier: 5,
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('claude-sonnet'),
  },
  {
    id: 'claude-haiku',
    name: 'Claude Haiku',
    description: 'Anthropic Claude Haiku 4.5 — lightweight & fast',
    color: '#D97706',
    providerFamily: 'anthropic',
    costTier: 'economy',
    quotaMultiplier: 20,
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('claude-haiku'),
  },
  // Google family
  {
    id: 'gemini',
    name: 'Gemini Pro',
    description: 'Google Gemini 3 Pro — most capable',
    color: '#4285F4', // Google blue
    providerFamily: 'google',
    costTier: 'premium',
    quotaMultiplier: 1,
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('gemini'),
  },
  {
    id: 'gemini-flash',
    name: 'Gemini Flash',
    description: 'Google Gemini 3 Flash — fast & efficient',
    color: '#4285F4',
    providerFamily: 'google',
    costTier: 'economy',
    quotaMultiplier: 7,
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('gemini-flash'),
  },
  // OpenAI family
  {
    id: 'openai',
    name: 'ChatGPT',
    description: 'OpenAI GPT-5.2',
    color: '#10A37F', // OpenAI green
    providerFamily: 'openai',
    costTier: 'premium',
    quotaMultiplier: 1,
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('openai'),
  },
  // xAI family
  {
    id: 'grok',
    name: 'Grok',
    description: 'xAI Grok 4.1',
    color: '#EF4444', // xAI red
    providerFamily: 'xai',
    costTier: 'premium',
    quotaMultiplier: 1,
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('grok'),
  },
  // Perplexity family
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Perplexity Sonar Reasoning Pro',
    color: '#20808D', // Perplexity teal
    providerFamily: 'perplexity',
    costTier: 'premium',
    quotaMultiplier: 1,
    isConfigured: isAppSyncConfigured,
    sendMessageStream: createProviderStream('perplexity'),
  },
]

// Default provider ID
export const DEFAULT_PROVIDER_ID = 'claude-sonnet'

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

// Helper to get the cost tier label for display
export function getCostTierLabel(tier: CostTier): string {
  switch (tier) {
    case 'premium':
      return 'Premium'
    case 'standard':
      return 'Standard'
    case 'economy':
      return 'Economy'
  }
}
