import { useState } from 'react'
import { Box, Chip, Collapse, Typography, Paper, CircularProgress } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import type { JudgeRatings, QualityRating } from '../types'
import { getJudgeById } from '../services/judgeRegistry'

interface ResponseQualityRatingProps {
  ratings: JudgeRatings
  loadingJudges?: string[]  // Judges actively loading for this message
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
        sx={{ opacity: 0.7 }}
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
}

function RatingDetails({ judgeName, judgeColor, rating }: RatingDetailsProps) {
  const color = getRatingColor(rating.score)

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
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
      <Typography variant="body2" sx={{ mb: rating.problems.length > 0 ? 1.5 : 0 }}>
        {rating.explanation}
      </Typography>

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
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
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
    </Paper>
  )
}

export function ResponseQualityRating({ ratings, loadingJudges = [] }: ResponseQualityRatingProps) {
  const [expanded, setExpanded] = useState(false)

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

  return (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
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
      </Box>

      <Collapse in={expanded}>
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            mt: 1,
            flexWrap: 'wrap',
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
              />
            ))}
        </Box>
      </Collapse>
    </Box>
  )
}
