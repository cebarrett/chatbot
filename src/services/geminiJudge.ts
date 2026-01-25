import type { QualityRating } from '../types'

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

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

export class GeminiJudgeError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GeminiJudgeError'
    this.status = status
  }
}

function getApiKey(): string | null {
  return import.meta.env.VITE_GEMINI_API_KEY || null
}

export function isGeminiJudgeConfigured(): boolean {
  return !!import.meta.env.VITE_GEMINI_API_KEY
}

// Dummy ratings for fallback when API is not configured
const dummyRatings: QualityRating[] = [
  {
    score: 8.2,
    explanation:
      'The response demonstrates good understanding and provides useful information. Structure is clear and the tone is appropriate.',
    problems: [
      'Could elaborate more on potential edge cases',
      'Missing a concrete example to illustrate the concept',
    ],
  },
  {
    score: 7.5,
    explanation:
      'Solid response that addresses the main question. The explanation is reasonably clear though could be more detailed.',
    problems: [
      'Skips over some intermediate steps',
      'Assumes familiarity with related concepts',
      'Could benefit from better formatting',
    ],
  },
  {
    score: 9.3,
    explanation:
      'Excellent response with comprehensive coverage. Well-organized, accurate, and provides actionable guidance.',
    problems: ['Very minor: Could mention alternative approaches'],
  },
  {
    score: 6.0,
    explanation:
      'Adequate response but lacks depth. Covers basics but misses nuances that would make it more useful.',
    problems: [
      'Oversimplifies the problem',
      'Does not address potential complications',
      'Could be more specific about implementation details',
      'Lacks context for why this approach is preferred',
    ],
  },
  {
    score: 5.2,
    explanation:
      'The response provides some relevant information but has notable gaps and could be misleading in parts.',
    problems: [
      'Incomplete explanation of key concept',
      'May lead to incorrect implementation',
      'Missing important caveats',
      'Tone is somewhat dismissive',
    ],
  },
  {
    score: 9.5,
    explanation:
      'Outstanding response that thoroughly addresses all aspects of the question. Clear, well-structured, and immediately actionable.',
    problems: [],
  },
  {
    score: 6.8,
    explanation:
      'Reasonable response with correct information but presentation could be improved. Gets the job done but not elegantly.',
    problems: [
      'Verbose in some sections',
      'Key points buried in lengthy paragraphs',
      'Could use better examples',
    ],
  },
  {
    score: 7.8,
    explanation:
      'Good response with accurate content and helpful structure. Addresses the question well with minor room for improvement.',
    problems: [
      'Could provide more context for beginners',
      'Some jargon used without explanation',
    ],
  },
]

function getDummyRating(userMessage: string, assistantResponse: string): QualityRating {
  // Use a different hash calculation than Claude to get varied dummy ratings
  const hash = (userMessage.length * 7 + assistantResponse.length * 3) % dummyRatings.length
  return dummyRatings[hash]
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
  }>
  error?: {
    message?: string
  }
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

export async function getGeminiQualityRating(
  userMessage: string,
  assistantResponse: string
): Promise<QualityRating> {
  const apiKey = getApiKey()

  // Fall back to dummy ratings if API is not configured
  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 600 + Math.random() * 800))
    return getDummyRating(userMessage, assistantResponse)
  }

  const model = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.0-flash'
  const url = `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`

  const prompt = `${JUDGE_SYSTEM_PROMPT}

Please evaluate the following AI assistant response.

**User's Message:**
${userMessage}

**Assistant's Response:**
${assistantResponse}

Provide your quality rating as a JSON object.`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData.error?.message || `Gemini API request failed with status ${response.status}`
      throw new GeminiJudgeError(errorMessage, response.status)
    }

    const data: GeminiResponse = await response.json()

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      throw new GeminiJudgeError('Invalid response from Gemini API')
    }

    return parseRatingResponse(text)
  } catch (error) {
    // If there's an API error, fall back to dummy ratings
    if (error instanceof GeminiJudgeError) {
      console.error('Gemini Judge API error:', error.message)
    } else {
      console.error('Gemini Judge error:', error)
    }

    // Return dummy rating as fallback
    return getDummyRating(userMessage, assistantResponse)
  }
}
