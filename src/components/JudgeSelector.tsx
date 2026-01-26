import { useState } from 'react'
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Checkbox,
  ListItemText,
  ListItemIcon,
  Typography,
  Tooltip,
  Chip,
  Divider,
} from '@mui/material'
import GavelIcon from '@mui/icons-material/Gavel'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import { judgeRegistry } from '../services/judgeRegistry'

interface JudgeSelectorProps {
  enabledJudges: string[]
  onToggleJudge: (judgeId: string) => void
}

export function JudgeSelector({ enabledJudges, onToggleJudge }: JudgeSelectorProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const open = Boolean(anchorEl)

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  const handleToggle = (judgeId: string) => {
    onToggleJudge(judgeId)
  }

  const enabledCount = enabledJudges.length

  return (
    <>
      <Tooltip title="Select judges for response evaluation">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <IconButton
            onClick={handleClick}
            size="small"
            sx={{
              color: enabledCount > 0 ? 'primary.main' : 'text.secondary',
            }}
          >
            <GavelIcon fontSize="small" />
          </IconButton>
          <Chip
            label={enabledCount}
            size="small"
            color={enabledCount > 0 ? 'primary' : 'default'}
            sx={{
              height: 20,
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
            onClick={handleClick}
          />
        </Box>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        slotProps={{
          paper: {
            sx: { minWidth: 280, maxWidth: 320 },
          },
        }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2" color="text.secondary">
            Response Quality Judges
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Select which AI models evaluate responses
          </Typography>
        </Box>

        <Divider />

        {judgeRegistry.map((judge) => {
          const isEnabled = enabledJudges.includes(judge.id)
          const isConfigured = judge.isConfigured()

          return (
            <MenuItem
              key={judge.id}
              onClick={() => handleToggle(judge.id)}
              sx={{ py: 1 }}
            >
              <Checkbox
                checked={isEnabled}
                size="small"
                sx={{ mr: 1, p: 0 }}
              />
              <ListItemIcon sx={{ minWidth: 32 }}>
                {isConfigured ? (
                  <CheckCircleIcon fontSize="small" sx={{ color: 'success.main' }} />
                ) : (
                  <Tooltip title={`Set ${judge.getApiKeyEnvVar} to enable`}>
                    <ErrorOutlineIcon fontSize="small" sx={{ color: 'warning.main' }} />
                  </Tooltip>
                )}
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2">{judge.name}</Typography>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: judge.color,
                      }}
                    />
                  </Box>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary">
                    {judge.description}
                    {!isConfigured && ' (demo mode)'}
                  </Typography>
                }
              />
            </MenuItem>
          )
        })}

        <Divider />

        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {enabledCount === 0
              ? 'No judges selected - responses will not be evaluated'
              : `${enabledCount} judge${enabledCount !== 1 ? 's' : ''} will evaluate each response`}
          </Typography>
        </Box>
      </Menu>
    </>
  )
}
