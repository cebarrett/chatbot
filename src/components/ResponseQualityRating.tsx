import { useState } from 'react'
import { Box, Chip, Collapse, Typography, Paper, CircularProgress } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import type { JudgeRatings, QualityRating } from '../types'

interface ResponseQualityRatingProps {
  ratings: JudgeRatings
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
  judgeName: string
  rating: QualityRating | undefined
  expanded: boolean
  onToggle: () => void
}

function SingleRatingBadge({ judgeName, rating, expanded, onToggle }: SingleRatingBadgeProps) {
  if (!rating) {
    return (
      <Chip
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {judgeName}:
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
  rating: QualityRating
  color: 'success' | 'warning' | 'error'
}

function RatingDetails({ judgeName, rating, color }: RatingDetailsProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        bgcolor: 'background.paper',
        borderColor: `${color}.main`,
        flex: 1,
        minWidth: 0,
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 700, color: `${color}.main`, display: 'block', mb: 0.5 }}>
        {judgeName}
      </Typography>
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

export function ResponseQualityRating({ ratings }: ResponseQualityRatingProps) {
  const [expanded, setExpanded] = useState(false)

  const hasAnyRating = ratings.claude || ratings.gemini

  if (!hasAnyRating) {
    return null
  }

  return (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <SingleRatingBadge
          judgeName="Claude"
          rating={ratings.claude}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
        />
        <SingleRatingBadge
          judgeName="Gemini"
          rating={ratings.gemini}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
        />
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ display: 'flex', gap: 1, mt: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
          {ratings.claude && (
            <RatingDetails
              judgeName="Claude"
              rating={ratings.claude}
              color={getRatingColor(ratings.claude.score)}
            />
          )}
          {ratings.gemini && (
            <RatingDetails
              judgeName="Gemini"
              rating={ratings.gemini}
              color={getRatingColor(ratings.gemini.score)}
            />
          )}
        </Box>
      </Collapse>
    </Box>
  )
}
