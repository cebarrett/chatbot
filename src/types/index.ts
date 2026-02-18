export interface JudgeFollowUp {
  question: string
  answer: string
}

export interface QualityRating {
  score: number // 1.0 to 10.0 (two significant figures)
  explanation: string
  problems: string[]
  followUp?: JudgeFollowUp
}

// Dynamic judge ratings - keyed by judge ID
export type JudgeRatings = Record<string, QualityRating>

// Judge error info for displaying failure notices
export interface JudgeError {
  judgeId: string
  judgeName: string
  error: string
}

// Structured content block for messages with mixed text/image content
export interface ContentBlock {
  type: 'text' | 'image'
  text?: string           // For type: 'text'
  imageUrl?: string       // For type: 'image' — S3 presigned URL or data URI
  mimeType?: string       // For type: 'image' — e.g. 'image/png'
  alt?: string            // For type: 'image' — accessibility text / prompt used
  width?: number
  height?: number
}

export interface Message {
  id: string
  content: string                    // Plain text / markdown (always populated for search, history)
  contentBlocks?: ContentBlock[]     // Structured content with images (when present)
  role: 'user' | 'assistant'
  timestamp: Date
  judgeRatings?: JudgeRatings
}

export interface Chat {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
  updatedAt: Date
  providerId?: string // Chat provider (claude, openai, gemini) - defaults to claude
  incognito?: boolean // Ephemeral chat - not persisted to DynamoDB
}
