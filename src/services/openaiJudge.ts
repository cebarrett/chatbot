import type { QualityRating, Message } from '../types'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

const JUDGE_SYSTEM_PROMPT = `You are an expert AI response quality evaluator. Your task is to assess the quality of an AI assistant's LATEST response in a conversation.

You will be given the full conversation history for context, then asked to evaluate only the most recent assistant response.

Evaluate the response on these criteria:
1. **Accuracy**: Is the information factually correct? Are there any errors or misleading statements?
2. **Completeness**: Does the response fully address the user's question or request, considering the conversation context?
3. **Clarity**: Is the response well-organized, easy to understand, and appropriately concise?
4. **Helpfulness**: Does the response provide practical, actionable information?
5. **Tone**: Is the tone appropriate for the context (professional yet friendly)?
6. **Context Awareness**: Does the response appropriately reference and build upon earlier parts of the conversation when relevant?

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

export class OpenAIJudgeError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'OpenAIJudgeError'
    this.status = status
  }
}

function getApiKey(): string | null {
  return import.meta.env.VITE_OPENAI_API_KEY || null
}

export function isOpenAIJudgeConfigured(): boolean {
  return !!import.meta.env.VITE_OPENAI_API_KEY
}

// Dummy ratings for fallback when API is not configured
const dummyRatings: QualityRating[] = [
  {
    score: 8.3,
    explanation:
      'The response is informative and well-structured. It provides accurate information with good clarity and addresses the user query effectively.',
    problems: [
      'Could include more practical examples',
      'Some technical details could be expanded upon',
    ],
  },
  {
    score: 7.1,
    explanation:
      'A reasonable response that covers the essentials. The explanation is clear but could be more thorough in addressing edge cases.',
    problems: [
      'Missing coverage of alternative approaches',
      'Could be more concise in the introduction',
      'Does not mention potential pitfalls',
    ],
  },
  {
    score: 9.2,
    explanation:
      'Excellent response with comprehensive coverage and clear explanations. Well-organized and provides actionable guidance with appropriate context.',
    problems: ['Minor: Could add references for further reading'],
  },
  {
    score: 6.5,
    explanation:
      'Adequate response but lacks depth in key areas. The basics are covered but important nuances are missing.',
    problems: [
      'Oversimplifies complex concepts',
      'Missing important context',
      'Could provide more specific guidance',
      'Does not address follow-up considerations',
    ],
  },
  {
    score: 4.5,
    explanation:
      'The response has significant issues that affect its usefulness. While attempting to address the question, it contains notable gaps.',
    problems: [
      'Contains potentially misleading information',
      'Incomplete coverage of the topic',
      'Structure makes it hard to follow',
      'Lacks practical applicability',
    ],
  },
  {
    score: 9.6,
    explanation:
      'Outstanding response demonstrating excellent understanding. Comprehensive, accurate, and exceptionally well-presented with clear actionable steps.',
    problems: [],
  },
  {
    score: 5.8,
    explanation:
      'The response provides basic information but falls short of being truly helpful. More detail and clarity would improve it significantly.',
    problems: [
      'Too generic to be actionable',
      'Misses key considerations',
      'Could benefit from examples',
    ],
  },
  {
    score: 8.1,
    explanation:
      'Good response with accurate information and logical structure. Addresses the main question well with only minor areas for improvement.',
    problems: [
      'Could elaborate on certain points',
      'Some assumed knowledge not explained',
    ],
  },
]

function getDummyRating(conversationHistory: Message[], latestResponse: string): QualityRating {
  // Use a different hash calculation to get varied dummy ratings
  const lastUserMessage = conversationHistory.filter((m) => m.role === 'user').pop()?.content || ''
  const hash = (lastUserMessage.length * 5 + latestResponse.length * 11) % dummyRatings.length
  return dummyRatings[hash]
}

function formatConversationHistory(messages: Message[]): string {
  if (messages.length === 0) return 'No prior conversation.'

  return messages
    .map((msg, index) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant'
      return `[${index + 1}] ${role}:\n${msg.content}`
    })
    .join('\n\n')
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string
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

export async function getOpenAIQualityRating(
  conversationHistory: Message[],
  latestResponse: string
): Promise<QualityRating> {
  const apiKey = getApiKey()

  // Fall back to dummy ratings if API is not configured
  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 550 + Math.random() * 900))
    return getDummyRating(conversationHistory, latestResponse)
  }

  const model = import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o'
  const formattedHistory = formatConversationHistory(conversationHistory)

  const messages: OpenAIMessage[] = [
    {
      role: 'system',
      content: JUDGE_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: `Please evaluate the AI assistant's LATEST response in this conversation.

## Conversation History:
${formattedHistory}

## Latest Response to Evaluate:
${latestResponse}

Provide your quality rating as a JSON object.`,
    },
  ]

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData.error?.message || `OpenAI API request failed with status ${response.status}`
      throw new OpenAIJudgeError(errorMessage, response.status)
    }

    const data: OpenAIResponse = await response.json()

    const text = data.choices?.[0]?.message?.content
    if (!text) {
      throw new OpenAIJudgeError('Invalid response from OpenAI API')
    }

    return parseRatingResponse(text)
  } catch (error) {
    // If there's an API error, fall back to dummy ratings
    if (error instanceof OpenAIJudgeError) {
      console.error('OpenAI Judge API error:', error.message)
    } else {
      console.error('OpenAI Judge error:', error)
    }

    // Return dummy rating as fallback
    return getDummyRating(conversationHistory, latestResponse)
  }
}
