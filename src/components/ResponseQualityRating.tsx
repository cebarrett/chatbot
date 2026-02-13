import { useState } from 'react'
import { Alert, Box, Chip, Collapse, Typography, Paper, CircularProgress, Button, useTheme } from '@mui/material'
import BalanceIcon from '@mui/icons-material/Balance'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { JudgeRatings, QualityRating, Message, JudgeFollowUp } from '../types'
import { getJudgeById } from '../services/judgeRegistry'
import { JudgeFollowUpModal } from './JudgeFollowUpModal'

interface ResponseQualityRatingProps {
  ratings: JudgeRatings
  loadingJudges?: string[]  // Judges actively loading for this message
  conversationHistory?: Message[]  // For follow-up context
  responseContent?: string  // The assistant response that was rated
  respondingProvider?: string  // Provider that generated the response
  onFollowUpComplete?: (judgeId: string, followUp: JudgeFollowUp) => void  // Callback when follow-up is answered
}

function getRatingColor(score: number): 'success' | 'warning' | 'error' {
  if (score >= 7.5) return 'success'
  if (score >= 5.0) return 'warning'
  return 'error'
}

function getRatingLabel(score: number): string {
  if (score >= 9.0) return 'Excellent'
  if (score >= 7.5) return 'Good'
  if (score >= 5.0) return 'Fair'
  if (score >= 3.0) return 'Poor'
  return 'Very Poor'
}

const DISAGREEMENT_THRESHOLD = 2.5

function hasJudgeDisagreement(ratings: JudgeRatings): boolean {
  const scores = Object.values(ratings).map((r) => r.score)
  if (scores.length < 2) return false
  return Math.max(...scores) - Math.min(...scores) >= DISAGREEMENT_THRESHOLD
}

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

interface SingleRatingBadgeProps {
  judgeId: string
  judgeName: string
  judgeColor: string
  rating: QualityRating | undefined
  expanded: boolean
  onToggle: () => void
}

function SingleRatingBadge({
  judgeName,
  judgeColor,
  rating,
  expanded,
  onToggle,
}: SingleRatingBadgeProps) {
  if (!rating) {
    return (
      <Chip
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: judgeColor,
              }}
            />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {judgeName}
            </Typography>
            <CircularProgress size={12} color="inherit" />
          </Box>
        }
        size="small"
        variant="outlined"
        sx={{ opacity: 0.7, width: { xs: '100%', sm: 'auto' } }}
      />
    )
  }

  const color = getRatingColor(rating.score)
  const label = getRatingLabel(rating.score)

  return (
    <Chip
      label={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: judgeColor,
            }}
          />
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {judgeName}: {rating.score.toFixed(1)}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.8 }}>
            ({label})
          </Typography>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </Box>
      }
      color={color}
      size="small"
      onClick={onToggle}
      sx={{
        cursor: 'pointer',
        width: { xs: '100%', sm: 'auto' },
        '&:hover': {
          filter: 'brightness(0.95)',
        },
      }}
    />
  )
}

interface RatingDetailsProps {
  judgeName: string
  judgeColor: string
  rating: QualityRating
  canAskFollowUp?: boolean
  onAskFollowUp?: () => void
}

function RatingDetails({ judgeName, judgeColor, rating, canAskFollowUp, onAskFollowUp }: RatingDetailsProps) {
  const color = getRatingColor(rating.score)
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

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        bgcolor: 'background.paper',
        borderColor: `${color}.main`,
        flex: 1,
        minWidth: 200,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: judgeColor,
            }}
          />
          <Typography variant="caption" sx={{ fontWeight: 700, color: `${color}.main` }}>
            {judgeName}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 700, color: `${color}.main` }}>
            - {rating.score.toFixed(1)}/10
          </Typography>
        </Box>
        {canAskFollowUp && !rating.followUp && (
          <Button
            size="small"
            startIcon={<QuestionAnswerIcon sx={{ fontSize: 14 }} />}
            onClick={onAskFollowUp}
            sx={{
              fontSize: '0.7rem',
              py: 0,
              px: 1,
              minHeight: 24,
              textTransform: 'none',
            }}
          >
            Ask
          </Button>
        )}
      </Box>
      <Box sx={{ ...mdSx, fontSize: '0.875rem', mb: rating.problems.length > 0 || rating.followUp ? 1.5 : 0 }}>
        <ReactMarkdown components={markdownComponents}>
          {rating.explanation}
        </ReactMarkdown>
      </Box>

      {rating.problems.length > 0 && (
        <>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              color: 'text.secondary',
              display: 'block',
              mb: 0.5,
            }}
          >
            Issues identified:
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2, mb: rating.followUp ? 1.5 : 0 }}>
            {rating.problems.map((problem, index) => (
              <Typography
                key={index}
                component="li"
                variant="caption"
                sx={{ color: 'text.secondary', mb: 0.25 }}
              >
                {problem}
              </Typography>
            ))}
          </Box>
        </>
      )}

      {rating.followUp && (
        <Paper
          variant="outlined"
          sx={{
            p: 1,
            mt: 1,
            bgcolor: 'action.hover',
            borderColor: judgeColor,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              color: 'text.secondary',
              display: 'block',
              mb: 0.5,
            }}
          >
            Follow-up Q&A:
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
            Q: {rating.followUp.question}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
            A:
          </Typography>
          <Box sx={{ ...mdSx, fontSize: '0.75rem' }}>
            <ReactMarkdown components={markdownComponents}>
              {rating.followUp.answer}
            </ReactMarkdown>
          </Box>
        </Paper>
      )}
    </Paper>
  )
}

