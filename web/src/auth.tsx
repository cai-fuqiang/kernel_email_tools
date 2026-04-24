import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getCurrentUser } from './api/client';
import type { CurrentUser } from './api/types';

type AuthState = {
  currentUser: CurrentUser | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  canWrite: boolean;
  isAdmin: boolean;
};

const AuthContext = createContext<AuthState>({
  currentUser: null,
  loading: true,
  error: '',
  refresh: async () => {},
  canWrite: false,
  isAdmin: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const user = await getCurrentUser();
      setCurrentUser(user);
      setError('');
    } catch (err) {
      setCurrentUser(null);
      setError(err instanceof Error ? err.message : 'Failed to load current user');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const value = useMemo<AuthState>(() => {
    const role = currentUser?.role || 'viewer';
    return {
      currentUser,
      loading,
      error,
      refresh,
      canWrite: role === 'admin' || role === 'editor',
      isAdmin: role === 'admin',
    };
  }, [currentUser, loading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
