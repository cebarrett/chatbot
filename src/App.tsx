import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Box, Typography, Paper, Alert, Snackbar, IconButton, Tooltip, CircularProgress, useMediaQuery, useTheme as useMuiTheme } from '@mui/material'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import MenuIcon from '@mui/icons-material/Menu'
import { useTheme } from './contexts/ThemeContext'
import { AuthLayout, UserButton } from './components/AuthLayout'
import { ChatMessage } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import { ChatHistorySidebar } from './components/ChatHistorySidebar'
import { ProviderSelector } from './components/ProviderSelector'
import type { Message, Chat } from './types'
import { getDummyResponse, generateId } from './utils/dummyResponses'
import {
  listChats as fetchChatList,
  getChat as fetchChat,
  createChat as createChatRemote,
  updateChat as updateChatRemote,
  deleteChat as deleteChatRemote,
  saveMessage as saveMessageRemote,
  updateMessage as updateMessageRemote,
  generateChatTitle,
} from './services/chatHistoryService'
import {
  getProviderById,
  DEFAULT_PROVIDER_ID,
} from './services/chatProviderRegistry'
import {
  loadEnabledJudges,
  saveEnabledJudges,
  fetchRatingsFromJudges,
} from './services/judgeRegistry'
import { JudgeSelector } from './components/JudgeSelector'
import type { QualityRating } from './types'

const SYSTEM_PROMPT = `You are a helpful, friendly assistant. Be concise and clear in your responses.`

