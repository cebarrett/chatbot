import { useState, useEffect } from 'react'
import type { KeyboardEvent } from 'react'
import { Box, TextField, IconButton, CircularProgress, Typography } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import StopIcon from '@mui/icons-material/Stop'
import MicIcon from '@mui/icons-material/Mic'
import { useVoiceRecorder } from '../hooks/useVoiceRecorder'

interface ChatInputProps {
  onSend: (message: string) => void
  onStop?: () => void
  disabled?: boolean
  isTyping?: boolean
  editValue?: string | null
  onEditClear?: () => void
  onVoiceError?: (error: string) => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function ChatInput({ onSend, onStop, disabled = false, isTyping = false, editValue, onEditClear, onVoiceError }: ChatInputProps) {
  const [input, setInput] = useState('')
  const {
    state: recordingState,
    duration,
    startRecording,
    stopRecording,
    transcript,
    error: voiceError,
    isSupported: voiceSupported,
    clearTranscript,
    clearError,
  } = useVoiceRecorder()

  // When editValue is set, populate the input field
  // This is intentionally syncing prop to state for the edit feature
  useEffect(() => {
    if (editValue !== null && editValue !== undefined) {
      setInput(editValue) // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [editValue])

  // When transcript arrives, append it to the input
  useEffect(() => {
    if (transcript) {
      setInput((prev) => { // eslint-disable-line react-hooks/set-state-in-effect
        const separator = prev.trim() ? ' ' : ''
        return prev + separator + transcript
      })
      clearTranscript()
    }
  }, [transcript, clearTranscript])

  // Surface voice errors to parent
  useEffect(() => {
    if (voiceError) {
      onVoiceError?.(voiceError)
      clearError()
    }
  }, [voiceError, onVoiceError, clearError])

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

  const handleMicClick = () => {
    if (recordingState === 'idle') {
      startRecording()
    } else if (recordingState === 'recording') {
      stopRecording()
    }
  }

  const isRecording = recordingState === 'recording'
  const isTranscribing = recordingState === 'transcribing'
  const inputDisabled = disabled || isTranscribing

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        p: 2,
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        alignItems: 'flex-end',
      }}
    >
      {voiceSupported && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {isTranscribing ? (
            <IconButton disabled sx={{ width: 40, height: 40 }}>
              <CircularProgress size={20} />
            </IconButton>
          ) : (
            <IconButton
              onClick={handleMicClick}
              disabled={disabled || isTyping}
              sx={{
                bgcolor: isRecording ? 'error.main' : 'transparent',
                color: isRecording ? 'white' : 'text.secondary',
                '&:hover': {
                  bgcolor: isRecording ? 'error.dark' : 'action.hover',
                },
                animation: isRecording ? 'pulse 1.5s ease-in-out infinite' : 'none',
                '@keyframes pulse': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.7 },
                },
              }}
            >
              <MicIcon />
            </IconButton>
          )}
          {isRecording && (
            <Typography
              variant="caption"
              sx={{ color: 'error.main', fontVariantNumeric: 'tabular-nums', minWidth: 32 }}
            >
              {formatDuration(duration)}
            </Typography>
          )}
        </Box>
      )}

      <TextField
        fullWidth
        placeholder={isRecording ? 'Recording...' : isTranscribing ? 'Transcribing...' : 'Type your message...'}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={inputDisabled}
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
          disabled={inputDisabled || !input.trim()}
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
