import { Box, Paper, Typography } from '@mui/material'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import PersonIcon from '@mui/icons-material/Person'
import ReactMarkdown from 'react-markdown'
import type { Message } from '../types'
import { ResponseQualityRating } from './ResponseQualityRating'

interface ChatMessageProps {
  message: Message
  enabledJudges: string[]
}

export function ChatMessage({ message, enabledJudges }: ChatMessageProps) {
  const isUser = message.role === 'user'

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        mb: 2,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: isUser ? 'row-reverse' : 'row',
          alignItems: 'flex-start',
          maxWidth: '80%',
        }}
      >
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: isUser ? 'primary.main' : 'secondary.main',
            color: 'white',
            flexShrink: 0,
            mx: 1,
          }}
        >
          {isUser ? <PersonIcon fontSize="small" /> : <SmartToyIcon fontSize="small" />}
        </Box>
        <Paper
          elevation={1}
          sx={{
            p: 2,
            bgcolor: isUser ? 'primary.main' : 'grey.100',
            color: isUser ? 'white' : 'text.primary',
            borderRadius: 2,
            borderTopRightRadius: isUser ? 0 : 2,
            borderTopLeftRadius: isUser ? 2 : 0,
          }}
        >
          {isUser ? (
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
              {message.content}
            </Typography>
          ) : (
            <Box
              sx={{
                '& p': { m: 0, mb: 1, '&:last-child': { mb: 0 } },
                '& h1, & h2, & h3, & h4, & h5, & h6': { mt: 1.5, mb: 1, '&:first-of-type': { mt: 0 } },
                '& ul, & ol': { m: 0, pl: 2.5, mb: 1 },
                '& li': { mb: 0.5 },
                '& code': {
                  bgcolor: 'rgba(0, 0, 0, 0.08)',
                  px: 0.5,
                  py: 0.25,
                  borderRadius: 0.5,
                  fontFamily: 'monospace',
                  fontSize: '0.875em',
                },
                '& pre': {
                  bgcolor: 'rgba(0, 0, 0, 0.08)',
                  p: 1.5,
                  borderRadius: 1,
                  overflow: 'auto',
                  mb: 1,
                  '& code': { bgcolor: 'transparent', p: 0 },
                },
                '& blockquote': {
                  borderLeft: '3px solid',
                  borderColor: 'grey.400',
                  pl: 1.5,
                  ml: 0,
                  my: 1,
                  color: 'text.secondary',
                },
                '& a': { color: 'primary.main' },
                '& table': { borderCollapse: 'collapse', width: '100%', mb: 1 },
                '& th, & td': { border: '1px solid', borderColor: 'grey.300', p: 1 },
                '& th': { bgcolor: 'rgba(0, 0, 0, 0.04)' },
              }}
            >
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </Box>
          )}
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mt: 0.5,
              opacity: 0.7,
            }}
          >
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Typography>

          {!isUser && message.judgeRatings && (
            <ResponseQualityRating ratings={message.judgeRatings} enabledJudges={enabledJudges} />
          )}
        </Paper>
      </Box>
    </Box>
  )
}
