import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  getAuthSession,
  loginAccount,
  logoutAccount,
  registerAccount,
} from './api/client';
import type { CurrentUser, LoginResult, RegisterResult } from './api/types';

type LoginParams = {
  username: string;
  password: string;
};

type RegisterParams = {
  username: string;
  password: string;
  display_name: string;
  email?: string;
};

type AuthState = {
  currentUser: CurrentUser | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  login: (params: LoginParams) => Promise<LoginResult>;
  logout: () => Promise<void>;
  register: (params: RegisterParams) => Promise<RegisterResult>;
  canWrite: boolean;
  isAdmin: boolean;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthState>({
  currentUser: null,
  loading: true,
  error: '',
  refresh: async () => {},
  login: async () => {
    throw new Error('AuthProvider not mounted');
  },
  logout: async () => {},
  register: async () => {
    throw new Error('AuthProvider not mounted');
  },
  canWrite: false,
  isAdmin: false,
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const session = await getAuthSession();
      setCurrentUser(session.authenticated ? session.user : null);
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

  useEffect(() => {
    const onUnauthorized = () => {
      setCurrentUser(null);
    };
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, []);

  const login = async (params: LoginParams) => {
    const result = await loginAccount(params);
    setCurrentUser(result.user);
    setError('');
    return result;
  };

  const logout = async () => {
    await logoutAccount();
    setCurrentUser(null);
    setError('');
  };

  const register = async (params: RegisterParams) => {
    return registerAccount(params);
  };

  const value = useMemo<AuthState>(() => {
    const role = currentUser?.role || 'viewer';
    return {
      currentUser,
      loading,
      error,
      refresh,
      login,
      logout,
      register,
      canWrite: role === 'admin' || role === 'editor',
      isAdmin: role === 'admin',
      isAuthenticated: !!currentUser,
    };
  }, [currentUser, loading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
