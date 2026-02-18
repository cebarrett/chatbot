import { useState } from 'react'
import { Box, Paper, Typography, IconButton, Tooltip, Collapse, useTheme } from '@mui/material'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import PersonIcon from '@mui/icons-material/Person'
import EditIcon from '@mui/icons-material/Edit'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import PsychologyAltIcon from '@mui/icons-material/PsychologyAlt'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Message, JudgeFollowUp, JudgeError, ContentBlock } from '../types'
import { ResponseQualityRating } from './ResponseQualityRating'
import { ImageGallery } from './ImageGallery'

function parseThinkingBlocks(content: string): { thinking: string | null; visibleContent: string } {
  // Match completed think blocks
  const thinkRegex = /<think>([\s\S]*?)<\/think>/
  const match = content.match(thinkRegex)
  if (match) {
    const thinking = match[1].trim()
    const visibleContent = content.replace(thinkRegex, '').trim()
    return { thinking: thinking || null, visibleContent }
  }

  // Handle incomplete think block during streaming (<think> without </think>)
  const openThinkIndex = content.indexOf('<think>')
  if (openThinkIndex !== -1) {
    const thinking = content.substring(openThinkIndex + 7).trim()
    const visibleContent = content.substring(0, openThinkIndex).trim()
    return { thinking: thinking || null, visibleContent }
  }

  return { thinking: null, visibleContent: content }
}

interface ChatMessageProps {
  message: Message
  loadingJudges?: string[]  // Judges actively loading for this message
  failedJudges?: JudgeError[]  // Judges that failed for this message
  onDismissJudgeError?: (judgeId: string) => void
  isLastUserMessage?: boolean
  onEdit?: (content: string) => void
  onDelete?: (messageId: string) => void
  conversationHistory?: Message[]  // For follow-up context
  respondingProvider?: string  // Provider that generated the response
  onFollowUpComplete?: (judgeId: string, followUp: JudgeFollowUp) => void
}

