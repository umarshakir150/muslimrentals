'use client';

import { ThemeProvider } from 'next-themes';
import { ReactNode, useEffect, useState } from 'react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

function AuthInitializer({ children }: { children: ReactNode }) {
  // The auth store persists to localStorage and rehydrates it
  // asynchronously (Zustand's persist middleware finishes this on a
  // microtask after the initial render, not synchronously during it), so
  // the very first render of this component always sees the store's
  // pre-hydration defaults (accessToken: null) regardless of what's
  // actually saved. An effect with an empty dependency array captures
  // whatever `accessToken` was at that first run and never sees the real
  // persisted value once hydration completes moments later -- silently
  // skipping the server-side validation call below on every single page
  // load. This is the root cause of a banned/deleted/deactivated account
  // still appearing logged in after a refresh: nothing ever re-checked.
  // Waiting for the persist middleware's own hydration-finished signal
  // before running the check (once, with the real token) fixes that.
  //
  // Always starts `false`, even though hydration may already be complete
  // by the time this runs -- the effect below checks that immediately.
  // Reading `useAuthStore.persist` during the render itself (rather than
  // only inside an effect) crashes Next.js's server-side prerendering:
  // this component still renders once on the server to produce the
  // initial HTML, where there is no localStorage and the persist
  // middleware's `.persist` API isn't available at all.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    if (useAuthStore.persist.hasHydrated()) { setHydrated(true); return; }
    return useAuthStore.persist.onFinishHydration(() => setHydrated(true));
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const { accessToken, clearAuth, setAuth } = useAuthStore.getState();
    if (!accessToken) return;

    authApi.me()
      .then((res) => { if (res.data) setAuth(res.data, accessToken); })
      .catch(() => {
        // /auth/me failing doesn't necessarily mean the account is
        // suspended -- the access token itself may have simply expired
        // (it's short-lived by design). Try a silent refresh before
        // giving up; if the account really is suspended/deleted, the
        // refresh endpoint applies the exact same DB check and fails too,
        // which the branch below (and api.ts's own global handling of the
        // ACCOUNT_SUSPENDED/ACCOUNT_INACTIVE error code) turns into a
        // real logout either way.
        authApi.refresh()
          .then((res) => {
            const current = useAuthStore.getState().user;
            if (res.data?.accessToken && current) {
              useAuthStore.getState().setAuth(current, res.data.accessToken);
            } else {
              clearAuth();
            }
          })
          .catch(() => clearAuth());
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

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
