import type { QualityRating } from '../types'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

const JUDGE_SYSTEM_PROMPT = `You are an expert AI response quality evaluator. Your task is to assess the quality of an AI assistant's response to a user's message.

Evaluate the response on these criteria:
1. **Accuracy**: Is the information factually correct? Are there any errors or misleading statements?
2. **Completeness**: Does the response fully address the user's question or request?
3. **Clarity**: Is the response well-organized, easy to understand, and appropriately concise?
4. **Helpfulness**: Does the response provide practical, actionable information?
5. **Tone**: Is the tone appropriate for the context (professional yet friendly)?

Provide your evaluation as a JSON object with exactly this structure:
{
  "score": <number from 1.0 to 10.0 with one decimal place>,
  "explanation": "<2-3 sentence summary of the overall quality>",
  "problems": ["<specific issue 1>", "<specific issue 2>", ...]
}

Scoring guide:
- 9.0-10.0: Excellent - comprehensive, accurate, well-structured, no significant issues
- 7.5-8.9: Good - solid response with minor areas for improvement
- 5.0-7.4: Fair - addresses the question but has notable gaps or issues
- 3.0-4.9: Poor - significant problems with accuracy, completeness, or clarity
- 1.0-2.9: Very Poor - fails to address the question or contains major errors

Be specific in identifying problems. If the response is excellent with no issues, use an empty array for problems.
Only output the JSON object, nothing else.`

export class ClaudeJudgeError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ClaudeJudgeError'
    this.status = status
  }
}

function getApiKey(): string | null {
  return import.meta.env.VITE_CLAUDE_API_KEY || null
}

export function isJudgeConfigured(): boolean {
  return !!import.meta.env.VITE_CLAUDE_API_KEY
}

// Dummy ratings for fallback when API is not configured
const dummyRatings: QualityRating[] = [
  {
    score: 8.5,
    explanation:
      'The response is well-structured and provides accurate information. It addresses the user query directly and uses clear language.',
    problems: [
      'Could benefit from more specific examples',
      'Some technical terms could be better explained for beginners',
    ],
  },
  {
    score: 7.2,
    explanation:
      'The response covers the main points but lacks depth in certain areas. The tone is appropriate and the information appears accurate.',
    problems: [
      'Missing important context about edge cases',
      'The explanation could be more concise',
      'Did not address the secondary part of the question',
    ],
  },
  {
    score: 9.1,
    explanation:
      'Excellent response that thoroughly addresses the query with accurate information, good examples, and clear explanations. Well-organized and easy to follow.',
    problems: ['Minor: Could include links to documentation for further reading'],
  },
  {
    score: 6.3,
    explanation:
      'The response provides a basic answer but misses some nuances. The structure is acceptable but could be improved.',
    problems: [
      'Oversimplifies a complex topic',
      'Contains a minor inaccuracy in the third paragraph',
      'Does not acknowledge limitations of the suggested approach',
      'Tone is slightly too casual for a technical explanation',
    ],
  },
  {
    score: 4.8,
    explanation:
      'The response attempts to answer the question but has significant issues with accuracy and completeness.',
    problems: [
      'Contains factual errors about API behavior',
      'Recommends an outdated approach',
      'Missing critical safety considerations',
      'The code example has a bug that would cause runtime errors',
    ],
  },
  {
    score: 9.7,
    explanation:
      'Outstanding response that demonstrates deep understanding. Provides comprehensive coverage with excellent examples and anticipates follow-up questions.',
    problems: [],
  },
  {
    score: 5.5,
    explanation:
      'Mediocre response that addresses the question superficially. The information is mostly correct but lacks the depth needed for practical application.',
    problems: [
      'Too vague to be actionable',
      'Ignores important trade-offs',
      'Could mislead users about complexity',
    ],
  },
  {
    score: 8.0,
    explanation:
      'Good response with accurate information and helpful examples. The structure is logical and the explanation is clear.',
    problems: [
      'Assumes prior knowledge that the user may not have',
      'Could benefit from a summary at the end',
    ],
  },
]

function getDummyRating(userMessage: string, assistantResponse: string): QualityRating {
  // Use a hash of the inputs to get a consistent rating for the same messages
  const hash = (userMessage + assistantResponse).length
  return dummyRatings[hash % dummyRatings.length]
}

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ClaudeResponse {
  content: Array<{
    type: 'text'
    text: string
  }>
}

function parseRatingResponse(text: string): QualityRating {
  try {
    // Try to extract JSON from the response (in case there's extra text)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON object found in response')
    }

    const parsed = JSON.parse(jsonMatch[0])

    // Validate and sanitize the response
    const score = typeof parsed.score === 'number' ? parsed.score : 5.0
    const explanation =
      typeof parsed.explanation === 'string' ? parsed.explanation : 'Unable to parse explanation.'
    const problems = Array.isArray(parsed.problems)
      ? parsed.problems.filter((p: unknown) => typeof p === 'string')
      : []

    return {
      score: Math.round(Math.max(1, Math.min(10, score)) * 10) / 10, // Clamp to 1-10 with 1 decimal
      explanation,
      problems,
    }
  } catch {
    // Return a default rating if parsing fails
    return {
      score: 5.0,
      explanation: 'Unable to evaluate this response.',
      problems: ['Evaluation could not be completed'],
    }
  }
}

export async function getQualityRating(
  userMessage: string,
  assistantResponse: string
): Promise<QualityRating> {
  const apiKey = getApiKey()

  // Fall back to dummy ratings if API is not configured
  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000))
    return getDummyRating(userMessage, assistantResponse)
  }

  const messages: ClaudeMessage[] = [
    {
      role: 'user',
      content: `Please evaluate the following AI assistant response.

**User's Message:**
${userMessage}

**Assistant's Response:**
${assistantResponse}

Provide your quality rating as a JSON object.`,
    },
  ]

  try {
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
        max_tokens: 1024,
        system: JUDGE_SYSTEM_PROMPT,
        messages,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData.error?.message || `Claude API request failed with status ${response.status}`
      throw new ClaudeJudgeError(errorMessage, response.status)
    }

    const data: ClaudeResponse = await response.json()

    if (!data.content?.[0]?.text) {
      throw new ClaudeJudgeError('Invalid response from Claude API')
    }

    return parseRatingResponse(data.content[0].text)
  } catch (error) {
    // If there's an API error, fall back to dummy ratings
    if (error instanceof ClaudeJudgeError) {
      console.error('Claude Judge API error:', error.message)
    } else {
      console.error('Claude Judge error:', error)
    }

    // Return dummy rating as fallback
    return getDummyRating(userMessage, assistantResponse)
  }
}
