import type { QualityRating, Message } from '../types'
import { getQualityRating as getClaudeRating } from './claudeJudge'
import { getGeminiQualityRating as getGeminiRating } from './geminiJudge'
import { getOpenAIQualityRating as getOpenAIRating } from './openaiJudge'

export interface JudgeConfig {
  id: string
  name: string
  description: string
  color: string // For UI badge coloring
  getApiKeyEnvVar: string
  isConfigured: () => boolean
  getRating: (conversationHistory: Message[], latestResponse: string) => Promise<QualityRating>
}

// Registry of all available judges
export const judgeRegistry: JudgeConfig[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic Claude AI',
    color: '#D97706', // Amber/orange
    getApiKeyEnvVar: 'VITE_CLAUDE_API_KEY',
    isConfigured: () => !!import.meta.env.VITE_CLAUDE_API_KEY,
    getRating: getClaudeRating,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini AI',
    color: '#4285F4', // Google blue
    getApiKeyEnvVar: 'VITE_GEMINI_API_KEY',
    isConfigured: () => !!import.meta.env.VITE_GEMINI_API_KEY,
    getRating: getGeminiRating,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI GPT',
    color: '#10A37F', // OpenAI green
    getApiKeyEnvVar: 'VITE_OPENAI_API_KEY',
    isConfigured: () => !!import.meta.env.VITE_OPENAI_API_KEY,
    getRating: getOpenAIRating,
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
  onRating: (judgeId: string, rating: QualityRating) => void
): Promise<void> {
  const promises = enabledJudgeIds.map(async (judgeId) => {
    const judge = getJudgeById(judgeId)
    if (judge) {
      try {
        const rating = await judge.getRating(conversationHistory, latestResponse)
        onRating(judgeId, rating)
      } catch (error) {
        console.error(`Error fetching rating from ${judge.name}:`, error)
      }
    }
  })

  await Promise.allSettled(promises)
}
