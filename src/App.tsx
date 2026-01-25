import { useState, useRef, useEffect } from 'react'
import { Box, Typography, Paper, Alert, Snackbar } from '@mui/material'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { ChatMessage } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import type { Message } from './types'
import { getDummyResponse, generateId } from './utils/dummyResponses'
import { sendMessage, isConfigured, OpenAIError } from './services/openai'

const SYSTEM_PROMPT = `You are a helpful, friendly assistant. Be concise and clear in your responses.`

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const apiConfigured = isConfigured()

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async (content: string) => {
    const userMessage: Message = {
      id: generateId(),
      content,
      role: 'user',
      timestamp: new Date(),
    }

    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setIsTyping(true)
    setError(null)

    try {
      let responseContent: string

      if (apiConfigured) {
        // Use OpenAI API
        responseContent = await sendMessage(updatedMessages, SYSTEM_PROMPT)
      } else {
        // Fallback to dummy responses
        await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000))
        responseContent = getDummyResponse()
      }

      const botMessage: Message = {
        id: generateId(),
        content: responseContent,
        role: 'assistant',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, botMessage])
    } catch (err) {
      const errorMessage = err instanceof OpenAIError ? err.message : 'An unexpected error occurred'
      setError(errorMessage)
    } finally {
      setIsTyping(false)
    }
  }

  const handleCloseError = () => {
    setError(null)
  }

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'grey.50',
      }}
    >
      {/* Header */}
      <Paper
        elevation={1}
        sx={{
          p: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderRadius: 0,
        }}
      >
        <SmartToyIcon color="primary" />
        <Typography variant="h6" component="h1">
          Chatbot
        </Typography>
        {!apiConfigured && (
          <Typography
            variant="caption"
            sx={{
              ml: 'auto',
              bgcolor: 'warning.light',
              color: 'warning.contrastText',
              px: 1,
              py: 0.5,
              borderRadius: 1,
            }}
          >
            Demo Mode
          </Typography>
        )}
      </Paper>

      {/* Messages area */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
        }}
      >
        {messages.length === 0 ? (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.secondary',
            }}
          >
            <SmartToyIcon sx={{ fontSize: 64, mb: 2, opacity: 0.5 }} />
            <Typography variant="h6">Welcome to Chatbot</Typography>
            <Typography variant="body2">
              {apiConfigured
                ? 'Send a message to start the conversation'
                : 'Running in demo mode. Add your OpenAI API key to enable AI responses.'}
            </Typography>
          </Box>
        ) : (
          <>
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {isTyping && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 1, color: 'text.secondary' }}>
                <SmartToyIcon fontSize="small" />
                <Typography variant="body2">Typing...</Typography>
              </Box>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </Box>

      {/* Input area */}
      <ChatInput onSend={handleSend} disabled={isTyping} />

      {/* Error snackbar */}
      <Snackbar open={!!error} autoHideDuration={6000} onClose={handleCloseError}>
        <Alert onClose={handleCloseError} severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default App
