const responses = [
  "That's an interesting question! I'm currently running in demo mode, so I can't provide a real answer yet.",
  "Thanks for your message! Once I'm connected to an LLM API, I'll be able to give you a proper response.",
  "I appreciate you testing out this chat interface! Real AI responses coming soon.",
  "Hello! I'm a placeholder chatbot. My real intelligence is still being connected.",
  "Great question! In the future, I'll be powered by an AI model to give you helpful answers.",
  "I'm just a demo bot for now, but soon I'll be able to have real conversations with you!",
  "Thanks for chatting! This is a test response while the AI backend is being set up.",
  "I received your message! When the LLM integration is complete, I'll provide meaningful responses.",
]

export function getDummyResponse(): string {
  const randomIndex = Math.floor(Math.random() * responses.length)
  return responses[randomIndex]
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}
