import { useState, useRef, useEffect } from 'react'
import { Box, Typography, Paper } from '@mui/material'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { ChatMessage } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import type { Message } from './types'
import { getDummyResponse, generateId } from './utils/dummyResponses'

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

    setMessages((prev) => [...prev, userMessage])
    setIsTyping(true)

    // Simulate API delay
    setTimeout(() => {
      const botMessage: Message = {
        id: generateId(),
        content: getDummyResponse(),
        role: 'assistant',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, botMessage])
      setIsTyping(false)
    }, 1000 + Math.random() * 1000)
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
            <Typography variant="body2">Send a message to start the conversation</Typography>
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
    </Box>
  )
}

export default App