export function ChatMessage({
  message,
  loadingJudges = [],
  failedJudges = [],
  onDismissJudgeError,
  isLastUserMessage,
  onEdit,
  onDelete,
  conversationHistory,
  respondingProvider,
  onFollowUpComplete,
}: ChatMessageProps) {
  const isUser = message.role === 'user'
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const showEditButton = isUser && isLastUserMessage && onEdit

  const hasContentBlocks = !isUser && message.contentBlocks && message.contentBlocks.length > 0
  const imageBlocks = hasContentBlocks
    ? message.contentBlocks!.filter((b: ContentBlock) => b.type === 'image')
    : []
  const textContent = hasContentBlocks
    ? message.contentBlocks!
        .filter((b: ContentBlock) => b.type === 'text')
        .map((b: ContentBlock) => b.text || '')
        .join('')
    : message.content

  const { thinking, visibleContent } = !isUser
    ? parseThinkingBlocks(textContent)
    : { thinking: null, visibleContent: message.content }
  const [showThinking, setShowThinking] = useState(false)

  // Assistant messages: full-width, no bubble
  if (!isUser) {
    return (
      <Box sx={{ mb: 3, width: '100%' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: { xs: 1, sm: 1.5 },
            mb: 1,
          }}
        >
          <Box
            sx={{
              width: { xs: 28, sm: 36 },
              height: { xs: 28, sm: 36 },
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'secondary.main',
              color: 'white',
              flexShrink: 0,
            }}
          >
            <SmartToyIcon fontSize="small" />
          </Box>
          <Typography
            variant="caption"
            sx={{
              opacity: 0.7,
              alignSelf: 'center',
            }}
          >
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Typography>
        </Box>
        <Box
          sx={{
            pl: { xs: 0, sm: 6 },
            '& p': { m: 0, mb: 1.5, '&:last-child': { mb: 0 } },
            '& h1, & h2, & h3, & h4, & h5, & h6': { mt: 2, mb: 1, '&:first-of-type': { mt: 0 } },
            '& ul, & ol': { m: 0, pl: 2.5, mb: 1.5 },
            '& li': { mb: 0.5 },
            '& code': {
              bgcolor: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'rgba(255, 255, 255, 0.08)'
                  : 'rgba(0, 0, 0, 0.08)',
              px: 0.5,
              py: 0.25,
              borderRadius: 0.5,
              fontFamily: 'monospace',
              fontSize: '0.875em',
            },
            '& pre': {
              bgcolor: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'rgba(255, 255, 255, 0.08)'
                  : 'rgba(0, 0, 0, 0.08)',
              p: 1.5,
              borderRadius: 1,
              overflow: 'auto',
              mb: 1.5,
              '& code': { bgcolor: 'transparent', p: 0 },
            },
            '& blockquote': {
              borderLeft: '3px solid',
              borderColor: 'grey.400',
              pl: 1.5,
              ml: 0,
              my: 1.5,
              color: 'text.secondary',
            },
            '& a': { color: 'primary.main' },
            '& table': { borderCollapse: 'collapse', width: '100%', mb: 1.5 },
            '& th, & td': { border: '1px solid', borderColor: 'grey.300', p: 1 },
            '& th': {
              bgcolor: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'rgba(255, 255, 255, 0.04)'
                  : 'rgba(0, 0, 0, 0.04)',
            },
          }}
        >
          {thinking && (
            <Box sx={{ mb: 1.5 }}>
              <Box
                onClick={() => setShowThinking((prev) => !prev)}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  cursor: 'pointer',
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 1,
                  bgcolor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
                  '&:hover': {
                    bgcolor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
                  },
                  transition: 'background-color 0.2s',
                  userSelect: 'none',
                }}
              >
                <PsychologyAltIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                  {showThinking ? 'Hide thinking' : 'Show thinking'}
                </Typography>
              </Box>
              <Collapse in={showThinking}>
                <Box
                  sx={{
                    mt: 1,
                    pl: 1.5,
                    borderLeft: '2px solid',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)',
                    color: 'text.secondary',
                    fontSize: '0.9em',
                    '& p': { m: 0, mb: 1, '&:last-child': { mb: 0 } },
                  }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{thinking}</ReactMarkdown>
                </Box>
              </Collapse>
            </Box>
          )}
          {visibleContent && (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                code({ className, children, ...rest }) {
                  const match = /language-(\w+)/.exec(className || '')
                  const codeString = String(children).replace(/\n$/, '')
                  if (match) {
                    return (
                      <SyntaxHighlighter
                        style={isDark ? oneDark : oneLight}
                        language={match[1]}
                        PreTag="div"
                        customStyle={{
                          margin: 0,
                          borderRadius: '4px',
                          fontSize: '0.875em',
                        }}
                      >
                        {codeString}
                      </SyntaxHighlighter>
                    )
                  }
                  return (
                    <code className={className} {...rest}>
                      {children}
                    </code>
                  )
                },
              }}
            >
              {visibleContent}
            </ReactMarkdown>
          )}
          {imageBlocks.length > 0 && (
            <ImageGallery images={imageBlocks} />
          )}
        </Box>
        {(message.judgeRatings || loadingJudges.length > 0 || failedJudges.length > 0) && (
          <Box sx={{ pl: { xs: 0, sm: 6 }, mt: 1 }}>
            <ResponseQualityRating
              ratings={message.judgeRatings || {}}
              loadingJudges={loadingJudges}
              failedJudges={failedJudges}
              onDismissJudgeError={onDismissJudgeError}
              conversationHistory={conversationHistory}
              responseContent={message.content}
              respondingProvider={respondingProvider}
              onFollowUpComplete={onFollowUpComplete}
            />
          </Box>
        )}
      </Box>
    )
  }

  // User messages: right-aligned bubble
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'flex-end',
        mb: 2,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row-reverse',
          alignItems: 'flex-start',
          maxWidth: { xs: '95%', sm: '85%', md: '80%' },
        }}
      >
        <Box
          sx={{
            width: { xs: 28, sm: 36 },
            height: { xs: 28, sm: 36 },
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'primary.main',
            color: 'white',
            flexShrink: 0,
            mx: { xs: 0.5, sm: 1 },
          }}
        >
          <PersonIcon fontSize="small" />
        </Box>
        <Paper
          elevation={1}
          sx={{
            p: { xs: 1.5, sm: 2 },
            bgcolor: 'primary.main',
            color: 'white',
            borderRadius: 2,
            borderTopRightRadius: 0,
          }}
        >
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
            {message.content}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mt: 0.5,
            }}
          >
            <Typography
              variant="caption"
              sx={{
                opacity: 0.7,
              }}
            >
              {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', ml: 1 }}>
              {showEditButton && (
                <Tooltip title="Edit message">
                  <IconButton
                    size="small"
                    onClick={() => onEdit(message.content)}
                    sx={{
                      color: 'white',
                      opacity: 0.7,
                      p: 0.25,
                      '&:hover': {
                        opacity: 1,
                        bgcolor: 'rgba(255, 255, 255, 0.1)',
                      },
                    }}
                  >
                    <EditIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
              {isUser && onDelete && (
                <Tooltip title="Delete message and response">
                  <IconButton
                    size="small"
                    onClick={() => onDelete(message.id)}
                    sx={{
                      color: 'white',
                      opacity: 0.7,
                      p: 0.25,
                      '&:hover': {
                        opacity: 1,
                        bgcolor: 'rgba(255, 255, 255, 0.1)',
                      },
                    }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>
        </Paper>
      </Box>
    </Box>
  )
}
