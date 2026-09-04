import { useAuthStore } from '@/store/authStore';
import { disconnectSocket } from '@/lib/socket';

// ─── Base URL normalisation ───────────────────────────────────────────────────
// NEXT_PUBLIC_API_URL may be set as either:
//   https://xxx.onrender.com          (without /api/v1)
//   https://xxx.onrender.com/api/v1   (with /api/v1)
// We normalise to always strip the trailing /api/v1 and re-add it in request(),
// so all endpoint strings like '/auth/register' work correctly either way.
function buildBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
  // If the env var already ends with /api/v1 (or /api/v1/), strip it -
  // request() will prepend /api/v1 itself.
  return raw.replace(/\/api\/v1$/, '');
}

const BASE_URL = buildBaseUrl();

// Endpoints where a 401 means "invalid credentials/token", never "your
// session expired" -- none of these require an existing session, so a 401
// from them must never trigger the refresh-and-retry flow below (that flow
// always fails for these since there was no valid session to begin with,
// which previously surfaced as a misleading "Session expired" message on a
// simple wrong-password login attempt).
const PUBLIC_AUTH_ENDPOINTS = new Set([
  '/auth/register',
  '/auth/login',
  '/auth/google',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

// Tears down the client-side session completely and sends the user
// somewhere that will show them as logged out -- used both when a 401
// couldn't be silently refreshed (token expired/invalid, or the account
// went inactive) and when any response carries an explicit
// ACCOUNT_SUSPENDED/ACCOUNT_INACTIVE code. A full navigation (rather than
// relying on whichever component happens to be mounted to notice the
// store changed) guarantees every page's UI actually reflects the logout,
// not just the ones that happen to re-render.
function forceLogoutAndRedirect() {
  useAuthStore.getState().clearAuth();
  disconnectSocket();
  if (typeof window !== 'undefined') window.location.href = '/';
}

// ─── Safe JSON parser ─────────────────────────────────────────────────────────
// Never crashes on HTML/non-JSON responses (e.g. Render cold-start page, 404 HTML).
async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    // Backend returned HTML or plain text - build a clean message from status
    if (res.status === 404) return { message: 'Endpoint not found. Please contact support if this persists.' };
    if (res.status === 500) return { message: 'Server error. Please try again later.' };
    if (res.status === 503) return { message: 'Service temporarily unavailable. Please try again.' };
    return { message: `Request failed (${res.status}). Please try again.` };
  }
}

