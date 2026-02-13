import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { QualityRating, Message } from '../types'

// ── Mocks ───────────────────────────────────────────────────────────────────

// Mock Clerk auth
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    getToken: vi.fn().mockResolvedValue('mock-token'),
  }),
  SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedOut: () => null, // User is signed in, so SignedOut renders nothing
  SignIn: () => <div data-testid="clerk-sign-in" />,
  UserButton: () => <div data-testid="clerk-user-button" />,
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock AppSync client
vi.mock('../services/appsyncClient', () => ({
  setTokenProvider: vi.fn(),
  getAuthToken: vi.fn().mockResolvedValue('mock-token'),
  executeGraphQL: vi.fn().mockResolvedValue({}),
}))

// Track mock functions at module level for assertions
const mockListChats = vi.fn().mockResolvedValue({ chats: [], nextToken: null })
const mockGetChat = vi.fn().mockResolvedValue(null)
const mockCreateChat = vi.fn().mockResolvedValue({ chatId: 'mock-chat-id' })
const mockUpdateChat = vi.fn().mockResolvedValue({})
const mockDeleteChat = vi.fn().mockResolvedValue({})
const mockSaveMessage = vi.fn().mockResolvedValue({})
const mockUpdateMessage = vi.fn().mockResolvedValue({})
const mockDeleteMessage = vi.fn().mockResolvedValue({})

vi.mock('../services/chatHistoryService', () => ({
  listChats: (...args: unknown[]) => mockListChats(...args),
  getChat: (...args: unknown[]) => mockGetChat(...args),
  createChat: (...args: unknown[]) => mockCreateChat(...args),
  updateChat: (...args: unknown[]) => mockUpdateChat(...args),
  deleteChat: (...args: unknown[]) => mockDeleteChat(...args),
  saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
  updateMessage: (...args: unknown[]) => mockUpdateMessage(...args),
  deleteMessage: (...args: unknown[]) => mockDeleteMessage(...args),
  generateChatTitle: (messages: Message[]) => {
    const first = messages.find((m) => m.role === 'user')
    return first ? first.content.slice(0, 30) : 'New Chat'
  },
}))

// Module-level mock controls for provider configurability
const mockProviderIsConfigured = vi.fn().mockReturnValue(false)
const mockSendMessageStream = vi.fn()

// Mock chat provider registry – delegates to module-level mocks for per-test control
vi.mock('../services/chatProviderRegistry', () => {
  const providers = [
    { id: 'gemini', name: 'Gemini', description: 'Google Gemini', color: '#4285F4', isConfigured: () => mockProviderIsConfigured(), sendMessageStream: (...args: unknown[]) => mockSendMessageStream(...args) },
    { id: 'claude', name: 'Claude', description: 'Anthropic Claude', color: '#D97706', isConfigured: () => mockProviderIsConfigured(), sendMessageStream: (...args: unknown[]) => mockSendMessageStream(...args) },
    { id: 'openai', name: 'ChatGPT', description: 'OpenAI GPT', color: '#10A37F', isConfigured: () => mockProviderIsConfigured(), sendMessageStream: (...args: unknown[]) => mockSendMessageStream(...args) },
  ]
  return {
    chatProviderRegistry: providers,
    DEFAULT_PROVIDER_ID: 'gemini',
    getProviderById: (id: string) => providers.find((p) => p.id === id),
    getDefaultProvider: () => providers[0],
    getAllProviderIds: () => providers.map((p) => p.id),
    isAnyProviderConfigured: () => mockProviderIsConfigured(),
  }
})

// Mock judge registry – track fetchRatingsFromJudges for assertions
const mockFetchRatingsFromJudges = vi.fn()

