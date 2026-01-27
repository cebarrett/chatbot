import {
  SignedIn,
  SignedOut,
  SignIn,
  UserButton,
} from '@clerk/clerk-react'
import { Box, Container, Typography, Paper } from '@mui/material'
import { useTheme } from '../contexts/ThemeContext'
import { AuthProvider } from '../contexts/AuthContext'

interface AuthLayoutProps {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { mode } = useTheme()
  const isDark = mode === 'dark'

  return (
    <>
      <SignedIn>
        <AuthProvider>
          {children}
        </AuthProvider>
      </SignedIn>
      <SignedOut>
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: isDark ? '#121212' : '#f5f5f5',
            p: 2,
          }}
        >
          <Container maxWidth="sm">
            <Paper
              elevation={3}
              sx={{
                p: 4,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                bgcolor: isDark ? '#1e1e1e' : '#fff',
              }}
            >
              <Typography variant="h4" component="h1" gutterBottom>
                Welcome to Chatbot
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                Sign in to start chatting with AI
              </Typography>
              <SignIn
                appearance={{
                  elements: {
                    rootBox: {
                      width: '100%',
                    },
                    card: {
                      boxShadow: 'none',
                      backgroundColor: 'transparent',
                    },
                  },
                }}
              />
            </Paper>
          </Container>
        </Box>
      </SignedOut>
    </>
  )
}

// Export UserButton for use in the header
export { UserButton }
