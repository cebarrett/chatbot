import { useAuth } from '@clerk/clerk-react';
import { setTokenProvider } from '../services/appsyncClient';

interface AuthProviderProps {
  children: React.ReactNode;
}

// This component initializes the AppSync client with the Clerk token provider
export function AuthProvider({ children }: AuthProviderProps) {
  const { getToken } = useAuth();

  // Set up the token provider synchronously during render so it's
  // available before any child useEffect hooks fire
  setTokenProvider(async () => {
    const token = await getToken();
    return token;
  });

  return <>{children}</>;
}
