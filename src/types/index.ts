export interface QualityRating {
  score: number // 1.0 to 10.0 (two significant figures)
  explanation: string
  problems: string[]
}

export interface JudgeRatings {
  claude?: QualityRating
  gemini?: QualityRating
}

export interface Message {
  id: string
  content: string
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
}
