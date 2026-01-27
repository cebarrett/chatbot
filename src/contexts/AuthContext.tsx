import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { setTokenProvider } from '../services/appsyncClient';

interface AuthProviderProps {
  children: React.ReactNode;
}

// This component initializes the AppSync client with the Clerk token provider
export function AuthProvider({ children }: AuthProviderProps) {
  const { getToken } = useAuth();

  useEffect(() => {
    // Set up the token provider for AppSync client
    // This will be called whenever the client needs an auth token
    setTokenProvider(async () => {
      // Get a token for AppSync - Clerk will handle token refresh automatically
      const token = await getToken();
      return token;
    });
  }, [getToken]);

  return <>{children}</>;
}
