import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography,
} from '@mui/material'
import { useUserPreferences } from '../contexts/UserPreferencesContext'

interface CustomSystemPromptDialogProps {
  open: boolean
  onClose: () => void
}

export function CustomSystemPromptDialog({ open, onClose }: CustomSystemPromptDialogProps) {
  const { get, set } = useUserPreferences()
  const savedPrompt = get<string>('customSystemPrompt', '')
  const [draft, setDraft] = useState(savedPrompt)

  // Sync draft when dialog opens
  useEffect(() => {
    if (open) {
      setDraft(savedPrompt)
    }
  }, [open, savedPrompt])

  const handleSave = () => {
    set({ customSystemPrompt: draft.trim() })
    onClose()
  }

  const handleClear = () => {
    setDraft('')
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Custom Instructions</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          These instructions will be included in every message you send. The AI judges will also
          take them into account when evaluating responses.
        </Typography>
        <TextField
          multiline
          minRows={4}
          maxRows={12}
          fullWidth
          placeholder="e.g. Always respond like a pirate. Use nautical metaphors and say 'arrr' frequently."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>
          {draft.length}/2000
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClear} disabled={!draft}>
          Clear
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained">
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
