/**
 * Regression coverage for POST /auth/refresh once an already-logged-in
 * user is banned mid-session -- the scenario a founder test session hit
 * directly: banned a user from admin while logged in as them, refreshed
 * the page, and they were still in. Root cause was entirely client-side
 * (the frontend never actually re-validated the session on load -- see
 * Providers.test.tsx), but this proves the backend side of the contract
 * holds regardless: an already-issued refresh-token cookie stops working
 * the moment the account is banned, via two independent, overlapping
 * mechanisms -- either one alone would already be enough:
 *  1. /ban sets refreshToken: null, so the *next* refresh attempt's cookie
 *     (still the pre-ban value) no longer matches the DB row at all.
 *  2. Even in the deliberately-contrived case where the DB refreshToken
 *     still happens to match, isBanned is checked explicitly right after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const findUniqueMock = vi.fn();
const updateMock = vi.fn().mockResolvedValue({});

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => findUniqueMock(...args),
      update:     (...args: any[]) => updateMock(...args),
    },
  },
}));
vi.mock('../../src/utils/email', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

function signRefreshToken(userId: string) {
  return jwt.sign({ userId, email: 'u@example.com', role: 'USER' }, process.env.JWT_REFRESH_SECRET!, {
    algorithm: 'HS256', expiresIn: '7d',
  });
}

async function buildApp() {
  vi.resetModules();
  const { default: authRoutes } = await import('../../src/routes/auth');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/auth', authRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  findUniqueMock.mockReset();
  updateMock.mockReset().mockResolvedValue({});
});

describe('POST /auth/refresh: an already-issued refresh cookie stops working the moment the account is banned', () => {
  it('401s once the ban has nulled the stored refreshToken -- the pre-ban cookie the browser still holds no longer matches', async () => {
    const token = signRefreshToken(USER_ID);
    findUniqueMock.mockResolvedValue({
      id: USER_ID, name: 'Test', email: 'u@example.com', role: 'USER', avatarUrl: null,
      refreshToken: null, // this is exactly what /ban sets it to
      isActive: true, isBanned: true, createdAt: new Date(),
    });

    const app = await buildApp();
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `refreshToken=${token}`);

    expect(res.status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled(); // never rotates/reissues a token for a mismatched one
  });

  it('403s with code ACCOUNT_SUSPENDED in the contrived case where the stored token still happens to match but isBanned is true', async () => {
    const token = signRefreshToken(USER_ID);
    findUniqueMock.mockResolvedValue({
      id: USER_ID, name: 'Test', email: 'u@example.com', role: 'USER', avatarUrl: null,
      refreshToken: token,
      isActive: true, isBanned: true, createdAt: new Date(),
    });

    const app = await buildApp();
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `refreshToken=${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('still works normally for an active, non-banned account (control case, unaffected)', async () => {
    const token = signRefreshToken(USER_ID);
    findUniqueMock.mockResolvedValue({
      id: USER_ID, name: 'Test', email: 'u@example.com', role: 'USER', avatarUrl: null,
      refreshToken: token,
      isActive: true, isBanned: false, createdAt: new Date(),
    });

    const app = await buildApp();
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `refreshToken=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });
});
