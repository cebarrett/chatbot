import { useState } from 'react'
import {
  Box,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Tooltip,
  Divider,
} from '@mui/material'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import CheckIcon from '@mui/icons-material/Check'
import { chatProviderRegistry, getProviderById } from '../services/chatProviderRegistry'

interface ProviderSelectorProps {
  selectedProviderId: string
  onSelectProvider: (providerId: string) => void
  disabled?: boolean
}

export function ProviderSelector({
  selectedProviderId,
  onSelectProvider,
  disabled = false,
}: ProviderSelectorProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const open = Boolean(anchorEl)

  const selectedProvider = getProviderById(selectedProviderId) || chatProviderRegistry[0]

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!disabled) {
      setAnchorEl(event.currentTarget)
    }
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  const handleSelect = (providerId: string) => {
    onSelectProvider(providerId)
    handleClose()
  }

  return (
    <>
      <Tooltip title={disabled ? 'Cannot change provider while generating' : 'Select AI provider'}>
        <span>
          <Button
            onClick={handleClick}
            disabled={disabled}
            size="small"
            endIcon={<KeyboardArrowDownIcon />}
            sx={{
              textTransform: 'none',
              color: 'text.primary',
              bgcolor: 'grey.100',
              '&:hover': {
                bgcolor: 'grey.200',
              },
              px: 1.5,
              py: 0.5,
            }}
          >
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: selectedProvider.color,
                mr: 1,
              }}
            />
            <Typography variant="body2">{selectedProvider.name}</Typography>
          </Button>
        </span>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        slotProps={{
          paper: {
            sx: { minWidth: 240 },
          },
        }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2" color="text.secondary">
            AI Provider
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Select which AI responds to messages
          </Typography>
        </Box>

        <Divider />

        {chatProviderRegistry.map((provider) => {
          const isSelected = provider.id === selectedProviderId
          const isConfigured = provider.isConfigured()

          return (
            <MenuItem
              key={provider.id}
              onClick={() => handleSelect(provider.id)}
              selected={isSelected}
              sx={{ py: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                {isConfigured ? (
                  <CheckCircleIcon fontSize="small" sx={{ color: 'success.main' }} />
                ) : (
                  <Tooltip title={`Set ${provider.getApiKeyEnvVar} to enable`}>
                    <ErrorOutlineIcon fontSize="small" sx={{ color: 'warning.main' }} />
                  </Tooltip>
                )}
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: provider.color,
                      }}
                    />
                    <Typography variant="body2">{provider.name}</Typography>
                  </Box>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary">
                    {provider.description}
                    {!isConfigured && ' (demo mode)'}
                  </Typography>
                }
              />
              {isSelected && (
                <CheckIcon fontSize="small" sx={{ color: 'primary.main', ml: 1 }} />
              )}
            </MenuItem>
          )
        })}

        <Divider />

        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Provider choice is saved per conversation
          </Typography>
        </Box>
      </Menu>
    </>
  )
}
