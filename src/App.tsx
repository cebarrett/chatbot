import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Box, Typography, Paper, Alert, Snackbar } from '@mui/material'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { ChatMessage } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import { ChatHistorySidebar } from './components/ChatHistorySidebar'
import type { Message, Chat } from './types'
import { getDummyResponse, generateId } from './utils/dummyResponses'
import { loadChats, saveChats, generateChatTitle } from './utils/chatStorage'
import { sendMessageStream, isConfigured, OpenAIError } from './services/openai'
import {
  loadEnabledJudges,
  saveEnabledJudges,
  fetchRatingsFromJudges,
} from './services/judgeRegistry'
import { JudgeSelector } from './components/JudgeSelector'
import type { QualityRating } from './types'

const SYSTEM_PROMPT = `You are a helpful, friendly assistant. Be concise and clear in your responses.`

function App() {
  const [chats, setChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [isTyping, setIsTyping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enabledJudges, setEnabledJudges] = useState<string[]>(() => loadEnabledJudges())
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const apiConfigured = isConfigured()

  const activeChat = chats.find((c) => c.id === activeChatId) || null
  const messages = useMemo(() => activeChat?.messages || [], [activeChat?.messages])

  useEffect(() => {
    const savedChats = loadChats()
    setChats(savedChats)
    if (savedChats.length > 0) {
      setActiveChatId(savedChats[0].id)
    }
  }, [])

  useEffect(() => {
    if (chats.length > 0) {
      saveChats(chats)
    }
  }, [chats])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const createNewChat = useCallback(() => {
    const newChat: Chat = {
      id: generateId(),
      title: 'New Chat',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    setChats((prev) => [newChat, ...prev])
    setActiveChatId(newChat.id)
    return newChat.id
  }, [])

  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId)
  }

  const handleDeleteChat = (chatId: string) => {
    setChats((prev) => {
      const filtered = prev.filter((c) => c.id !== chatId)
      if (chatId === activeChatId) {
        setActiveChatId(filtered.length > 0 ? filtered[0].id : null)
      }
      if (filtered.length === 0) {
        localStorage.removeItem('chatbot_history')
      }
      return filtered
    })
  }

  const updateBotMessage = useCallback((chatId: string, messageId: string, content: string) => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id === chatId) {
          return {
            ...chat,
            messages: chat.messages.map((msg) =>
              msg.id === messageId ? { ...msg, content } : msg
            ),
            updatedAt: new Date(),
          }
        }
        return chat
      })
    )
  }, [])

  const updateMessageRating = useCallback(
    (chatId: string, messageId: string, judgeId: string, rating: QualityRating) => {
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id === chatId) {
            return {
              ...chat,
              messages: chat.messages.map((msg) => {
                if (msg.id === messageId) {
                  return {
                    ...msg,
                    judgeRatings: {
                      ...msg.judgeRatings,
                      [judgeId]: rating,
                    },
                  }
                }
                return msg
              }),
            }
          }
          return chat
        })
      )
    },
    []
  )

  const handleToggleJudge = useCallback((judgeId: string) => {
    setEnabledJudges((prev) => {
      const newEnabled = prev.includes(judgeId)
        ? prev.filter((id) => id !== judgeId)
        : [...prev, judgeId]
      saveEnabledJudges(newEnabled)
      return newEnabled
    })
  }, [])

  const streamDummyResponse = async (
    chatId: string,
    messageId: string,
    fullResponse: string
  ) => {
    const words = fullResponse.split(' ')
    let accumulated = ''

    for (let i = 0; i < words.length; i++) {
      accumulated += (i === 0 ? '' : ' ') + words[i]
      updateBotMessage(chatId, messageId, accumulated)
      await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 50))
    }
  }

  const handleSend = async (content: string) => {
    let currentChatId = activeChatId
    if (!currentChatId) {
      currentChatId = createNewChat()
    }

    const userMessage: Message = {
      id: generateId(),
      content,
      role: 'user',
      timestamp: new Date(),
    }

    const botMessageId = generateId()
    const botMessage: Message = {
      id: botMessageId,
      content: '',
      role: 'assistant',
      timestamp: new Date(),
    }

    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id === currentChatId) {
          const updatedMessages = [...chat.messages, userMessage, botMessage]
          return {
            ...chat,
            messages: updatedMessages,
            title: chat.messages.length === 0 ? generateChatTitle(updatedMessages) : chat.title,
            updatedAt: new Date(),
          }
        }
        return chat
      })
    )

    setIsTyping(true)
    setError(null)

    const chatIdForStream = currentChatId

    try {
      const currentChat = chats.find((c) => c.id === currentChatId)
      const messagesForApi = [...(currentChat?.messages || []), userMessage]

      let finalResponse = ''

      if (apiConfigured) {
        await sendMessageStream(messagesForApi, SYSTEM_PROMPT, (streamedContent) => {
          finalResponse = streamedContent
          updateBotMessage(chatIdForStream, botMessageId, streamedContent)
        })
      } else {
        finalResponse = getDummyResponse()
        await streamDummyResponse(chatIdForStream, botMessageId, finalResponse)
      }

      // Fetch quality ratings from enabled judges in parallel (async, non-blocking)
      // Pass full conversation history for context-aware evaluation
      if (enabledJudges.length > 0) {
        fetchRatingsFromJudges(
          enabledJudges,
          messagesForApi,
          finalResponse,
          (judgeId, rating) => {
            updateMessageRating(chatIdForStream, botMessageId, judgeId, rating)
          }
        )
      }
    } catch (err) {
      const errorMessage = err instanceof OpenAIError ? err.message : 'An unexpected error occurred'
      setError(errorMessage)
      // Remove the empty bot message on error
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id === chatIdForStream) {
            return {
              ...chat,
              messages: chat.messages.filter((msg) => msg.id !== botMessageId),
            }
          }
          return chat
        })
      )
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
        bgcolor: 'grey.50',
      }}
    >
      <ChatHistorySidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={createNewChat}
        onDeleteChat={handleDeleteChat}
      />

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
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
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
            <JudgeSelector enabledJudges={enabledJudges} onToggleJudge={handleToggleJudge} />
            {!apiConfigured && (
              <Typography
                variant="caption"
                sx={{
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
          </Box>
        </Paper>

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
                <ChatMessage key={message.id} message={message} enabledJudges={enabledJudges} />
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

        <ChatInput onSend={handleSend} disabled={isTyping} />
      </Box>

      <Snackbar open={!!error} autoHideDuration={6000} onClose={handleCloseError}>
        <Alert onClose={handleCloseError} severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default App
