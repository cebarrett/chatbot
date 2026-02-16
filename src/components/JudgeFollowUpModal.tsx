import { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  CircularProgress,
  Paper,
  IconButton,
  useTheme,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SendIcon from '@mui/icons-material/Send'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { QualityRating, Message, JudgeFollowUp } from '../types'
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

interface JudgeFollowUpModalProps {
  open: boolean
  onClose: () => void
  judgeId: string
  judgeName: string
  judgeColor: string
  rating: QualityRating
  conversationHistory: Message[]
  responseContent: string
  respondingProvider: string
  onFollowUpComplete: (followUp: JudgeFollowUp) => void
}

export function JudgeFollowUpModal({
  open,
  onClose,
  judgeId,
  judgeName,
  judgeColor,
  rating,
  conversationHistory,
  responseContent,
  respondingProvider,
  onFollowUpComplete,
}: JudgeFollowUpModalProps) {
  const [question, setQuestion] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const mdSx = getMarkdownSx(isDark)

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
    if (!question.trim()) return

    setIsLoading(true)
    setError(null)

    try {
      const followUp = await askFollowUpQuestion(
        judgeId,
        conversationHistory,
        responseContent,
        respondingProvider,
        rating,
        question.trim()
      )
      setAnswer(followUp.answer)
      onFollowUpComplete(followUp)
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

  const handleClose = () => {
    setQuestion('')
    setAnswer(null)
    setError(null)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { maxHeight: '80dvh' },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              bgcolor: judgeColor,
            }}
          />
          <Typography variant="h6">
            Ask {judgeName}
          </Typography>
        </Box>
        <IconButton onClick={handleClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {/* Original Rating Summary */}
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            mb: 2,
            bgcolor: 'action.hover',
          }}
        >
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Original Rating: {rating.score.toFixed(1)}/10
          </Typography>
          <Box sx={{ ...mdSx, fontSize: '0.875rem', mb: rating.problems.length > 0 ? 1 : 0 }}>
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
              {rating.explanation}
            </ReactMarkdown>
          </Box>
          {rating.problems.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Issues identified:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2, mt: 0.5 }}>
                {rating.problems.map((problem, i) => (
                  <Typography key={i} component="li" variant="caption" color="text.secondary">
                    {problem}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}
        </Paper>

        {/* Question Input or Answer Display */}
        {answer ? (
          <Box>
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 2,
                bgcolor: (theme) => theme.palette.mode === 'dark'
                  ? 'rgba(144, 202, 249, 0.08)'
                  : 'rgba(25, 118, 210, 0.04)',
                borderColor: 'primary.main',
              }}
            >
              <Typography variant="subtitle2" color="primary.main" gutterBottom>
                Your question:
              </Typography>
              <Typography variant="body2">{question}</Typography>
            </Paper>

            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderColor: judgeColor,
                borderWidth: 2,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: judgeColor,
                  }}
                />
                <Typography variant="subtitle2">{judgeName}'s response:</Typography>
              </Box>
              <Box sx={{ ...mdSx, fontSize: '0.875rem' }}>
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                  {answer}
                </ReactMarkdown>
              </Box>
            </Paper>
          </Box>
        ) : (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Ask a follow-up question about this rating. For example: "Why did you rate this a {rating.score.toFixed(1)}?" or "How could this response be improved?"
            </Typography>

            <TextField
              fullWidth
              multiline
              rows={3}
              placeholder="Type your follow-up question..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              autoFocus
              error={!!error}
              helperText={error}
            />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {answer ? (
          <Button onClick={handleClose} variant="contained">
            Done
          </Button>
        ) : (
          <>
            <Button onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              variant="contained"
              disabled={isLoading || !question.trim()}
              endIcon={isLoading ? <CircularProgress size={16} /> : <SendIcon />}
            >
              {isLoading ? 'Asking...' : 'Ask'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
