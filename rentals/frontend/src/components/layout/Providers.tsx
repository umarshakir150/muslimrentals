'use client';

import { ThemeProvider } from 'next-themes';
import { ReactNode, useEffect } from 'react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

function AuthInitializer({ children }: { children: ReactNode }) {
  const { accessToken, setAuth, clearAuth } = useAuthStore();

  useEffect(() => {
    if (!accessToken) return;
    // Validate token on mount
    authApi.me()
      .then((res) => { if (res.data) setAuth(res.data, accessToken); })
      .catch(() => {
        // Try refresh
        authApi.refresh()
          .then((res) => {
            if (res.data?.accessToken) {
              useAuthStore.getState().setAuth(useAuthStore.getState().user!, res.data.accessToken);
            }
          })
          .catch(() => clearAuth());
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <AuthInitializer>
        {children}
      </AuthInitializer>
    </ThemeProvider>
  );
}