function App() {
  const { isLoaded, isSignedIn } = useAuth()
  const [chats, setChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [isTyping, setIsTyping] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enabledJudges, setEnabledJudges] = useState<string[]>(() => loadEnabledJudges())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { resolvedMode, toggleMode } = useTheme()
  const muiTheme = useMuiTheme()
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('md'))
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const activeChat = chats.find((c) => c.id === activeChatId) || null
  const activeProviderId = activeChat?.providerId || DEFAULT_PROVIDER_ID
  const activeProvider = getProviderById(activeProviderId)
  const providerConfigured = activeProvider?.isConfigured() ?? false
  const messages = useMemo(() => activeChat?.messages || [], [activeChat?.messages])

  // Load chat list once auth is ready
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return

    let cancelled = false

    async function loadChatList() {
      try {
        const result = await fetchChatList()
        if (cancelled) return
        setChats(result.chats)
        // Don't auto-select a chat - show new chat window on startup
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load chat list:', err)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadChatList()
    return () => { cancelled = true }
  }, [isLoaded, isSignedIn])

  // Load messages when active chat changes
  useEffect(() => {
    if (!activeChatId) return

    // If the active chat already has messages loaded, skip fetching
    const chat = chats.find((c) => c.id === activeChatId)
    if (chat && chat.messages.length > 0) return

    let cancelled = false

    async function loadChatMessages() {
      try {
        const fullChat = await fetchChat(activeChatId!)
        if (cancelled || !fullChat) return

        setChats((prev) =>
          prev.map((c) =>
            c.id === activeChatId
              ? { ...c, messages: fullChat.messages }
              : c
          )
        )
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load chat messages:', err)
      }
    }

    loadChatMessages()
    return () => { cancelled = true }
  }, [activeChatId]) // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Track pending createChat promises so saveMessage can await them
  const pendingCreates = useRef<Map<string, Promise<unknown>>>(new Map())

  const createNewChat = useCallback(() => {
    const chatId = generateId()
    const now = new Date()
    const newChat: Chat = {
      id: chatId,
      title: 'New Chat',
      messages: [],
      createdAt: now,
      updatedAt: now,
      providerId: DEFAULT_PROVIDER_ID,
    }
    setChats((prev) => [newChat, ...prev])
    setActiveChatId(chatId)

    // Persist to DynamoDB — store the promise so saveMessage can await it
    const createPromise = createChatRemote({
      chatId,
      title: 'New Chat',
      providerId: DEFAULT_PROVIDER_ID,
    }).catch((err) => console.error('Failed to create chat:', err))

    pendingCreates.current.set(chatId, createPromise)
    createPromise.finally(() => pendingCreates.current.delete(chatId))

    return chatId
  }, [])

  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId)
  }

  const handleNewChat = useCallback(() => {
    // Just clear the active chat to show new chat window
    // The chat will be created and persisted when user sends first message
    setActiveChatId(null)
  }, [])

  const handleDeleteChat = useCallback((chatId: string) => {
    setChats((prev) => {
      const filtered = prev.filter((c) => c.id !== chatId)
      if (chatId === activeChatId) {
        setActiveChatId(filtered.length > 0 ? filtered[0].id : null)
      }
      return filtered
    })

    // Persist to DynamoDB (non-blocking)
    deleteChatRemote(chatId).catch((err) =>
      console.error('Failed to delete chat:', err)
    )
  }, [activeChatId])

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
    (chatId: string, messageId: string, messageTimestamp: Date, judgeId: string, rating: QualityRating) => {
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id === chatId) {
            return {
              ...chat,
              messages: chat.messages.map((msg) => {
                if (msg.id === messageId) {
                  const updatedRatings = {
                    ...msg.judgeRatings,
                    [judgeId]: rating,
                  }

                  // Persist judge rating to DynamoDB (non-blocking)
                  updateMessageRemote({
                    chatId,
                    messageId,
                    timestamp: messageTimestamp.toISOString(),
                    judgeRatings: JSON.stringify(updatedRatings),
                  }).catch((err) =>
                    console.error('Failed to persist judge rating:', err)
                  )

                  return {
                    ...msg,
                    judgeRatings: updatedRatings,
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

  const handleChangeProvider = useCallback(
    (providerId: string) => {
      if (!activeChatId) return
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id === activeChatId) {
            return {
              ...chat,
              providerId,
              updatedAt: new Date(),
            }
          }
          return chat
        })
      )

      // Persist to DynamoDB (non-blocking)
      updateChatRemote({
        chatId: activeChatId,
        providerId,
      }).catch((err) => console.error('Failed to update chat provider:', err))
    },
    [activeChatId]
  )

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
      timestamp: new Date(userMessage.timestamp.getTime() + 1),
    }

    // Determine if this is the first message (for title generation)
    const currentChat = chats.find((c) => c.id === currentChatId)
    const isFirstMessage = !currentChat || currentChat.messages.length === 0

    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id === currentChatId) {
          const updatedMessages = [...chat.messages, userMessage, botMessage]
          const newTitle = isFirstMessage ? generateChatTitle(updatedMessages) : chat.title
          return {
            ...chat,
            messages: updatedMessages,
            title: newTitle,
            updatedAt: new Date(),
          }
        }
        return chat
      })
    )

    // Ensure the chat exists in DynamoDB before saving messages
    const pendingCreate = pendingCreates.current.get(currentChatId)
    if (pendingCreate) {
      await pendingCreate
    }

    // Save user message to DynamoDB (non-blocking)
    saveMessageRemote({
      chatId: currentChatId,
      messageId: userMessage.id,
      role: 'user',
      content: userMessage.content,
      timestamp: userMessage.timestamp.toISOString(),
    }).catch((err) => console.error('Failed to save user message:', err))

    // Update chat title if this is the first message
    if (isFirstMessage) {
      const newTitle = generateChatTitle([userMessage])
      updateChatRemote({
        chatId: currentChatId,
        title: newTitle,
      }).catch((err) => console.error('Failed to update chat title:', err))
    }

    setIsTyping(true)
    setError(null)

    const chatIdForStream = currentChatId

    try {
      const messagesForApi = [...(currentChat?.messages || []), userMessage]
      const provider = getProviderById(currentChat?.providerId || DEFAULT_PROVIDER_ID)

      let finalResponse = ''

      if (provider?.isConfigured()) {
        await provider.sendMessageStream(messagesForApi, SYSTEM_PROMPT, (streamedContent) => {
          finalResponse = streamedContent
          updateBotMessage(chatIdForStream, botMessageId, streamedContent)
        })
      } else {
        finalResponse = getDummyResponse()
        await streamDummyResponse(chatIdForStream, botMessageId, finalResponse)
      }

      // Save completed assistant message to DynamoDB (non-blocking)
      saveMessageRemote({
        chatId: chatIdForStream,
        messageId: botMessageId,
        role: 'assistant',
        content: finalResponse,
        timestamp: botMessage.timestamp.toISOString(),
      }).catch((err) => console.error('Failed to save assistant message:', err))

      // Fetch quality ratings from enabled judges in parallel (async, non-blocking)
      if (enabledJudges.length > 0) {
        const respondingProviderId = currentChat?.providerId || DEFAULT_PROVIDER_ID
        fetchRatingsFromJudges(
          enabledJudges,
          messagesForApi,
          finalResponse,
          respondingProviderId,
          (judgeId, rating) => {
            updateMessageRating(chatIdForStream, botMessageId, botMessage.timestamp, judgeId, rating)
          }
        )
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred'
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
    <AuthLayout>
      <Box
        sx={{
          height: '100vh',
          display: 'flex',
          bgcolor: 'background.default',
        }}
      >
        <ChatHistorySidebar
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onDeleteChat={handleDeleteChat}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
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
          {isMobile && (
            <IconButton
              onClick={() => setSidebarOpen(true)}
              edge="start"
              sx={{ mr: 0.5 }}
            >
              <MenuIcon />
            </IconButton>
          )}
          <SmartToyIcon color="primary" />
          <Typography variant="h6" component="h1">
            Chatbot
          </Typography>
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
            <ProviderSelector
              selectedProviderId={activeProviderId}
              onSelectProvider={handleChangeProvider}
              disabled={isTyping || !activeChatId}
            />
            <JudgeSelector enabledJudges={enabledJudges} onToggleJudge={handleToggleJudge} />
            <Tooltip title={resolvedMode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
              <IconButton onClick={toggleMode} size="small">
                {resolvedMode === 'light' ? <DarkModeIcon /> : <LightModeIcon />}
              </IconButton>
            </Tooltip>
            <UserButton afterSignOutUrl="/" />
            {!providerConfigured && (
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
            p: { xs: 1, sm: 2 },
          }}
        >
          {isLoading ? (
            <Box
              sx={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CircularProgress />
            </Box>
          ) : messages.length === 0 ? (
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
                {providerConfigured
                  ? 'Send a message to start the conversation'
                  : 'Running in demo mode. Configure AppSync backend to enable AI responses.'}
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
    </AuthLayout>
  )
}

export default App
