import { useAuthStore } from '@/store/authStore';

// ─── Base URL normalisation ───────────────────────────────────────────────────
// NEXT_PUBLIC_API_URL may be set as either:
//   https://xxx.onrender.com          (without /api/v1)
//   https://xxx.onrender.com/api/v1   (with /api/v1)
// We normalise to always strip the trailing /api/v1 and re-add it in request(),
// so all endpoint strings like '/auth/register' work correctly either way.
//
// If NEXT_PUBLIC_API_URL is missing entirely, falling back to an empty string
// used to send every request to a *relative* URL (e.g. '/api/v1/auth/register'),
// which silently hits this Next.js app instead of the backend and returns Next's
// own HTML 404 page - surfacing a confusing "Endpoint not found" message to users.
// In development we fall back to the documented local backend port (4000) so the
// app works out of the box; in any other environment a missing var is treated as
// a real configuration error so it fails loudly for developers/ops instead of
// silently misrouting requests.
function buildBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || '').trim().replace(/\/$/, '');
  if (raw) return raw.replace(/\/api\/v1$/, '');

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(
      '[api] NEXT_PUBLIC_API_URL is not set - falling back to http://localhost:4000 for local development.'
    );
    return 'http://localhost:4000';
  }

  // eslint-disable-next-line no-console
  console.error(
    '[api] NEXT_PUBLIC_API_URL is not configured. The app cannot reach the backend API.'
  );
  return '';
}

const BASE_URL = buildBaseUrl();

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
    // BASE_URL is only empty when NEXT_PUBLIC_API_URL is missing in a
    // non-development environment (see buildBaseUrl above). Fail fast with an
    // honest message instead of fetching a relative URL that would 404 against
    // this Next.js app itself and surface a misleading "endpoint not found" error.
    if (!BASE_URL) {
      throw new Error('Service temporarily unavailable. Please try again later.');
    }

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

    if (res.status === 401 && retry) {
      const newToken = await this.refreshAccessToken();
      if (newToken) {
        const { user } = useAuthStore.getState();
        if (user) useAuthStore.getState().setAuth(user, newToken);
        return this.request<T>(endpoint, options, false);
      } else {
        useAuthStore.getState().clearAuth();
        throw new Error('Session expired. Please log in again.');
      }
    }

    const data = await safeJson(res);

    if (!res.ok) {
      let message = data.message || 'Request failed';

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

  delete<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: 'DELETE' });
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
  create: (data: any) => api.post<{ data: any }>('/listings', data),
  update: (id: string, data: any) => api.patch<{ data: any }>(`/listings/${id}`, data),
  delete: (id: string) => api.delete(`/listings/${id}`),
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
};

// ─── Cities API ───────────────────────────────────────────────────────────────
export const citiesApi = {
  getAll: () => api.get<{ data: { name: string; province: string }[] }>('/cities/all'),
};

// ─── Users API ────────────────────────────────────────────────────────────────
export const usersApi = {
  getProfile: (id: string) => api.get<{ data: any }>(`/users/${id}`),
  updateProfile: (data: any) => api.patch('/users/me', data),
  changePassword: (data: any) => api.post('/users/me/change-password', data),
  getSaved: () => api.get<{ data: any[] }>('/users/me/saved'),
  getMyListings: () => api.get<{ data: any[] }>('/users/me/listings'),
  getNotifications: () => api.get<{ data: any[] }>('/users/me/notifications'),
};
