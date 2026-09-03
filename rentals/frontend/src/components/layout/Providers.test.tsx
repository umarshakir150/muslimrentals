/**
 * Root-cause regression coverage for a founder-reported bug: banning a
 * user from admin, then refreshing the banned user's own page, left them
 * looking fully logged in. Render's request logs proved GET /auth/me and
 * POST /auth/refresh were never even being called on page load -- the
 * session-revalidation effect below was silently skipped every time.
 *
 * Cause: the auth store persists to localStorage and rehydrates it
 * asynchronously (a Zustand persist-middleware detail, not something the
 * component ever awaited). AuthInitializer's effect had an empty
 * dependency array, so it ran exactly once, immediately after the first
 * render -- which always sees the store's pre-hydration default
 * (accessToken: null), since real hydration finishes moments later. The
 * check that's supposed to catch a mid-session ban was effectively dead
 * code. Fixed by waiting for the persist middleware's own
 * hydration-finished signal before running it, with the real token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const { meMock, refreshMock } = vi.hoisted(() => ({ meMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock('@/lib/api', () => ({ authApi: { me: meMock, refresh: refreshMock } }));

function persistAuth(user: any, accessToken: string) {
  localStorage.setItem('muslim-auth', JSON.stringify({ state: { user, accessToken }, version: 0 }));
}

beforeEach(() => {
  localStorage.clear();
  meMock.mockReset();
  refreshMock.mockReset();
  vi.resetModules();
});

async function renderProviders() {
  const { Providers } = await import('./Providers');
  return render(<Providers><div>app content</div></Providers>);
}

describe('AuthInitializer: validates the persisted session once hydration actually completes', () => {
  it('calls authApi.me() with the real persisted access token -- not the pre-hydration null the very first render sees', async () => {
    persistAuth({ id: 'u1', name: 'Test', role: 'USER' }, 'persisted-token-abc');
    meMock.mockResolvedValue({ data: { id: 'u1', name: 'Test', role: 'USER' } });

    await renderProviders();

    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(1));
  });

  it('does nothing when there is no persisted session (never calls me() or refresh())', async () => {
    await renderProviders();
    // No persisted token to validate -- give any (incorrect) async call a
    // moment to have fired before asserting it didn't.
    await new Promise((r) => setTimeout(r, 30));
    expect(meMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('a banned/suspended account: /auth/me fails, refresh also fails, and the session is fully cleared', async () => {
    persistAuth({ id: 'u1', name: 'Test', role: 'USER' }, 'stale-token');
    const suspended: any = new Error('Your account has been suspended.');
    suspended.status = 403;
    meMock.mockRejectedValue(suspended);
    const refreshFailed: any = new Error('Account suspended.');
    refreshFailed.status = 403;
    refreshMock.mockRejectedValue(refreshFailed);

    await renderProviders();

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    const { useAuthStore } = await import('@/store/authStore');
    await waitFor(() => expect(useAuthStore.getState().user).toBeNull());
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('a merely-expired access token: /auth/me fails but refresh succeeds, and the session continues with the new token', async () => {
    persistAuth({ id: 'u1', name: 'Test', role: 'USER' }, 'expired-token');
    meMock.mockRejectedValue(new Error('Token expired.'));
    refreshMock.mockResolvedValue({ data: { accessToken: 'fresh-token-xyz' } });

    await renderProviders();

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    const { useAuthStore } = await import('@/store/authStore');
    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('fresh-token-xyz'));
    expect(useAuthStore.getState().user).toEqual({ id: 'u1', name: 'Test', role: 'USER' });
  });
});
