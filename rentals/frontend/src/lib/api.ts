import { useAuthStore } from '@/store/authStore';

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

// Safe JSON parser - never crashes on HTML/non-JSON responses
async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Backend returned HTML or non-JSON (e.g. 404 page from Render)
    if (res.status === 404) return { message: 'Not found.' };
    if (res.status === 500) return { message: 'Server error. Please try again later.' };
    if (res.status === 0 || !res.ok) return { message: 'Unable to reach the server. Please check your connection.' };
    return { message: 'An unexpected error occurred.' };
  }
}

class ApiClient {
  private async refreshAccessToken(): Promise<string | null> {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
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

    let res: Response;
    try {
      res = await fetch(`${API_URL}${endpoint}`, {
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
      // Use the server's own message when it exists and is a plain string (not HTML).
      // Only override with a friendly fallback when the server message is absent/unhelpful.
      let message = data.message || 'Request failed';

      // Strip any accidental HTML that slipped through safeJson
      if (message.includes('<!DOCTYPE') || message.includes('<html')) {
        message = 'Request failed. Please try again.';
      }

      // For 401 on login specifically, give a clean unified message
      if (res.status === 401 && endpoint === '/auth/login') {
        message = data.message || 'Incorrect email or password. Please try again.';
      }

      // 409 = duplicate email on register
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
    let res: Response;
    try {
      res = await fetch(`${API_URL}${endpoint}`, {
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
      Object.entries(params).filter(([_, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => [k, String(v)])
    ).toString();
    return api.get<{ data: any[]; pagination: any }>(`/listings?${qs}`);
  },
  getById: (id: string) => api.get<{ data: any }>(`/listings/${id}`),
  create: (data: any) => api.post<{ data: any }>('/listings', data),
  update: (id: string, data: any) => api.patch<{ data: any }>(`/listings/${id}`, data),
  delete: (id: string) => api.delete(`/listings/${id}`),
  save: (id: string) => api.post<{ success: boolean; saved: boolean }>(`/listings/${id}/save`, {}),
  report: (id: string, reason: string, description?: string) => api.post(`/listings/${id}/report`, { reason, description }),
};

// ─── Messages API ─────────────────────────────────────────────────────────────
export const messagesApi = {
  getConversations: () => api.get<{ data: any[] }>('/messages/conversations'),
  getConversation: (id: string) => api.get<{ data: any }>(`/messages/conversations/${id}`),
  startConversation: (listingId: string, body: string) => api.post<{ data: any }>('/messages/conversations', { listingId, body }),
  sendMessage: (convId: string, body: string) => api.post<{ data: any }>(`/messages/conversations/${convId}/messages`, { body }),
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
