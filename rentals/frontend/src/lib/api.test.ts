/**
 * Regression coverage for forcing an immediate, consistent logout the
 * moment the backend signals a suspended/deactivated account -- on ANY
 * endpoint, not just /auth/me. Previously each caller handled its own
 * request failure independently (usually just a toast), so a banned
 * user's *other* API calls (send a message, load a listing, etc.) would
 * fail individually while the rest of the UI -- navbar, cached pages --
 * kept showing them as logged in, since nothing ever cleared the store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { disconnectSocketMock } = vi.hoisted(() => ({ disconnectSocketMock: vi.fn() }));
vi.mock('@/lib/socket', () => ({ disconnectSocket: disconnectSocketMock }));

import { api } from './api';
import { useAuthStore } from '@/store/authStore';

function jsonResponse(status: number, body: any): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

beforeEach(() => {
  disconnectSocketMock.mockReset();
  useAuthStore.setState({ user: { id: 'u1', name: 'Test', role: 'USER' } as any, accessToken: 'tok-abc', isLoading: false });
  vi.stubGlobal('fetch', vi.fn());
});

describe('api.request(): a machine-readable suspension code forces a full logout regardless of which endpoint returned it', () => {
  it('clears the session and disconnects the socket on ACCOUNT_SUSPENDED from an arbitrary (non-auth) endpoint', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(403, {
      success: false,
      message: 'Your account has been suspended. Contact support@muslimrentals.ca',
      code: 'ACCOUNT_SUSPENDED',
    }));

    await expect(api.get('/messages/unread-count')).rejects.toThrow(/suspended/i);

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(disconnectSocketMock).toHaveBeenCalledTimes(1);
  });

  it('also triggers on ACCOUNT_INACTIVE (a deleted/deactivated account), same as ACCOUNT_SUSPENDED', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(401, {
      success: false,
      message: 'Account not found or inactive.',
      code: 'ACCOUNT_INACTIVE',
    }));

    await expect(api.get('/listings')).rejects.toThrow();

    expect(useAuthStore.getState().user).toBeNull();
    expect(disconnectSocketMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT clear the session for an ordinary 403 that carries no suspension code (e.g. an authorization/ownership failure)', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(403, {
      success: false,
      message: 'Not authorized.',
    }));

    await expect(api.delete('/listings/not-mine')).rejects.toThrow('Not authorized.');

    // A real, unrelated 403 must never look like a global logout signal.
    expect(useAuthStore.getState().user).not.toBeNull();
    expect(useAuthStore.getState().accessToken).not.toBeNull();
    expect(disconnectSocketMock).not.toHaveBeenCalled();
  });

  it('does not force a logout for ACCOUNT_SUSPENDED returned from a public auth endpoint (e.g. a banned account failing to log in) -- there is no session to tear down, and the login form already shows this message inline', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(403, {
      success: false,
      message: 'Account suspended. Contact support@muslimrentals.ca',
      code: 'ACCOUNT_SUSPENDED',
    }));

    await expect(api.post('/auth/login', { email: 'banned@example.com', password: 'x' })).rejects.toThrow(/suspended/i);

    expect(disconnectSocketMock).not.toHaveBeenCalled();
  });
});
