import {
  Box,
  List,
  ListItemButton,
  ListItemText,
  Typography,
  IconButton,
  Divider,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import ChatIcon from '@mui/icons-material/Chat'
import type { Chat } from '../types'

interface ChatHistorySidebarProps {
  chats: Chat[]
  activeChatId: string | null
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onDeleteChat: (chatId: string) => void
}

export function ChatHistorySidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
}: ChatHistorySidebarProps) {
  const formatDate = (date: Date) => {
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
  }

  return (
    <Box
      sx={{
        width: 280,
        height: '100%',
        bgcolor: (theme) =>
          theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        sx={{
          p: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="subtitle1" fontWeight="medium">
          Chat History
        </Typography>
        <IconButton
          size="small"
          onClick={onNewChat}
          sx={{
            bgcolor: 'primary.main',
            color: 'white',
            '&:hover': { bgcolor: 'primary.dark' },
          }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
      <Divider />
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {chats.length === 0 ? (
          <Box
            sx={{
              p: 3,
              textAlign: 'center',
              color: 'text.secondary',
            }}
          >
            <ChatIcon sx={{ fontSize: 40, opacity: 0.5, mb: 1 }} />
            <Typography variant="body2">No chat history yet</Typography>
            <Typography variant="caption">Start a new conversation</Typography>
          </Box>
        ) : (
          <List disablePadding>
            {chats.map((chat) => (
              <ListItemButton
                key={chat.id}
                selected={chat.id === activeChatId}
                onClick={() => onSelectChat(chat.id)}
                sx={{
                  py: 1.5,
                  px: 2,
                  '&.Mui-selected': {
                    bgcolor: 'primary.light',
                    '&:hover': { bgcolor: 'primary.light' },
                  },
                }}
              >
                <ListItemText
                  primary={chat.title}
                  secondary={formatDate(chat.updatedAt)}
                  primaryTypographyProps={{
                    noWrap: true,
                    variant: 'body2',
                    fontWeight: chat.id === activeChatId ? 'medium' : 'normal',
                  }}
                  secondaryTypographyProps={{
                    variant: 'caption',
                  }}
                />
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteChat(chat.id)
                  }}
                  sx={{
                    opacity: 0.5,
                    '&:hover': { opacity: 1, color: 'error.main' },
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
    </Box>
  )
}
