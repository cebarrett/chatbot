import { useState, useRef, useEffect } from 'react'
import {
  Box,
  Typography,
  TextField,
  IconButton,
  CircularProgress,
  Collapse,
  useTheme,
} from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { QualityRating, Message, JudgeFollowUpExchange } from '../types'
import { askFollowUpQuestion } from '../services/appsyncJudge'

function getMarkdownSx(isDark: boolean) {
  return {
    '& p': { m: 0, mb: 1, '&:last-child': { mb: 0 } },
    '& h1, & h2, & h3, & h4, & h5, & h6': { mt: 1.5, mb: 0.75, '&:first-of-type': { mt: 0 } },
    '& ul, & ol': { m: 0, pl: 2.5, mb: 1 },
    '& li': { mb: 0.25 },
    '& code': {
      bgcolor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
      px: 0.5,
      py: 0.25,
      borderRadius: 0.5,
      fontFamily: 'monospace',
      fontSize: '0.875em',
    },
    '& pre': {
      bgcolor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
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
    '& th, & td': { border: '1px solid', borderColor: 'grey.300', p: 0.75 },
  }
}

interface JudgeFollowUpThreadProps {
  judgeId: string
  judgeName: string
  judgeColor: string
  rating: QualityRating
  conversationHistory: Message[]
  responseContent: string
  respondingProvider: string
  onFollowUpComplete: (exchanges: JudgeFollowUpExchange[]) => void
}

export function JudgeFollowUpThread({
  judgeId,
  judgeName,
  judgeColor,
  rating,
  conversationHistory,
  responseContent,
  respondingProvider,
  onFollowUpComplete,
}: JudgeFollowUpThreadProps) {
  // Merge legacy single followUp with new followUps array
  const initialExchanges = (): JudgeFollowUpExchange[] => {
    if (rating.followUps && rating.followUps.length > 0) return rating.followUps
    if (rating.followUp) return [rating.followUp]
    return []
  }

  const [exchanges, setExchanges] = useState<JudgeFollowUpExchange[]>(initialExchanges)
  const [expanded, setExpanded] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const [question, setQuestion] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const mdSx = getMarkdownSx(isDark)

  // Sync from props when rating changes externally (e.g. loading from DynamoDB)
  useEffect(() => {
    const fromProps = initialExchanges()
    if (fromProps.length > exchanges.length) {
      setExchanges(fromProps)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rating.followUps, rating.followUp])

  const markdownComponents = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code({ className, children, ...rest }: any) {
      const match = /language-(\w+)/.exec(className || '')
      const codeString = String(children).replace(/\n$/, '')
      if (match) {
        return (
          <SyntaxHighlighter
            style={isDark ? oneDark : oneLight}
            language={match[1]}
            PreTag="div"
            customStyle={{ margin: 0, borderRadius: '4px', fontSize: '0.875em' }}
          >
            {codeString}
          </SyntaxHighlighter>
        )
      }
      return <code className={className} {...rest}>{children}</code>
    },
  }

  const handleSubmit = async () => {
    if (!question.trim() || isLoading) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await askFollowUpQuestion(
        judgeId,
        conversationHistory,
        responseContent,
        respondingProvider,
        rating,
        question.trim(),
        exchanges.length > 0 ? exchanges : undefined
      )
      const newExchanges = [...exchanges, result]
      setExchanges(newExchanges)
      setQuestion('')
      onFollowUpComplete(newExchanges)
      // Scroll the new answer into view after render
      setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get response')
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading && question.trim()) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleOpenThread = () => {
    if (exchanges.length > 0) {
      setExpanded(true)
    }
    setShowInput(true)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  // Nothing to show yet and thread isn't open — just render the "Ask" button
  if (exchanges.length === 0 && !showInput) {
    return (
      <Box
        onClick={handleOpenThread}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          cursor: 'pointer',
          mt: 1,
          px: 1,
          py: 0.5,
          borderRadius: 1,
          bgcolor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.03)',
          '&:hover': {
            bgcolor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
          },
          transition: 'background-color 0.2s',
        }}
      >
        <QuestionAnswerIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
          Ask {judgeName}
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ mt: 1 }}>
      {/* Collapsed summary when there are exchanges */}
      {exchanges.length > 0 && (
        <Box
          onClick={() => setExpanded(!expanded)}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            cursor: 'pointer',
            px: 1,
            py: 0.5,
            borderRadius: 1,
            bgcolor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.03)',
            '&:hover': {
              bgcolor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
            },
            transition: 'background-color 0.2s',
          }}
        >
          <QuestionAnswerIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
            Follow-up ({exchanges.length} {exchanges.length === 1 ? 'exchange' : 'exchanges'})
          </Typography>
          {expanded ? (
            <ExpandLessIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
          )}
        </Box>
      )}

      {/* Thread content */}
      <Collapse in={expanded || exchanges.length === 0}>
        <Box
          sx={{
            mt: 1,
            pl: 1.5,
            borderLeft: '2px solid',
            borderColor: judgeColor,
          }}
        >
          {/* Previous exchanges */}
          {exchanges.map((exchange, i) => (
            <Box key={i} sx={{ mb: 1.5 }}>
              {/* User question */}
              <Box sx={{ mb: 0.75 }}>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 600, color: 'primary.main', display: 'block', mb: 0.25 }}
                >
                  You:
                </Typography>
                <Typography variant="caption" sx={{ display: 'block' }}>
                  {exchange.question}
                </Typography>
              </Box>
              {/* Judge answer */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: judgeColor,
                    }}
                  />
                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                    {judgeName}:
                  </Typography>
                </Box>
                <Box sx={{ ...mdSx, fontSize: '0.75rem' }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={markdownComponents}
                  >
                    {exchange.answer}
                  </ReactMarkdown>
                </Box>
              </Box>
            </Box>
          ))}

          {/* Input area */}
          {(showInput || exchanges.length > 0) && (
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-end', mt: exchanges.length > 0 ? 0.5 : 0 }}>
              <TextField
                inputRef={inputRef}
                fullWidth
                size="small"
                placeholder={exchanges.length > 0 ? 'Ask another question...' : `Ask ${judgeName} a question...`}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                error={!!error}
                helperText={error}
                multiline
                maxRows={3}
                sx={{
                  '& .MuiInputBase-root': {
                    fontSize: '0.8rem',
                    py: 0.5,
                  },
                }}
              />
              <IconButton
                onClick={handleSubmit}
                disabled={isLoading || !question.trim()}
                size="small"
                color="primary"
                sx={{ mb: error ? 2.5 : 0 }}
              >
                {isLoading ? <CircularProgress size={18} /> : <SendIcon sx={{ fontSize: 18 }} />}
              </IconButton>
            </Box>
          )}
          <div ref={threadEndRef} />
        </Box>
      </Collapse>
    </Box>
  )
}
