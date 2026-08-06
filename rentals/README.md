# ☾ Muslim Rentals

A production-grade, Muslim-focused rental platform for Canada.

**Tech Stack:** Next.js 14 · TypeScript · TailwindCSS · Express · PostgreSQL · Prisma · Socket.IO · Leaflet

---

## 🗂️ Project Structure

```
muslim-rentals/
├── frontend/          # Next.js 14 app
│   ├── src/
│   │   ├── app/           # Pages (Next.js App Router)
│   │   ├── components/    # React components
│   │   ├── lib/           # API client, socket, utils
│   │   ├── store/         # Zustand state stores
│   │   └── types/         # TypeScript types
│   └── package.json
└── backend/           # Express API
    ├── src/
    │   ├── routes/        # API route handlers
    │   ├── middleware/    # Auth, rate limiting, errors
    │   ├── utils/         # JWT, email, logger
    │   ├── socket/        # Socket.IO server
    │   └── prisma/        # Prisma client
    ├── prisma/
    │   ├── schema.prisma  # Database schema
    │   └── seed.ts        # Seed data (mosques, cities)
    └── package.json
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- (Optional) AWS S3 or Cloudflare R2 account for image uploads

### 1. Clone and install

```bash
# Install backend deps
cd backend && npm install

# Install frontend deps
cd ../frontend && npm install
```

### 2. Setup environment variables

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env with your values

# Frontend
cp frontend/.env.example frontend/.env.local
# Edit frontend/.env.local with your values
```

### 3. Setup the database

```bash
cd backend

# Create and migrate database
npx prisma db push

# Generate Prisma client
npx prisma generate

# Seed mosques and cities
npx ts-node prisma/seed.ts
```

### 4. Run development servers

```bash
# Terminal 1: Backend (port 4000)
cd backend && npm run dev

# Terminal 2: Frontend (port 3000)
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 🔑 Environment Variables

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for access tokens (min 32 chars) |
| `JWT_REFRESH_SECRET` | Secret for refresh tokens (min 32 chars) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `AWS_ACCESS_KEY_ID` | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key |
| `AWS_S3_BUCKET` | S3 bucket name |
| `S3_ENDPOINT` | Custom endpoint (for Cloudflare R2) |
| `SMTP_HOST` | SMTP server host |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `FRONTEND_URL` | Frontend URL (for CORS) |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API URL |
| `NEXT_PUBLIC_SOCKET_URL` | WebSocket server URL |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth client ID |

---

## 📡 API Reference

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/auth/register` | Create account |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/google` | Google OAuth |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/logout` | Logout |
| GET | `/api/v1/auth/me` | Get current user |
| POST | `/api/v1/auth/forgot-password` | Send reset email |
| POST | `/api/v1/auth/reset-password` | Reset password |

### Listings
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/listings` | List listings (filterable) |
| GET | `/api/v1/listings/:id` | Get listing detail |
| POST | `/api/v1/listings` | Create listing (auth) |
| PATCH | `/api/v1/listings/:id` | Update listing (auth) |
| DELETE | `/api/v1/listings/:id` | Remove listing (auth) |
| POST | `/api/v1/listings/:id/save` | Save/unsave (auth) |
| POST | `/api/v1/listings/:id/report` | Report listing (auth) |

### Messages
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/messages/conversations` | List conversations |
| GET | `/api/v1/messages/conversations/:id` | Get conversation |
| POST | `/api/v1/messages/conversations` | Start conversation |
| POST | `/api/v1/messages/conversations/:id/messages` | Send message |
| GET | `/api/v1/messages/unread-count` | Unread count |

### Query parameters for GET /listings
| Param | Type | Description |
|---|---|---|
| `city` | string | Filter by city name |
| `audience` | enum | BROTHERS, SISTERS, COUPLES, FAMILIES, ALL |
| `minBeds` | number | Minimum bedrooms (at least N) |
| `minBaths` | number | Minimum bathrooms (at least N) |
| `maxPrice` | number | Maximum monthly price |
| `lat` | number | Centre latitude for radius search |
| `lng` | number | Centre longitude |
| `radiusKm` | number | Radius in km |
| `furnished` | boolean | Furnished only |
| `parking` | boolean | Parking included |
| `utilities` | boolean | Utilities included |
| `sort` | string | newest, priceLow, priceHigh |
| `page` | number | Page number |
| `limit` | number | Results per page (max 50) |

---

## 🔌 Socket.IO Events

### Client → Server
| Event | Payload | Description |
|---|---|---|
| `conversation:join` | `conversationId` | Join a chat room |
| `conversation:leave` | `conversationId` | Leave a chat room |
| `typing:start` | `{ conversationId }` | Start typing indicator |
| `typing:stop` | `{ conversationId }` | Stop typing indicator |
| `messages:read` | `{ conversationId }` | Mark messages as read |

### Server → Client
| Event | Payload | Description |
|---|---|---|
| `message:new` | Message object | New message in conversation |
| `conversation:new` | Conversation object | New conversation started |
| `typing:start` | `{ userId, userName }` | Someone started typing |
| `typing:stop` | `{ userId }` | Someone stopped typing |
| `messages:read` | `{ userId, conversationId }` | Messages marked as read |

---

## 🗃️ Database Schema

**Tables:** User, Listing, ListingImage, ListingAmenity, SavedListing, Conversation, ConversationParticipant, Message, Mosque, ListingMosque, City, Report, Notification

See `backend/prisma/schema.prisma` for full schema.

---

## 🚢 Production Deployment

### Backend
```bash
cd backend
npm run build
npm start
```

### Frontend
```bash
cd frontend
npm run build
npm start
```

### Recommended stack
- **Backend:** Railway, Render, or DigitalOcean App Platform
- **Database:** Supabase, Railway PostgreSQL, or Neon
- **Storage:** Cloudflare R2 (cheaper than S3) or AWS S3
- **Frontend:** Vercel (zero-config for Next.js)

### Environment setup for production
1. Set `NODE_ENV=production` in backend
2. Use strong, randomly generated JWT secrets (32+ chars each)
3. Set `FRONTEND_URL` to your Vercel domain in backend env
4. Set `NEXT_PUBLIC_API_URL` to your backend URL in Vercel env

---

## 🌱 Seed Data

The seed script (`backend/prisma/seed.ts`) populates:
- **52 verified Sunni mosques** across Canada with real coordinates
- **80+ Canadian cities** with coordinates for autocomplete

Run with: `cd backend && npx ts-node prisma/seed.ts`

---

## 📦 Key Dependencies

### Backend
- `express` — HTTP server
- `prisma` — ORM + migrations
- `socket.io` — Real-time messaging
- `bcryptjs` — Password hashing
- `jsonwebtoken` — JWT auth
- `google-auth-library` — Google OAuth
- `multer-s3` — S3 image uploads
- `nodemailer` — Transactional email
- `winston` — Structured logging
- `helmet` + `express-rate-limit` — Security

### Frontend
- `next` — React framework (App Router)
- `zustand` — State management
- `swr` — Data fetching
- `leaflet` + `leaflet.markercluster` — Maps
- `framer-motion` — Animations
- `react-hook-form` + `zod` — Forms + validation
- `react-dropzone` — Image upload UX
- `socket.io-client` — Real-time chat

---

Made with 💚 for Canada's Muslim community.

*May Allah bless every home found through this platform. آمين*
