import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useAuth } from '@clerk/clerk-react'
import {
  loadCachedPreferences,
  fetchPreferences,
  savePreferences,
} from '../services/userPreferencesService'

// The preferences object is intentionally untyped at this layer.
// Feature-specific code (onboarding, nudges, etc.) will define and
// read/write their own keys. This keeps the infrastructure generic.
type Preferences = Record<string, unknown>

interface UserPreferencesContextValue {
  /** Current preferences (from cache, then server). */
  preferences: Preferences
  /** True while the initial server fetch is in flight. */
  loading: boolean
  /** Read a single preference key with a typed default. */
  get: <T>(key: string, defaultValue: T) => T
  /** Set one or more preference keys (merged, then persisted). */
  set: (patch: Preferences) => void
}

const UserPreferencesContext = createContext<UserPreferencesContextValue | undefined>(undefined)

interface UserPreferencesProviderProps {
  children: ReactNode
}

export function UserPreferencesProvider({ children }: UserPreferencesProviderProps) {
  const { isSignedIn } = useAuth()
  const [preferences, setPreferences] = useState<Preferences>(loadCachedPreferences)
  const [loading, setLoading] = useState(true)

  // Keep a ref to the latest preferences so the `set` callback
  // always merges against the current value without needing to
  // appear in its dependency array.
  const prefsRef = useRef(preferences)
  prefsRef.current = preferences

  // Fetch from server once signed in
  useEffect(() => {
    if (!isSignedIn) {
      setLoading(false)
      return
    }

    let cancelled = false
    fetchPreferences()
      .then((serverPrefs) => {
        if (!cancelled) {
          setPreferences(serverPrefs)
        }
      })
      .catch((err) => {
        console.error('Failed to fetch user preferences:', err)
        // Keep cached preferences on error
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [isSignedIn])

  const get = useCallback(<T,>(key: string, defaultValue: T): T => {
    const val = prefsRef.current[key]
    return val !== undefined ? (val as T) : defaultValue
  }, [])

  const set = useCallback((patch: Preferences) => {
    const merged = { ...prefsRef.current, ...patch }
    setPreferences(merged)
    // Fire-and-forget persist — the cache is already updated synchronously
    // inside savePreferences, so the next `get` will see the new value.
    savePreferences(merged).catch((err) =>
      console.error('Failed to save user preferences:', err)
    )
  }, [])

  const value = useMemo(
    () => ({ preferences, loading, get, set }),
    [preferences, loading, get, set],
  )

  return (
    <UserPreferencesContext.Provider value={value}>
      {children}
    </UserPreferencesContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUserPreferences() {
  const context = useContext(UserPreferencesContext)
  if (context === undefined) {
    throw new Error('useUserPreferences must be used within a UserPreferencesProvider')
  }
  return context
}
