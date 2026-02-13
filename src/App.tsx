import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Box, Typography, Paper, Alert, Snackbar, IconButton, Tooltip, CircularProgress, useMediaQuery, useTheme as useMuiTheme, Chip, Button } from '@mui/material'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import MenuIcon from '@mui/icons-material/Menu'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { useTheme } from './contexts/ThemeContext'
import { AuthLayout, UserButton } from './components/AuthLayout'
import { ChatMessage } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import { ChatHistorySidebar } from './components/ChatHistorySidebar'
import { ProviderSelector } from './components/ProviderSelector'
import type { Message, Chat, JudgeFollowUp, JudgeError } from './types'
import { getDummyResponse, generateId } from './utils/dummyResponses'
import {
  listChats as fetchChatList,
  getChat as fetchChat,
  createChat as createChatRemote,
  updateChat as updateChatRemote,
  deleteChat as deleteChatRemote,
  saveMessage as saveMessageRemote,
  updateMessage as updateMessageRemote,
  deleteMessage as deleteMessageRemote,
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
  const [errorSeverity, setErrorSeverity] = useState<'error' | 'warning'>('error')
  const [enabledJudges, setEnabledJudges] = useState<string[]>(() => loadEnabledJudges())
  const [editValue, setEditValue] = useState<string | null>(null)
  const [judgingMessageId, setJudgingMessageId] = useState<string | null>(null)
  const [pendingJudges, setPendingJudges] = useState<string[]>([])
  const [failedJudges, setFailedJudges] = useState<Map<string, JudgeError[]>>(new Map())
  const [responseStalled, setResponseStalled] = useState(false)
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const streamCancelRef = useRef<(() => void) | null>(null)
  const judgeCancelRef = useRef<(() => void) | null>(null)
  const { resolvedMode, toggleMode } = useTheme()
  const muiTheme = useMuiTheme()
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('md'))
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [incognitoMode, setIncognitoMode] = useState(false)
  const [newChatProviderId, setNewChatProviderId] = useState(DEFAULT_PROVIDER_ID)

  const activeChat = chats.find((c) => c.id === activeChatId) || null
  const activeProviderId = activeChat?.providerId || newChatProviderId
  const activeProvider = getProviderById(activeProviderId)
  const providerConfigured = activeProvider?.isConfigured() ?? false
  const messages = useMemo(() => activeChat?.messages || [], [activeChat?.messages])

  // Find the last user message ID for the edit button
  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i].id
      }
    }
    return null
  }, [messages])

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

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const { scrollTop, scrollHeight, clientHeight } = container
    // Consider "near bottom" if within 150px of the bottom
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 150
  }, [])

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom()
    }
  }, [messages])

  // Track pending createChat promises so saveMessage can await them
  const pendingCreates = useRef<Map<string, Promise<unknown>>>(new Map())

  const createNewChat = useCallback((isIncognito: boolean = false) => {
    const chatId = generateId()
    const now = new Date()
    const providerId = newChatProviderId
    const newChat: Chat = {
      id: chatId,
      title: isIncognito ? 'Incognito Chat' : 'New Chat',
      messages: [],
      createdAt: now,
      updatedAt: now,
      providerId,
      incognito: isIncognito || undefined,
    }
    setChats((prev) => [newChat, ...prev])
    setActiveChatId(chatId)

    // Skip persistence for incognito chats
    if (!isIncognito) {
      // Persist to DynamoDB — store the promise so saveMessage can await it
      const createPromise = createChatRemote({
        chatId,
        title: 'New Chat',
        providerId,
      }).catch((err) => console.error('Failed to create chat:', err))

      pendingCreates.current.set(chatId, createPromise)
      createPromise.finally(() => pendingCreates.current.delete(chatId))
    }

    return chatId
  }, [newChatProviderId])

  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId)
  }

  const handleNewChat = useCallback(() => {
    // Just clear the active chat to show new chat window
    // The chat will be created and persisted when user sends first message
    setActiveChatId(null)
    setNewChatProviderId(DEFAULT_PROVIDER_ID)
    setIncognitoMode(false)
  }, [])

  const handleDeleteChat = useCallback((chatId: string) => {
    const chatToDelete = chats.find((c) => c.id === chatId)
    setChats((prev) => {
      const filtered = prev.filter((c) => c.id !== chatId)
      if (chatId === activeChatId) {
        setActiveChatId(filtered.length > 0 ? filtered[0].id : null)
      }
      return filtered
    })

    // Skip persistence for incognito chats
    if (!chatToDelete?.incognito) {
      deleteChatRemote(chatId).catch((err) =>
        console.error('Failed to delete chat:', err)
      )
    }
  }, [activeChatId, chats])

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

                  // Skip persistence for incognito chats
                  if (!chat.incognito) {
                    updateMessageRemote({
                      chatId,
                      messageId,
                      timestamp: messageTimestamp.toISOString(),
                      judgeRatings: JSON.stringify(updatedRatings),
                    }).catch((err) =>
                      console.error('Failed to persist judge rating:', err)
                    )
                  }

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

  const handleDismissJudgeError = useCallback((messageId: string, judgeId: string) => {
    setFailedJudges((prev) => {
      const next = new Map(prev)
      const existing = next.get(messageId) || []
      const filtered = existing.filter((e) => e.judgeId !== judgeId)
      if (filtered.length === 0) {
        next.delete(messageId)
      } else {
        next.set(messageId, filtered)
      }
      return next
    })
  }, [])

  const handleFollowUpComplete = useCallback(
    (chatId: string, messageId: string, messageTimestamp: Date, judgeId: string, followUp: JudgeFollowUp) => {
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id === chatId) {
            return {
              ...chat,
              messages: chat.messages.map((msg) => {
                if (msg.id === messageId && msg.judgeRatings?.[judgeId]) {
                  const updatedRatings = {
                    ...msg.judgeRatings,
                    [judgeId]: {
                      ...msg.judgeRatings[judgeId],
                      followUp,
                    },
                  }

                  // Persist follow-up to DynamoDB (non-blocking)
                  updateMessageRemote({
                    chatId,
                    messageId,
                    timestamp: messageTimestamp.toISOString(),
                    judgeRatings: JSON.stringify(updatedRatings),
                  }).catch((err) =>
                    console.error('Failed to persist follow-up:', err)
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

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (!activeChatId) return
      const chatId = activeChatId
      const chat = chats.find((c) => c.id === chatId)
      if (!chat) return

      // Find the user message index
      const userMsgIdx = chat.messages.findIndex((m) => m.id === messageId)
      if (userMsgIdx < 0) return

      // Collect messages to delete: the user message and any immediately following assistant message
      const messagesToRemove: Message[] = [chat.messages[userMsgIdx]]
      if (
        userMsgIdx + 1 < chat.messages.length &&
        chat.messages[userMsgIdx + 1].role === 'assistant'
      ) {
        messagesToRemove.push(chat.messages[userMsgIdx + 1])
      }
      const idsToRemove = new Set(messagesToRemove.map((m) => m.id))

      // If we're deleting the last exchange, cancel any in-progress streaming or judging
      const isLastUserMsg = messageId === lastUserMessageId
      if (isLastUserMsg) {
        if (streamCancelRef.current) {
          streamCancelRef.current()
          streamCancelRef.current = null
          setIsTyping(false)
        }
        if (judgeCancelRef.current) {
          judgeCancelRef.current()
          judgeCancelRef.current = null
          setJudgingMessageId(null)
          setPendingJudges([])
        }
      }

      // Optimistically remove from local state
      setChats((prev) =>
        prev.map((c) => {
          if (c.id === chatId) {
            return {
              ...c,
              messages: c.messages.filter((m) => !idsToRemove.has(m.id)),
              updatedAt: new Date(),
            }
          }
          return c
        })
      )

      // Skip persistence for incognito chats
      if (!chat.incognito) {
        for (const msg of messagesToRemove) {
          deleteMessageRemote({
            chatId,
            messageId: msg.id,
            timestamp: msg.timestamp.toISOString(),
          }).catch((err) => console.error('Failed to delete message:', err))
        }
      }
    },
    [activeChatId, chats, lastUserMessageId]
  )

  const handleEditMessage = useCallback((content: string) => {
    setEditValue(content)
  }, [])

  const handleEditClear = useCallback(() => {
    setEditValue(null)
  }, [])

  const handleRenameChat = useCallback(
    (chatId: string, newTitle: string) => {
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId ? { ...chat, title: newTitle } : chat
        )
      )

      const chat = chats.find((c) => c.id === chatId)
      if (!chat?.incognito) {
        updateChatRemote({ chatId, title: newTitle }).catch((err) =>
          console.error('Failed to rename chat:', err)
        )
      }
    },
    [chats]
  )

  const handleChangeProvider = useCallback(
    (providerId: string) => {
      if (!activeChatId) {
        setNewChatProviderId(providerId)
        return
      }
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

      // Skip persistence for incognito chats
      const chat = chats.find((c) => c.id === activeChatId)
      if (!chat?.incognito) {
        updateChatRemote({
          chatId: activeChatId,
          providerId,
        }).catch((err) => console.error('Failed to update chat provider:', err))
      }
    },
    [activeChatId, chats]
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
    // Cancel any in-progress judge requests from previous messages
    if (judgeCancelRef.current) {
      judgeCancelRef.current()
      judgeCancelRef.current = null
      setJudgingMessageId(null)
      setPendingJudges([])
    }
    // Clear failed judges for the new message context
    setFailedJudges(new Map())

    // Cancel any in-progress stream if editing
    if (streamCancelRef.current) {
      streamCancelRef.current()
      streamCancelRef.current = null
    }

    let currentChatId = activeChatId
    if (!currentChatId) {
      currentChatId = createNewChat(incognitoMode)
    }

    const isIncognito = chats.find((c) => c.id === currentChatId)?.incognito || incognitoMode

    // If we're editing, remove the last user message and any following assistant message
    const isEditing = editValue !== null
    if (isEditing && currentChatId) {
      // Collect messages to delete from DynamoDB before removing from state
      const currentChatForEdit = chats.find((c) => c.id === currentChatId)
      if (currentChatForEdit && !isIncognito) {
        let lastUserIdx = -1
        for (let i = currentChatForEdit.messages.length - 1; i >= 0; i--) {
          if (currentChatForEdit.messages[i].role === 'user') {
            lastUserIdx = i
            break
          }
        }
        if (lastUserIdx >= 0) {
          const messagesToDelete = currentChatForEdit.messages.slice(lastUserIdx)
          // Delete old messages from DynamoDB (non-blocking)
          for (const msg of messagesToDelete) {
            deleteMessageRemote({
              chatId: currentChatId,
              messageId: msg.id,
              timestamp: msg.timestamp.toISOString(),
            }).catch((err) => console.error('Failed to delete old message:', err))
          }
        }
      }

      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id === currentChatId) {
            // Find the last user message index
            let lastUserIdx = -1
            for (let i = chat.messages.length - 1; i >= 0; i--) {
              if (chat.messages[i].role === 'user') {
                lastUserIdx = i
                break
              }
            }
            if (lastUserIdx >= 0) {
              // Remove the last user message and everything after it (the assistant response)
              return {
                ...chat,
                messages: chat.messages.slice(0, lastUserIdx),
                updatedAt: new Date(),
              }
            }
          }
          return chat
        })
      )
      setEditValue(null)
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
    // Re-fetch the chat after potential edit removal
    const currentChat = chats.find((c) => c.id === currentChatId)
    // Note: when editing, the messages have already been trimmed in the setChats call above
    // so we just check if the chat has messages
    const isFirstMessage = !currentChat || (isEditing
      ? (() => {
          // Find the last user message index in the original messages
          let idx = -1
          for (let i = (currentChat?.messages || []).length - 1; i >= 0; i--) {
            if (currentChat?.messages[i].role === 'user') { idx = i; break }
          }
          return idx <= 0  // First message if no user messages or only one
        })()
      : currentChat.messages.length === 0)

    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id === currentChatId) {
          // If editing, we need to use the already-trimmed messages
          const baseMessages = isEditing
            ? chat.messages  // Already trimmed in the previous setChats call
            : chat.messages
          const updatedMessages = [...baseMessages, userMessage, botMessage]
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

    // Skip all persistence for incognito chats
    if (!isIncognito) {
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
    }

    setIsTyping(true)
    setResponseStalled(false)
    setError(null)

    // Start a 30-second stall timer
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current)
    stallTimerRef.current = setTimeout(() => {
      setResponseStalled(true)
    }, 30000)

    const chatIdForStream = currentChatId

    try {
      // When editing, use trimmed messages (without the old user message and response)
      let baseMessagesForApi = currentChat?.messages || []
      if (isEditing) {
        // Find the last user message index
        let lastUserIdx = -1
        for (let i = baseMessagesForApi.length - 1; i >= 0; i--) {
          if (baseMessagesForApi[i].role === 'user') { lastUserIdx = i; break }
        }
        baseMessagesForApi = lastUserIdx >= 0 ? baseMessagesForApi.slice(0, lastUserIdx) : []
      }
      const messagesForApi = [...baseMessagesForApi, userMessage]
      const provider = getProviderById(currentChat?.providerId || newChatProviderId)

      let finalResponse = ''
      let wasCancelled = false

      if (provider?.isConfigured()) {
        const { promise, cancel } = provider.sendMessageStream(messagesForApi, SYSTEM_PROMPT, (streamedContent) => {
          finalResponse = streamedContent
          updateBotMessage(chatIdForStream, botMessageId, streamedContent)
          // Reset stall timer on each chunk received
          setResponseStalled(false)
          if (stallTimerRef.current) clearTimeout(stallTimerRef.current)
          stallTimerRef.current = setTimeout(() => setResponseStalled(true), 30000)
        })
        streamCancelRef.current = cancel
        const result = await promise
        finalResponse = result.content
        wasCancelled = result.cancelled
        streamCancelRef.current = null

        // Show notice if WebSocket disconnected mid-stream
        if (result.partial) {
          setErrorSeverity('warning')
          setError('Connection was interrupted. The response may be incomplete. You can try sending your message again.')
        }
      } else {
        finalResponse = getDummyResponse()
        await streamDummyResponse(chatIdForStream, botMessageId, finalResponse)
      }

      // Save completed assistant message to DynamoDB (non-blocking)
      if (!isIncognito) {
        saveMessageRemote({
          chatId: chatIdForStream,
          messageId: botMessageId,
          role: 'assistant',
          content: finalResponse,
          timestamp: botMessage.timestamp.toISOString(),
        }).catch((err) => console.error('Failed to save assistant message:', err))
      }

      // Fetch quality ratings from enabled judges in parallel (async, non-blocking)
      // Skip judging if the request was cancelled or response is empty (e.g., timeout before first token)
      if (enabledJudges.length > 0 && !wasCancelled && finalResponse.trim()) {
        const respondingProviderId = currentChat?.providerId || newChatProviderId
        // Track which message is being judged and which judges are pending
        setJudgingMessageId(botMessageId)
        setPendingJudges([...enabledJudges])
        const { cancel: cancelJudges } = fetchRatingsFromJudges(
          enabledJudges,
          messagesForApi,
          finalResponse,
          respondingProviderId,
          (judgeId, rating) => {
            updateMessageRating(chatIdForStream, botMessageId, botMessage.timestamp, judgeId, rating)
            // Remove this judge from pending list
            setPendingJudges((prev) => prev.filter((id) => id !== judgeId))
          },
          (judgeId, judgeName, errorMsg) => {
            // Remove from pending and record failure
            setPendingJudges((prev) => prev.filter((id) => id !== judgeId))
            setFailedJudges((prev) => {
              const next = new Map(prev)
              const existing = next.get(botMessageId) || []
              next.set(botMessageId, [...existing, { judgeId, judgeName, error: errorMsg }])
              return next
            })
          }
        )
        judgeCancelRef.current = cancelJudges
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : ''
      const isRateLimit = rawMessage.includes("reached today's limit") || rawMessage.includes("reached today's usage limit")
      let errorMessage: string
      if (isRateLimit) {
        errorMessage = rawMessage
        setErrorSeverity('warning')
      } else {
        const providerName = activeProvider?.name || 'The AI provider'
        errorMessage = rawMessage
          ? `${providerName} is temporarily unavailable: ${rawMessage}. Try a different provider.`
          : `${providerName} is temporarily unavailable. Try a different provider.`
        setErrorSeverity('error')
      }
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
      streamCancelRef.current = null
      // Clear the stall timer
      if (stallTimerRef.current) {
        clearTimeout(stallTimerRef.current)
        stallTimerRef.current = null
      }
      setResponseStalled(false)
      // Note: don't clear judgeCancelRef here - judges may still be running in background
      // They will be cleared on next send or if user cancels
      setIsTyping(false)
    }
  }

  const handleStop = useCallback(() => {
    if (streamCancelRef.current) {
      streamCancelRef.current()
      streamCancelRef.current = null
    }
    // Also cancel any in-progress judge requests
    if (judgeCancelRef.current) {
      judgeCancelRef.current()
      judgeCancelRef.current = null
      setJudgingMessageId(null)
      setPendingJudges([])
    }
    // Clear stall timer
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current)
      stallTimerRef.current = null
    }
    setResponseStalled(false)
    setIsTyping(false)
  }, [])

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
          onRenameChat={handleRenameChat}
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
          {(activeChat?.incognito || (!activeChatId && incognitoMode)) && (
            <Chip
              icon={<VisibilityOffIcon />}
              label="Incognito"
              size="small"
              color="default"
              variant="outlined"
            />
          )}
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
            <ProviderSelector
              selectedProviderId={activeProviderId}
              onSelectProvider={handleChangeProvider}
              disabled={isTyping}
            />
            <JudgeSelector enabledJudges={enabledJudges} onToggleJudge={handleToggleJudge} />
            <Tooltip title={resolvedMode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
              <IconButton onClick={toggleMode} size="small">
                {resolvedMode === 'light' ? <DarkModeIcon /> : <LightModeIcon />}
              </IconButton>
            </Tooltip>
            <UserButton afterSignOutUrl="/" />
            {!providerConfigured && (
              <Tooltip title="The backend API is not configured. Set the VITE_APPSYNC_URL environment variable to connect to your AppSync backend.">
                <Typography
                  variant="caption"
                  sx={{
                    bgcolor: 'warning.light',
                    color: 'warning.contrastText',
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                    cursor: 'help',
                  }}
                >
                  Not Connected
                </Typography>
              </Tooltip>
            )}
          </Box>
        </Paper>

        <Box
          ref={messagesContainerRef}
          onScroll={handleScroll}
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
                  : 'Backend not configured. Set the VITE_APPSYNC_URL environment variable to enable AI responses.'}
              </Typography>
              {!activeChatId && (
                <Button
                  variant={incognitoMode ? 'contained' : 'outlined'}
                  size="small"
                  startIcon={<VisibilityOffIcon />}
                  onClick={() => setIncognitoMode((prev) => !prev)}
                  sx={{ mt: 2 }}
                  color={incognitoMode ? 'primary' : 'inherit'}
                >
                  {incognitoMode ? 'Incognito On' : 'Incognito Off'}
                </Button>
              )}
            </Box>
          ) : (
            <>
              {messages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  loadingJudges={message.id === judgingMessageId ? pendingJudges : []}
                  failedJudges={failedJudges.get(message.id) || []}
                  onDismissJudgeError={(judgeId) => handleDismissJudgeError(message.id, judgeId)}
                  isLastUserMessage={message.id === lastUserMessageId && !isTyping}
                  onEdit={handleEditMessage}
                  onDelete={handleDeleteMessage}
                  conversationHistory={messages.slice(0, index + 1)}
                  respondingProvider={activeProviderId}
                  onFollowUpComplete={(judgeId, followUp) =>
                    handleFollowUpComplete(
                      activeChat!.id,
                      message.id,
                      message.timestamp,
                      judgeId,
                      followUp
                    )
                  }
                />
              ))}
              {isTyping && (
                <Box sx={{ ml: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                    <SmartToyIcon fontSize="small" />
                    <Typography variant="body2">Typing...</Typography>
                  </Box>
                  {responseStalled && (
                    <Alert
                      severity="info"
                      sx={{ mt: 1, maxWidth: 480 }}
                      action={
                        <Button color="inherit" size="small" onClick={handleStop}>
                          Try again
                        </Button>
                      }
                    >
                      This is taking longer than expected. You can wait or try again.
                    </Alert>
                  )}
                </Box>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </Box>

        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          disabled={isTyping}
          isTyping={isTyping}
          editValue={editValue}
          onEditClear={handleEditClear}
        />
      </Box>

        <Snackbar open={!!error} autoHideDuration={8000} onClose={handleCloseError}>
          <Alert onClose={handleCloseError} severity={errorSeverity} sx={{ width: '100%' }}>
            {error}
          </Alert>
        </Snackbar>
      </Box>
    </AuthLayout>
  )
}

export default App
