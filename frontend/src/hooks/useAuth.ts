/**
 * Authentication hook for Cognito.
 */

import { useState, useEffect } from 'react';
import { getCurrentUser, fetchAuthSession, signOut } from '@aws-amplify/auth';

interface AuthState {
  isAuthenticated: boolean;
  userId: string;
  email: string;
  loading: boolean;
}

export function useAuth(): AuthState & { handleSignOut: () => Promise<void> } {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    userId: '',
    email: '',
    loading: true,
  });

  async function checkAuth() {
    try {
      const user = await getCurrentUser();
      const session = await fetchAuthSession();
      setState({
        isAuthenticated: !!session.credentials,
        userId: user.userId,
        email: user.signInDetails?.loginId || '',
        loading: false,
      });
    } catch {
      setState({ isAuthenticated: false, userId: '', email: '', loading: false });
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkAuth();
  }, []);

  async function handleSignOut() {
    await signOut();
    setState({ isAuthenticated: false, userId: '', email: '', loading: false });
  }

  return { ...state, handleSignOut };
}
