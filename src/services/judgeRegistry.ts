import type { QualityRating, Message } from '../types'
import { getQualityRating as getAppSyncRating, isConfigured as isAppSyncConfigured } from './appsyncJudge'

export interface JudgeConfig {
  id: string
  name: string
  description: string
  color: string // For UI badge coloring
  isConfigured: () => boolean
  getRating: (conversationHistory: Message[], latestResponse: string, respondingProvider: string, signal?: AbortSignal) => Promise<QualityRating>
}

// Create a wrapper that binds the judge ID
function createJudgeRating(judgeId: string) {
  return (conversationHistory: Message[], latestResponse: string, respondingProvider: string, signal?: AbortSignal) =>
    getAppSyncRating(judgeId, conversationHistory, latestResponse, respondingProvider, signal)
}

// Registry of all available judges
// Now all judges use AppSync backend - no direct API calls
export const judgeRegistry: JudgeConfig[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic Claude Opus 4',
    color: '#D97706', // Amber/orange
    isConfigured: isAppSyncConfigured,
    getRating: createJudgeRating('claude'),
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini 2.5 Pro',
    color: '#4285F4', // Google blue
    isConfigured: isAppSyncConfigured,
    getRating: createJudgeRating('gemini'),
  },
  {
    id: 'openai',
    name: 'ChatGPT',
    description: 'OpenAI GPT-4o',
    color: '#10A37F', // OpenAI green
    isConfigured: isAppSyncConfigured,
    getRating: createJudgeRating('openai'),
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Perplexity Sonar Reasoning Pro',
    color: '#20808D', // Perplexity teal
    isConfigured: isAppSyncConfigured,
    getRating: createJudgeRating('perplexity'),
  },
  {
    id: 'grok',
    name: 'Grok',
    description: 'xAI Grok 3',
    color: '#EF4444', // xAI red
    isConfigured: isAppSyncConfigured,
    getRating: createJudgeRating('grok'),
  },
]

// Helper to get a judge by ID
export function getJudgeById(id: string): JudgeConfig | undefined {
  return judgeRegistry.find((judge) => judge.id === id)
}

// Helper to get all judge IDs
export function getAllJudgeIds(): string[] {
  return judgeRegistry.map((judge) => judge.id)
}

// Storage key for enabled judges
const ENABLED_JUDGES_KEY = 'chatbot_enabled_judges'

// Load enabled judges from localStorage
export function loadEnabledJudges(): string[] {
  try {
    const stored = localStorage.getItem(ENABLED_JUDGES_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        // Filter to only valid judge IDs
        return parsed.filter((id) => judgeRegistry.some((j) => j.id === id))
      }
    }
  } catch {
    // Ignore parse errors
  }
  // Default: Gemini and ChatGPT judges enabled
  return ['gemini', 'openai']
}

// Save enabled judges to localStorage
export function saveEnabledJudges(judgeIds: string[]): void {
  localStorage.setItem(ENABLED_JUDGES_KEY, JSON.stringify(judgeIds))
}

// Result type for judge fetching with cancellation support
export interface JudgeFetchResult {
  promise: Promise<void>
  cancel: () => void
}

// Fetch ratings from multiple judges in parallel
export function fetchRatingsFromJudges(
  enabledJudgeIds: string[],
  conversationHistory: Message[],
  latestResponse: string,
  respondingProvider: string,
  onRating: (judgeId: string, rating: QualityRating) => void
): JudgeFetchResult {
  const abortController = new AbortController()

  const promise = (async () => {
    const promises = enabledJudgeIds.map(async (judgeId) => {
      const judge = getJudgeById(judgeId)
      if (judge) {
        try {
          const rating = await judge.getRating(conversationHistory, latestResponse, respondingProvider, abortController.signal)
          // Don't call onRating if aborted
          if (!abortController.signal.aborted) {
            onRating(judgeId, rating)
          }
        } catch (error) {
          // Ignore abort errors, log other errors
          if (error instanceof Error && error.name !== 'AbortError') {
            console.error(`Error fetching rating from ${judge.name}:`, error)
          }
        }
      }
    })

    await Promise.allSettled(promises)
  })()

  return {
    promise,
    cancel: () => abortController.abort(),
  }
}
