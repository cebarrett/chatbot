import { useState, useRef, useEffect } from 'react'
import {
  Box,
  List,
  ListItemButton,
  ListItemText,
  Typography,
  IconButton,
  Divider,
  Drawer,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  InputBase,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import ChatIcon from '@mui/icons-material/Chat'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import type { Chat } from '../types'

const SIDEBAR_WIDTH = 280

const TITLE_MAX_LENGTH = 100

interface ChatHistorySidebarProps {
  chats: Chat[]
  activeChatId: string | null
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onDeleteChat: (chatId: string) => void
  onRenameChat: (chatId: string, newTitle: string) => void
  open: boolean
  onClose: () => void
}

export function ChatHistorySidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  open,
  onClose,
}: ChatHistorySidebarProps) {
  const muiTheme = useTheme()
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('md'))
  const [deleteConfirmChatId, setDeleteConfirmChatId] = useState<string | null>(null)
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingChatId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingChatId])

  const startEditing = (chat: Chat) => {
    setEditingChatId(chat.id)
    setEditingTitle(chat.title)
  }

  const commitRename = () => {
    if (!editingChatId) return
    const trimmed = editingTitle.trim()
    if (trimmed && trimmed !== chats.find((c) => c.id === editingChatId)?.title) {
      onRenameChat(editingChatId, trimmed)
    }
    setEditingChatId(null)
    setEditingTitle('')
  }

  const cancelEditing = () => {
    setEditingChatId(null)
    setEditingTitle('')
  }

  const handleDeleteClick = (chatId: string) => {
    setDeleteConfirmChatId(chatId)
  }

  const handleDeleteConfirm = () => {
    if (deleteConfirmChatId) {
      onDeleteChat(deleteConfirmChatId)
    }
    setDeleteConfirmChatId(null)
  }

  const handleDeleteCancel = () => {
    setDeleteConfirmChatId(null)
  }
  const formatDate = (date: Date) => {
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
  }

  const handleSelectChat = (chatId: string) => {
    onSelectChat(chatId)
    if (isMobile) onClose()
  }

  const handleNewChat = () => {
    onNewChat()
    if (isMobile) onClose()
  }

  const deleteConfirmDialog = (
    <Dialog
      open={deleteConfirmChatId !== null}
      onClose={handleDeleteCancel}
    >
      <DialogTitle>Delete chat?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          This will permanently delete this chat and all its messages. This can't be undone.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleDeleteCancel}>Cancel</Button>
        <Button onClick={handleDeleteConfirm} color="error">
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  )

  const sidebarContent = (
    <Box
      sx={{
        width: SIDEBAR_WIDTH,
        height: '100%',
        bgcolor: (theme) =>
          theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
        borderRight: isMobile ? 0 : 1,
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
          onClick={handleNewChat}
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
            {chats.map((chat) => {
              const isEditing = editingChatId === chat.id
              return (
                <ListItemButton
                  key={chat.id}
                  selected={chat.id === activeChatId}
                  onClick={() => {
                    if (!isEditing) handleSelectChat(chat.id)
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault()
                    startEditing(chat)
                  }}
                  sx={{
                    py: 1.5,
                    px: 2,
                    '&.Mui-selected': {
                      bgcolor: 'primary.light',
                      '&:hover': { bgcolor: 'primary.light' },
                    },
                    '& .chat-actions': {
                      opacity: 0,
                    },
                    '&:hover .chat-actions, &:focus-within .chat-actions': {
                      opacity: 1,
                    },
                  }}
                >
                  {chat.incognito && (
                    <VisibilityOffIcon
                      fontSize="small"
                      sx={{ mr: 1, opacity: 0.6, flexShrink: 0 }}
                    />
                  )}
                  {isEditing ? (
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <InputBase
                        inputRef={editInputRef}
                        value={editingTitle}
                        onChange={(e) =>
                          setEditingTitle(e.target.value.slice(0, TITLE_MAX_LENGTH))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitRename()
                          } else if (e.key === 'Escape') {
                            cancelEditing()
                          }
                        }}
                        onBlur={commitRename}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        fullWidth
                        sx={{
                          fontSize: '0.875rem',
                          py: 0,
                          px: 0.5,
                          border: 1,
                          borderColor: 'primary.main',
                          borderRadius: 0.5,
                          bgcolor: 'background.paper',
                        }}
                        inputProps={{
                          maxLength: TITLE_MAX_LENGTH,
                        }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {formatDate(chat.updatedAt)}
                      </Typography>
                    </Box>
                  ) : (
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
                  )}
                  {!isEditing && (
                    <Box
                      className="chat-actions"
                      sx={{
                        display: 'flex',
                        flexShrink: 0,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          startEditing(chat)
                        }}
                        sx={{
                          opacity: 0.5,
                          '&:hover': { opacity: 1, color: 'primary.main' },
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteClick(chat.id)
                        }}
                        sx={{
                          opacity: 0.5,
                          '&:hover': { opacity: 1, color: 'error.main' },
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  )}
                </ListItemButton>
              )
            })}
          </List>
        )}
      </Box>
    </Box>
  )

  if (isMobile) {
    return (
      <>
        <Drawer
          variant="temporary"
          open={open}
          onClose={onClose}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': {
              width: SIDEBAR_WIDTH,
              boxSizing: 'border-box',
            },
          }}
        >
          {sidebarContent}
        </Drawer>
        {deleteConfirmDialog}
      </>
    )
  }

  return (
    <>
      {sidebarContent}
      {deleteConfirmDialog}
    </>
  )
}