vi.mock('../services/judgeRegistry', () => {
  const judges = [
    { id: 'claude', name: 'Claude', description: 'Claude Judge', color: '#D97706', isConfigured: () => true, getRating: vi.fn() },
    { id: 'openai', name: 'ChatGPT', description: 'ChatGPT Judge', color: '#10A37F', isConfigured: () => true, getRating: vi.fn() },
    { id: 'grok', name: 'Grok', description: 'Grok Judge', color: '#EF4444', isConfigured: () => true, getRating: vi.fn() },
  ]
  return {
    judgeRegistry: judges,
    getJudgeById: (id: string) => judges.find((j) => j.id === id),
    getAllJudgeIds: () => judges.map((j) => j.id),
    loadEnabledJudges: () => ['claude', 'openai', 'grok'],
    saveEnabledJudges: vi.fn(),
    fetchRatingsFromJudges: (...args: unknown[]) => mockFetchRatingsFromJudges(...args),
  }
})

// Mock appsyncChat
vi.mock('../services/appsyncChat', () => ({
  sendMessageStream: vi.fn(),
  isConfigured: () => false,
}))

// Mock appsyncJudge
vi.mock('../services/appsyncJudge', () => ({
  getQualityRating: vi.fn(),
  askFollowUpQuestion: vi.fn(),
  isConfigured: () => false,
}))

// Mock dummy responses to return deterministic content
vi.mock('../utils/dummyResponses', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/dummyResponses')>()
  return {
    ...original,
    getDummyResponse: () => 'This is a mock assistant response.',
  }
})

// ── Helpers ─────────────────────────────────────────────────────────────────

import App from '../App'
import { ThemeProvider } from '../contexts/ThemeContext'