export function ResponseQualityRating({
  ratings,
  loadingJudges = [],
  conversationHistory,
  responseContent,
  respondingProvider,
  onFollowUpComplete,
}: ResponseQualityRatingProps) {
  const [expanded, setExpanded] = useState(false)
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false)
  const [selectedJudgeId, setSelectedJudgeId] = useState<string | null>(null)

  // Show all judges that have ratings (even if disabled), plus judges actively loading for this message
  const judgeIdsToShow = new Set<string>([
    ...Object.keys(ratings), // All judges with existing ratings
    ...loadingJudges, // Judges actively loading for this specific message
  ])

  const judgesWithRatings = Array.from(judgeIdsToShow)
    .map((judgeId) => ({
      judgeId,
      judge: getJudgeById(judgeId),
      rating: ratings[judgeId],
    }))
    .filter((item) => item.judge !== undefined)
    // Only show loading spinners for judges that are actively loading for this message
    .filter((item) => item.rating !== undefined || loadingJudges.includes(item.judgeId))

  if (judgesWithRatings.length === 0) {
    return null
  }

  const showDisagreement = loadingJudges.length === 0 && hasJudgeDisagreement(ratings)

  const canAskFollowUp = !!(conversationHistory && responseContent && respondingProvider && onFollowUpComplete)

  const handleAskFollowUp = (judgeId: string) => {
    setSelectedJudgeId(judgeId)
    setFollowUpModalOpen(true)
  }

  const handleFollowUpComplete = (followUp: JudgeFollowUp) => {
    if (selectedJudgeId && onFollowUpComplete) {
      onFollowUpComplete(selectedJudgeId, followUp)
    }
  }

  const handleCloseModal = () => {
    setFollowUpModalOpen(false)
    setSelectedJudgeId(null)
  }

  const selectedJudge = selectedJudgeId ? getJudgeById(selectedJudgeId) : null
  const selectedRating = selectedJudgeId ? ratings[selectedJudgeId] : null

  return (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', flexDirection: { xs: 'column', sm: 'row' } }}>
        {judgesWithRatings.map(({ judgeId, judge, rating }) => (
          <SingleRatingBadge
            key={judgeId}
            judgeId={judgeId}
            judgeName={judge!.name}
            judgeColor={judge!.color}
            rating={rating}
            expanded={expanded}
            onToggle={() => setExpanded(!expanded)}
          />
        ))}
        {showDisagreement && (
          <Chip
            icon={<BalanceIcon sx={{ fontSize: 16 }} />}
            label="Judges disagree"
            color="info"
            size="small"
            variant="outlined"
            onClick={() => setExpanded(!expanded)}
            sx={{
              cursor: 'pointer',
              width: { xs: '100%', sm: 'auto' },
              '&:hover': { filter: 'brightness(0.95)' },
            }}
          />
        )}
      </Box>

      <Collapse in={expanded}>
        {showDisagreement && (
          <Alert
            severity="info"
            variant="outlined"
            icon={<BalanceIcon />}
            sx={{ mt: 1, mb: 1 }}
          >
            <Typography variant="body2">
              These AI judges evaluated this response differently. This is normal — AI systems
              have different strengths and biases. Consider reading each judge's explanation to
              decide for yourself.
            </Typography>
          </Alert>
        )}
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            mt: 1,
            flexWrap: 'wrap',
            flexDirection: { xs: 'column', sm: 'row' },
          }}
        >
          {judgesWithRatings
            .filter(({ rating }) => rating !== undefined)
            .map(({ judgeId, judge, rating }) => (
              <RatingDetails
                key={judgeId}
                judgeName={judge!.name}
                judgeColor={judge!.color}
                rating={rating!}
                canAskFollowUp={canAskFollowUp}
                onAskFollowUp={() => handleAskFollowUp(judgeId)}
              />
            ))}
        </Box>
      </Collapse>

      {/* Follow-up Modal */}
      {selectedJudge && selectedRating && conversationHistory && responseContent && respondingProvider && (
        <JudgeFollowUpModal
          open={followUpModalOpen}
          onClose={handleCloseModal}
          judgeId={selectedJudgeId!}
          judgeName={selectedJudge.name}
          judgeColor={selectedJudge.color}
          rating={selectedRating}
          conversationHistory={conversationHistory}
          responseContent={responseContent}
          respondingProvider={respondingProvider}
          onFollowUpComplete={handleFollowUpComplete}
        />
      )}
    </Box>
  )
}
