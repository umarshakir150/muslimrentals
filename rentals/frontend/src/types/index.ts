// ─── Auth ─────────────────────────────────────────────────────────────────────
export type UserRole = 'USER' | 'ADMIN' | 'MODERATOR';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
  phone?: string | null;
  bio?: string | null;
  isVerified?: boolean;
  createdAt: string;
  // Whether the account has a password set -- false for a Google-only
  // account. Settings uses this to decide whether to offer password
  // re-authentication or the Google-only confirm-by-email fallback for
  // sensitive changes (email change, account deletion).
  hasPassword?: boolean;
}

// ─── Listings ─────────────────────────────────────────────────────────────────
export type ListingAudience = 'BROTHERS' | 'SISTERS' | 'COUPLES' | 'FAMILIES' | 'ALL';
export type ListingStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'REMOVED' | 'BANNED';

export interface ListingImage {
  id: string;
  url: string;
  alt: string | null;
  order: number;
}

export interface Listing {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  bedrooms: number;
  bathrooms: number;
  audience: ListingAudience;
  city: string;
  town?: string | null;
  province?: string | null;
  neighbourhood?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
  contactInfo: string;
  status: ListingStatus;
  isActive: boolean;
  isFeatured: boolean;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  images: ListingImage[];
  amenities: string[];
  thumbnailUrl?: string | null;
  user: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  isSaved?: boolean;
  _count?: { savedBy: number };
}

export interface ListingFilters {
  keyword?: string;
  city?: string;
  audience?: ListingAudience | 'all';
  minBeds?: number;
  maxPrice?: number;
  minBaths?: number;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  furnished?: boolean;
  parking?: boolean;
  utilities?: boolean;
  sort?: 'newest' | 'priceLow' | 'priceHigh' | 'beds';
  page?: number;
}



// ─── Messages ─────────────────────────────────────────────────────────────────
export interface Message {
  id: string;
  conversationId: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  sender: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
}

export interface Conversation {
  id: string;
  createdAt: string;
  updatedAt: string;
  listing: {
    id: string;
    title: string;
    price: number;
    city: string;
    audience: ListingAudience;
    images: ListingImage[];
  };
  participants: {
    userId: string;
    user: { id: string; name: string; avatarUrl: string | null };
  }[];
  messages: Message[];
  unreadCount?: number;
}

// ─── Cities ───────────────────────────────────────────────────────────────────
export interface City {
  id?: string;
  name: string;
  province: string;
  lat?: number | null;
  lng?: number | null;
}

// ─── API ──────────────────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ApiError {
  success: false;
  message: string;
  errors?: { field: string; message: string }[];
}

// ─── Notifications ────────────────────────────────────────────────────────────
export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  data?: Record<string, unknown>;
  createdAt: string;
}