function renderApp() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  )
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('App integration tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderIsConfigured.mockReturnValue(false)
    mockListChats.mockResolvedValue({ chats: [], nextToken: null })
    mockFetchRatingsFromJudges.mockImplementation(() => ({
      promise: Promise.resolve(),
      cancel: vi.fn(),
    }))
    localStorage.clear()
  })

  afterEach(() => {
    // Ensure real timers are restored if a test used fake timers
    vi.useRealTimers()
  })

  it('renders the welcome screen for an authenticated user', async () => {
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('Type your message...')).toBeInTheDocument()
    expect(screen.getByText('Chatbot')).toBeInTheDocument()
  })

  it('shows Not Connected indicator when provider is not configured', async () => {
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Not Connected')).toBeInTheDocument()
    })
  })

  it('sends a message and displays user + assistant messages', async () => {
    const user = userEvent.setup()
    renderApp()

    // Wait for the initial load
    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })

    // Type a message
    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Hello chatbot!')

    // Click send (find the button near the input)
    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await user.click(sendButton)

    // User message should appear (it also shows in sidebar as chat title, so use getAllByText)
    await waitFor(() => {
      const matches = screen.getAllByText('Hello chatbot!')
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })

    // Assistant (dummy) response should appear after streaming simulation
    await waitFor(
      () => {
        expect(screen.getByText('This is a mock assistant response.')).toBeInTheDocument()
      },
      { timeout: 5000 },
    )
  })

  it('creates a new chat on first message and persists it', async () => {
    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'First message')
    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await user.click(sendButton)

    await waitFor(() => {
      expect(mockCreateChat).toHaveBeenCalledTimes(1)
    })

    // The user message should be saved to DynamoDB
    await waitFor(() => {
      expect(mockSaveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          content: 'First message',
        }),
      )
    })
  })

  it('triggers judge evaluations after assistant response', async () => {
    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Judge this!')
    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await user.click(sendButton)

    // Wait for the dummy response to finish streaming, then judges should be called
    await waitFor(
      () => {
        expect(mockFetchRatingsFromJudges).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )

    // Verify correct judges were invoked
    const callArgs = mockFetchRatingsFromJudges.mock.calls[0]
    expect(callArgs[0]).toEqual(['claude', 'openai', 'grok']) // enabledJudges
  })

  it('displays judge rating chips on an assistant message', async () => {
    // Set up fetchRatingsFromJudges to immediately call back with a rating
    const mockRating: QualityRating = {
      score: 8.5,
      explanation: 'Great response',
      problems: [],
    }

    mockFetchRatingsFromJudges.mockImplementation(
      (
        _judges: string[],
        _history: Message[],
        _response: string,
        _provider: string,
        onRating: (judgeId: string, rating: QualityRating) => void,
      ) => {
        // Immediately deliver a rating from "claude" judge
        setTimeout(() => onRating('claude', mockRating), 0)
        return { promise: Promise.resolve(), cancel: vi.fn() }
      },
    )

    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Rate this')
    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await user.click(sendButton)

    // Judge rating chip should appear with score
    await waitFor(
      () => {
        expect(screen.getByText(/Claude: 8\.5/)).toBeInTheDocument()
        expect(screen.getByText('(Good)')).toBeInTheDocument()
      },
      { timeout: 5000 },
    )
  })

  it('loads existing chats in the sidebar', async () => {
    mockListChats.mockResolvedValue({
      chats: [
        {
          id: 'chat-1',
          title: 'Previous conversation',
          messages: [],
          createdAt: new Date('2025-01-15'),
          updatedAt: new Date('2025-01-15'),
          providerId: 'gemini',
        },
        {
          id: 'chat-2',
          title: 'Another chat',
          messages: [],
          createdAt: new Date('2025-01-14'),
          updatedAt: new Date('2025-01-14'),
          providerId: 'claude',
        },
      ],
      nextToken: null,
    })

    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Previous conversation')).toBeInTheDocument()
      expect(screen.getByText('Another chat')).toBeInTheDocument()
    })
  })

  it('selects a chat from the sidebar and loads its messages', async () => {
    mockListChats.mockResolvedValue({
      chats: [
        {
          id: 'chat-1',
          title: 'My Chat',
          messages: [],
          createdAt: new Date('2025-01-15'),
          updatedAt: new Date('2025-01-15'),
          providerId: 'gemini',
        },
      ],
      nextToken: null,
    })

    mockGetChat.mockResolvedValue({
      id: 'chat-1',
      title: 'My Chat',
      messages: [
        { id: 'msg-1', content: 'Hello', role: 'user', timestamp: new Date() },
        { id: 'msg-2', content: 'Hi there!', role: 'assistant', timestamp: new Date() },
      ],
      createdAt: new Date('2025-01-15'),
      updatedAt: new Date('2025-01-15'),
      providerId: 'gemini',
    })

    const user = userEvent.setup()
    renderApp()

    // Wait for sidebar to show the chat
    await waitFor(() => {
      expect(screen.getByText('My Chat')).toBeInTheDocument()
    })

    // Click on the chat
    await user.click(screen.getByText('My Chat'))

    // Messages should load
    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument()
      expect(screen.getByText('Hi there!')).toBeInTheDocument()
    })
  })

  it('can create a new chat from the sidebar', async () => {
    // Start with no chats, send a message to create one, then click new chat
    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })

    // Send a message to create a chat
    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'First chat message')
    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await user.click(sendButton)

    // Wait for the assistant response to finish
    await waitFor(
      () => {
        expect(screen.getByText('This is a mock assistant response.')).toBeInTheDocument()
      },
      { timeout: 5000 },
    )

    // Click "New Chat" button (has AddIcon)
    const newChatButton = screen.getByTestId('AddIcon').closest('button')!
    await user.click(newChatButton)

    // Should show welcome screen again (no active chat, new chat window)
    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })
  })

  it('deletes a chat from the sidebar', async () => {
    mockListChats.mockResolvedValue({
      chats: [
        {
          id: 'chat-1',
          title: 'Chat to Delete',
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          providerId: 'gemini',
        },
      ],
      nextToken: null,
    })

    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Chat to Delete')).toBeInTheDocument()
    })

    // Find the delete button in the sidebar (DeleteIcon)
    const chatItem = screen.getByText('Chat to Delete').closest('[role="button"]')!
    const deleteButton = within(chatItem).getByTestId('DeleteIcon').closest('button')!
    await user.click(deleteButton)

    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText('Delete chat?')).toBeInTheDocument()
    })

    // Click the confirm "Delete" button in the dialog
    const confirmButton = screen.getByRole('button', { name: 'Delete' })
    await user.click(confirmButton)

    // Chat should be removed from list
    await waitFor(() => {
      expect(screen.queryByText('Chat to Delete')).not.toBeInTheDocument()
    })

    expect(mockDeleteChat).toHaveBeenCalledWith('chat-1')
  })

  it('clears the input after sending a message', async () => {
    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type your message...')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Type your message...') as HTMLInputElement
    await user.type(input, 'Test clearing')
    expect(input.value).toBe('Test clearing')

    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await user.click(sendButton)

    // Input should be cleared
    await waitFor(() => {
      expect(input.value).toBe('')
    })
  })

  it('disables input while the assistant is typing', async () => {
    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type your message...')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Quick message')
    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await user.click(sendButton)

    // Input should be disabled while streaming
    await waitFor(() => {
      expect(input).toBeDisabled()
    })

    // After streaming completes, input should re-enable
    await waitFor(
      () => {
        expect(input).not.toBeDisabled()
      },
      { timeout: 5000 },
    )
  })

  it('shows the stop button while the assistant is typing', async () => {
    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type your message...')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Stop test')
    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await user.click(sendButton)

    // Stop button should appear while typing
    await waitFor(() => {
      expect(screen.getByTestId('StopIcon')).toBeInTheDocument()
    })

    // After streaming completes, send button should return
    await waitFor(
      () => {
        expect(screen.getByTestId('SendIcon')).toBeInTheDocument()
      },
      { timeout: 5000 },
    )
  })

  // ── Error handling & user feedback tests ────────────────────────────────

  it('shows provider-specific error message when API call fails', async () => {
    mockProviderIsConfigured.mockReturnValue(true)
    mockSendMessageStream.mockImplementation(() => ({
      promise: Promise.reject(new Error('rate limit exceeded')),
      cancel: vi.fn(),
    }))

    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Test error handling')
    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await user.click(sendButton)

    // Should show provider-specific error with provider name
    await waitFor(() => {
      expect(screen.getByText(/Gemini is temporarily unavailable/)).toBeInTheDocument()
      expect(screen.getByText(/Try a different provider/)).toBeInTheDocument()
    })

    // The empty bot message should be removed — only the user message remains
    await waitFor(() => {
      const matches = screen.getAllByText('Test error handling')
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('displays dismissible judge failure notice on affected message', async () => {
    mockFetchRatingsFromJudges.mockImplementation(
      (
        _judges: string[],
        _history: Message[],
        _response: string,
        _provider: string,
        _onRating: (judgeId: string, rating: QualityRating) => void,
        onError?: (judgeId: string, judgeName: string, error: string) => void,
      ) => {
        // Simulate a judge failure for Claude
        setTimeout(() => onError?.('claude', 'Claude', 'Service unavailable'), 0)
        return { promise: Promise.resolve(), cancel: vi.fn() }
      },
    )

    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Judge failure test')
    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await user.click(sendButton)

    // Wait for the judge error chip to appear on the assistant message
    await waitFor(
      () => {
        expect(screen.getByText('Claude evaluation failed')).toBeInTheDocument()
      },
      { timeout: 5000 },
    )

    // Dismiss the error by clicking the chip's delete button
    const errorChip = screen.getByText('Claude evaluation failed').closest('.MuiChip-root')!
    const deleteArea = errorChip.querySelector('.MuiChip-deleteIcon') as HTMLElement
    await user.click(deleteArea)

    // Error chip should be dismissed
    await waitFor(() => {
      expect(screen.queryByText('Claude evaluation failed')).not.toBeInTheDocument()
    })
  })

  it('passes onError callback to fetchRatingsFromJudges', async () => {
    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Check onError callback')
    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await user.click(sendButton)

    // Wait for fetchRatingsFromJudges to be called
    await waitFor(
      () => {
        expect(mockFetchRatingsFromJudges).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )

    // Verify onError callback (6th argument) is a function
    const callArgs = mockFetchRatingsFromJudges.mock.calls[0]
    expect(callArgs[5]).toBeTypeOf('function') // onError callback
  })

  it('shows stall message after 30 seconds of no response', async () => {
    vi.useFakeTimers()

    mockProviderIsConfigured.mockReturnValue(true)
    // sendMessageStream returns a promise that never resolves (simulating a stall)
    mockSendMessageStream.mockImplementation(() => ({
      promise: new Promise(() => {}),
      cancel: vi.fn(),
    }))

    // Use fireEvent (synchronous) instead of userEvent to avoid timer conflicts
    await act(async () => {
      renderApp()
      await vi.advanceTimersByTimeAsync(1000)
    })

    const input = screen.getByPlaceholderText('Type your message...')

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Stall test' } })
      await vi.advanceTimersByTimeAsync(100)
    })

    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await act(async () => {
      fireEvent.click(sendButton)
      await vi.advanceTimersByTimeAsync(500)
    })

    // Should show "Typing..." but NOT the stall message yet
    expect(screen.getByText('Typing...')).toBeInTheDocument()
    expect(screen.queryByText(/taking longer than expected/i)).not.toBeInTheDocument()

    // Advance past 30 seconds
    await act(async () => { await vi.advanceTimersByTimeAsync(31000) })

    // Now the stall message should appear
    expect(screen.getByText(/taking longer than expected/i)).toBeInTheDocument()
    expect(screen.getByText(/You can wait or try again/i)).toBeInTheDocument()
  }, 15000)

  it('shows connection interrupted warning for partial WebSocket response', async () => {
    mockProviderIsConfigured.mockReturnValue(true)
    mockSendMessageStream.mockImplementation(
      (_msgs: unknown, _sys: unknown, onChunk: (content: string) => void) => {
        return {
          promise: new Promise<{ content: string; cancelled: boolean; partial: boolean }>((resolve) => {
            // Simulate receiving some content then WebSocket disconnecting
            setTimeout(() => {
              onChunk('Partial response before disconnect')
              resolve({ content: 'Partial response before disconnect', cancelled: false, partial: true })
            }, 10)
          }),
          cancel: vi.fn(),
        }
      },
    )

    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'WebSocket disconnect test')
    const sendButton = screen.getByTestId('SendIcon').closest('button')!
    await user.click(sendButton)

    // Should show the partial response content
    await waitFor(
      () => {
        expect(screen.getByText('Partial response before disconnect')).toBeInTheDocument()
      },
      { timeout: 5000 },
    )

    // Should show the connection interrupted warning
    await waitFor(() => {
      expect(screen.getByText(/Connection was interrupted/)).toBeInTheDocument()
    })
  })

  it('shows "not configured" in provider selector dropdown', async () => {
    const user = userEvent.setup()
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })

    // Click the provider selector button to open dropdown
    const providerButton = screen.getByText('Gemini').closest('button')!
    await user.click(providerButton)

    // Provider descriptions should show "(not configured)" suffix
    await waitFor(() => {
      const notConfiguredTexts = screen.getAllByText(/not configured/)
      expect(notConfiguredTexts.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows configuration instructions in welcome message when not connected', async () => {
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Welcome to Chatbot')).toBeInTheDocument()
    })

    // Should show backend configuration instructions instead of "demo mode"
    expect(screen.getByText(/Backend not configured/)).toBeInTheDocument()
    expect(screen.getByText(/VITE_APPSYNC_URL/)).toBeInTheDocument()
  })
})
