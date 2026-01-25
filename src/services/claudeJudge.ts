import type { QualityRating } from '../types'

const dummyRatings: Array<{ score: number; explanation: string; problems: string[] }> = [
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

export async function getQualityRating(
  userMessage: string,
  assistantResponse: string
): Promise<QualityRating> {
  // Simulate API delay (will use userMessage and assistantResponse when connecting to real Claude API)
  await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000))

  // Use a hash of the inputs to get a consistent rating for the same messages (for demo purposes)
  const hash = (userMessage + assistantResponse).length
  const rating = dummyRatings[hash % dummyRatings.length]

  return {
    score: rating.score,
    explanation: rating.explanation,
    problems: rating.problems,
  }
}
