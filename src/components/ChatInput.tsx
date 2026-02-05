import { useState, useEffect } from 'react'
import type { KeyboardEvent } from 'react'
import { Box, TextField, IconButton } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import StopIcon from '@mui/icons-material/Stop'

interface ChatInputProps {
  onSend: (message: string) => void
  onStop?: () => void
  disabled?: boolean
  isTyping?: boolean
  editValue?: string | null
  onEditClear?: () => void
}

export function ChatInput({ onSend, onStop, disabled = false, isTyping = false, editValue, onEditClear }: ChatInputProps) {
  const [input, setInput] = useState('')

  // When editValue is set, populate the input field
  // This is intentionally syncing prop to state for the edit feature
  useEffect(() => {
    if (editValue !== null && editValue !== undefined) {
      setInput(editValue) // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [editValue])

  const handleSend = () => {
    const trimmed = input.trim()
    if (trimmed) {
      onSend(trimmed)
      setInput('')
      onEditClear?.()
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // On mobile/touch devices, let Enter insert a line break (user taps send button).
      // On desktop, Enter sends the message.
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      if (isTouchDevice) return
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        p: 2,
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <TextField
        fullWidth
        placeholder="Type your message..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        multiline
        maxRows={4}
        size="small"
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: 3,
          },
        }}
      />
      {isTyping ? (
        <IconButton
          color="error"
          onClick={onStop}
          sx={{
            bgcolor: 'error.main',
            color: 'white',
            '&:hover': {
              bgcolor: 'error.dark',
            },
          }}
        >
          <StopIcon />
        </IconButton>
      ) : (
        <IconButton
          color="primary"
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          sx={{
            bgcolor: 'primary.main',
            color: 'white',
            '&:hover': {
              bgcolor: 'primary.dark',
            },
            '&.Mui-disabled': {
              bgcolor: (theme) =>
                theme.palette.mode === 'dark' ? 'grey.700' : 'grey.300',
              color: (theme) =>
                theme.palette.mode === 'dark' ? 'grey.500' : 'grey.500',
            },
          }}
        >
          <SendIcon />
        </IconButton>
      )}
    </Box>
  )
}
