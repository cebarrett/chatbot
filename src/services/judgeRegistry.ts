import type { QualityRating, Message } from '../types'
import { getQualityRating as getAppSyncRating, isConfigured as isAppSyncConfigured } from './appsyncJudge'

export interface JudgeConfig {
  id: string
  name: string
  description: string
  color: string // For UI badge coloring
  isConfigured: () => boolean
  getRating: (conversationHistory: Message[], latestResponse: string, respondingProvider: string) => Promise<QualityRating>
}

// Create a wrapper that binds the judge ID
function createJudgeRating(judgeId: string) {
  return (conversationHistory: Message[], latestResponse: string, respondingProvider: string) =>
    getAppSyncRating(judgeId, conversationHistory, latestResponse, respondingProvider)
}

// Registry of all available judges
// Now all judges use AppSync backend - no direct API calls
export const judgeRegistry: JudgeConfig[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic Claude AI',
    color: '#D97706', // Amber/orange
    isConfigured: isAppSyncConfigured,
    getRating: createJudgeRating('claude'),
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini AI',
    color: '#4285F4', // Google blue
    isConfigured: isAppSyncConfigured,
    getRating: createJudgeRating('gemini'),
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI GPT',
    color: '#10A37F', // OpenAI green
    isConfigured: isAppSyncConfigured,
    getRating: createJudgeRating('openai'),
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
  // Default: all judges enabled
  return getAllJudgeIds()
}

// Save enabled judges to localStorage
export function saveEnabledJudges(judgeIds: string[]): void {
  localStorage.setItem(ENABLED_JUDGES_KEY, JSON.stringify(judgeIds))
}

// Fetch ratings from multiple judges in parallel
export async function fetchRatingsFromJudges(
  enabledJudgeIds: string[],
  conversationHistory: Message[],
  latestResponse: string,
  respondingProvider: string,
  onRating: (judgeId: string, rating: QualityRating) => void
): Promise<void> {
  const promises = enabledJudgeIds.map(async (judgeId) => {
    const judge = getJudgeById(judgeId)
    if (judge) {
      try {
        const rating = await judge.getRating(conversationHistory, latestResponse, respondingProvider)
        onRating(judgeId, rating)
      } catch (error) {
        console.error(`Error fetching rating from ${judge.name}:`, error)
      }
    }
  })

  await Promise.allSettled(promises)
}
