import { useState } from 'react'
import { Box, Chip, Collapse, Typography, Paper } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import type { QualityRating } from '../types'

interface ResponseQualityRatingProps {
  rating: QualityRating
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

export function ResponseQualityRating({ rating }: ResponseQualityRatingProps) {
  const [expanded, setExpanded] = useState(false)

  const color = getRatingColor(rating.score)
  const label = getRatingLabel(rating.score)

  return (
    <Box sx={{ mt: 1.5 }}>
      <Chip
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Quality: {rating.score.toFixed(1)}/10
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              ({label})
            </Typography>
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </Box>
        }
        color={color}
        size="small"
        onClick={() => setExpanded(!expanded)}
        sx={{
          cursor: 'pointer',
          '&:hover': {
            filter: 'brightness(0.95)',
          },
        }}
      />

      <Collapse in={expanded}>
        <Paper
          variant="outlined"
          sx={{
            mt: 1,
            p: 1.5,
            bgcolor: 'background.paper',
            borderColor: `${color}.main`,
          }}
        >
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
      </Collapse>
    </Box>
  )
}
