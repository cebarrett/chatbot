const responses = [
  "The AI backend is not configured yet. Please set the VITE_APPSYNC_URL environment variable to connect to your AppSync backend.",
  "This chatbot needs a backend connection to respond. Ask your administrator to configure the AppSync endpoint.",
  "No AI provider is connected. To enable real responses, the backend API must be set up first.",
  "The backend service is not available. Once it's configured, you'll be able to chat with AI providers like Claude, ChatGPT, and Gemini.",
]

export function getDummyResponse(): string {
  const randomIndex = Math.floor(Math.random() * responses.length)
  return responses[randomIndex]
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}
