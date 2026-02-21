import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { dark } from '@clerk/themes'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { getClerkPublishableKey } from './config/clerk'
import App from './App.tsx'

const clerkPubKey = getClerkPublishableKey()

function ClerkWithTheme({ children }: { children: React.ReactNode }) {
  const { resolvedMode } = useTheme()
  const isDark = resolvedMode === 'dark'

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      appearance={isDark ? { baseTheme: dark } : undefined}
    >
      {children}
    </ClerkProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ClerkWithTheme>
        <App />
      </ClerkWithTheme>
    </ThemeProvider>
  </StrictMode>,
)