class ApiClient {
  private async refreshAccessToken(): Promise<string | null> {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await safeJson(res);
      return data.data?.accessToken || null;
    } catch {
      return null;
    }
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retry = true
  ): Promise<T> {
    const { accessToken } = useAuthStore.getState();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    // Always build URL as BASE_URL + /api/v1 + endpoint
    // e.g. https://xxx.onrender.com + /api/v1 + /auth/register
    const url = `${BASE_URL}/api/v1${endpoint}`;

    let res: Response;
    try {
      res = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });
    } catch {
      throw new Error('Unable to reach the server. Please check your connection.');
    }

    if (res.status === 401 && retry && !PUBLIC_AUTH_ENDPOINTS.has(endpoint)) {
      const newToken = await this.refreshAccessToken();
      if (newToken) {
        const { user } = useAuthStore.getState();
        if (user) useAuthStore.getState().setAuth(user, newToken);
        return this.request<T>(endpoint, options, false);
      } else {
        forceLogoutAndRedirect();
        throw new Error('Session expired. Please log in again.');
      }
    }

    const data = await safeJson(res);

    if (!res.ok) {
      let message = data.message || 'Request failed';

      // The backend flags an account that can no longer be used at all
      // (banned or deactivated) with a machine-readable code, on ANY
      // endpoint that happens to hit the check first -- not just /auth/me.
      // Force a full, consistent logout right here rather than leaving it
      // to each individual caller to notice and react (most don't; they
      // just show their own generic error toast and leave the stale
      // logged-in UI in place). Skipped for the public auth endpoints: a
      // banned account failing to log IN isn't an active session to tear
      // down, and forcibly navigating away from the login form on top of
      // the inline error it already shows would just be a confusing extra
      // redirect.
      if ((data.code === 'ACCOUNT_SUSPENDED' || data.code === 'ACCOUNT_INACTIVE') && !PUBLIC_AUTH_ENDPOINTS.has(endpoint)) {
        forceLogoutAndRedirect();
      }

      // Sanitise - never expose raw HTML to users
      if (message.includes('<!DOCTYPE') || message.includes('<html')) {
        message = 'Request failed. Please try again.';
      }

      // 401 on login: backend already sends "Invalid email or password."
      if (res.status === 401 && endpoint === '/auth/login') {
        message = data.message || 'Incorrect email or password.';
      }

      // 409 on register: duplicate email
      if (res.status === 409) {
        message = data.message || 'An account with this email already exists. Please log in.';
      }

      const error = new Error(message);
      (error as any).status = res.status;
      (error as any).errors = data.errors;
      throw error;
    }

    return data;
  }

  get<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  post<T>(endpoint: string, body: unknown) {
    return this.request<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });
  }

  patch<T>(endpoint: string, body: unknown) {
    return this.request<T>(endpoint, { method: 'PATCH', body: JSON.stringify(body) });
  }

  delete<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, {
      method: 'DELETE',
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }

  async upload<T>(endpoint: string, formData: FormData): Promise<T> {
    const { accessToken } = useAuthStore.getState();
    const url = `${BASE_URL}/api/v1${endpoint}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        body: formData,
        credentials: 'include',
      });
    } catch {
      throw new Error('Unable to reach the server.');
    }
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.message || 'Upload failed');
    return data;
  }
}

export const api = new ApiClient();

// ─── Auth API ─────────────────────────────────────────────────────────────────
export const authApi = {
  register: (data: { name: string; email: string; password: string }) =>
    api.post<{ data: { user: any; accessToken: string } }>('/auth/register', data),

  login: (data: { email: string; password: string }) =>
    api.post<{ data: { user: any; accessToken: string } }>('/auth/login', data),

  googleAuth: (credential: string) =>
    api.post<{ data: { user: any; accessToken: string } }>('/auth/google', { credential }),

  logout: () => api.post('/auth/logout', {}),
  me: () => api.get<{ data: any }>('/auth/me'),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => api.post('/auth/reset-password', { token, password }),
  refresh: () => api.post<{ data: { accessToken: string } }>('/auth/refresh', {}),
};

// Every create/update call with an address comes back this way first,
// regardless of how confident the geocode match was (see routes/listings.ts's
// universal confirm-property-location flow / resolveGeocodedLocation) --
// nothing is created/updated until the landlord confirms a pin. The caller
// must show the landlord a pin centered on matchedLat/matchedLng, then
// resubmit the same payload with confirmedLat/confirmedLng added.
export interface NeedsLocationConfirmationResponse {
  success: true;
  needsLocationConfirmation: true;
  data: { matchedLat: number; matchedLng: number };
}
export type ListingWriteResponse = { data: any } | NeedsLocationConfirmationResponse;

export function needsLocationConfirmation(res: ListingWriteResponse): res is NeedsLocationConfirmationResponse {
  return (res as any)?.needsLocationConfirmation === true;
}

// ─── Listings API ─────────────────────────────────────────────────────────────
export const listingsApi = {
  getAll: (params: Record<string, string | number | boolean | undefined>) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([_, v]) => v !== undefined && v !== '' && v !== false)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return api.get<{ data: any[]; pagination: any }>(`/listings?${qs}`);
  },
  getById: (id: string) => api.get<{ data: any }>(`/listings/${id}`),
  create: (data: any) => api.post<ListingWriteResponse>('/listings', data),
  update: (id: string, data: any) => api.patch<ListingWriteResponse>(`/listings/${id}`, data),
  delete: (id: string) => api.delete(`/listings/${id}`),
  // Permanent hard-delete -- distinct from `delete` above, which is the
  // existing soft-remove (status=REMOVED, admin-reversible).
  deletePermanent: (id: string) => api.delete<{ success: boolean; message: string }>(`/listings/${id}/permanent`),
  uploadImages: (listingId: string, files: File[]) => {
    const formData = new FormData();
    files.forEach(f => formData.append('images', f));
    return api.upload<{ success: boolean; data: any[] }>(`/uploads/listing-images/${listingId}`, formData);
  },
  save: (id: string) => api.post<{ success: boolean; saved: boolean }>(`/listings/${id}/save`, {}),
  report: (id: string, reason: string, description?: string) =>
    api.post(`/listings/${id}/report`, { reason, description }),
};

// ─── Messages API ─────────────────────────────────────────────────────────────
export const messagesApi = {
  getConversations: () => api.get<{ data: any[] }>('/messages/conversations'),
  getConversation: (id: string) => api.get<{ data: any }>(`/messages/conversations/${id}`),
  startConversation: (listingId: string, body: string) =>
    api.post<{ data: any }>('/messages/conversations', { listingId, body }),
  sendMessage: (convId: string, body: string) =>
    api.post<{ data: any }>(`/messages/conversations/${convId}/messages`, { body }),
  getUnreadCount: () => api.get<{ data: { count: number } }>('/messages/unread-count'),
  report: (messageId: string, reason: string, description?: string) =>
    api.post<{ success: boolean; message: string }>(`/messages/${messageId}/report`, { reason, description }),
};

// ─── Cities API ───────────────────────────────────────────────────────────────
export const citiesApi = {
  getAll: () => api.get<{ data: { name: string; province: string }[] }>('/cities/all'),
};

// ─── Geocode API ──────────────────────────────────────────────────────────────
// Ad-hoc place/address search for the "search a location + radius" filter --
// same server-side geocoder listing creation uses, just without tying the
// result to a listing. The search text itself is never sent anywhere else
// or persisted; only the resolved lat/lng is used, client-side, to center
// the map and filter listings.
export const geocodeApi = {
  search: (q: string) => api.get<{ data: { lat: number; lng: number } }>(`/geocode?q=${encodeURIComponent(q)}`),
};

// ─── Users API ────────────────────────────────────────────────────────────────
export const usersApi = {
  getProfile: (id: string) => api.get<{ data: any }>(`/users/${id}`),
  updateProfile: (data: any) => api.patch<{ data: any }>('/users/me', data),
  changePassword: (data: any) => api.post('/users/me/change-password', data),
  getSaved: () => api.get<{ data: any[] }>('/users/me/saved'),
  getMyListings: () => api.get<{ data: any[] }>('/users/me/listings'),
  getNotifications: () => api.get<{ data: any[] }>('/users/me/notifications'),
  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.upload<{ success: boolean; data: { url: string } }>('/uploads/avatar', formData);
  },
  removeAvatar: () => api.delete<{ success: boolean; message: string }>('/users/me/avatar'),
  requestEmailChange: (newEmail: string, currentPassword?: string) =>
    api.post<{ success: boolean; message: string }>('/users/me/email-change-request', { newEmail, currentPassword }),
  confirmEmailChange: (token: string) =>
    api.post<{ success: boolean; data: any; message: string }>('/users/me/email-change-confirm', { token }),
  deleteAccount: (data: { currentPassword?: string; confirmEmail?: string }) =>
    api.delete<{ success: boolean; message: string }>('/users/me', data),
  report: (userId: string, reason: string, description?: string) =>
    api.post<{ success: boolean; message: string }>(`/users/${userId}/report`, { reason, description }),
};
