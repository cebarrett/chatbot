import { useState } from 'react'
import {
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Typography,
  Tooltip,
} from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness'
import CheckIcon from '@mui/icons-material/Check'
import { useTheme } from '../contexts/ThemeContext'

type ThemeMode = 'light' | 'dark' | 'system'

const themeOptions: { value: ThemeMode; label: string; icon: React.ReactElement }[] = [
  { value: 'light', label: 'Light', icon: <LightModeIcon fontSize="small" /> },
  { value: 'dark', label: 'Dark', icon: <DarkModeIcon fontSize="small" /> },
  { value: 'system', label: 'System', icon: <SettingsBrightnessIcon fontSize="small" /> },
]

export function SettingsMenu() {
  const { mode, setMode } = useTheme()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const open = Boolean(anchorEl)

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  const handleThemeChange = (newMode: ThemeMode) => {
    setMode(newMode)
  }

  return (
    <>
      <Tooltip title="Settings">
        <IconButton onClick={handleOpen} size="small">
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        slotProps={{
          paper: {
            sx: { minWidth: 200 },
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ px: 2, py: 0.5, display: 'block' }}
        >
          Appearance
        </Typography>
        {themeOptions.map((option) => (
          <MenuItem
            key={option.value}
            onClick={() => handleThemeChange(option.value)}
            selected={mode === option.value}
          >
            <ListItemIcon>{option.icon}</ListItemIcon>
            <ListItemText>{option.label}</ListItemText>
            {mode === option.value && <CheckIcon fontSize="small" sx={{ ml: 1 }} />}
          </MenuItem>
        ))}
        <Divider />
      </Menu>
    </>
  )
}
