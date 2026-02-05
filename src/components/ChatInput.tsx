import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Box, TextField, IconButton } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import StopIcon from '@mui/icons-material/Stop'

interface ChatInputProps {
  onSend: (message: string) => void
  onStop?: () => void
  disabled?: boolean
  isTyping?: boolean
}

export function ChatInput({ onSend, onStop, disabled = false, isTyping = false }: ChatInputProps) {
  const [input, setInput] = useState('')

  const handleSend = () => {
    const trimmed = input.trim()
    if (trimmed) {
      onSend(trimmed)
      setInput('')
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
