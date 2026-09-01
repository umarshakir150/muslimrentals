/**
 * GET /auth/me now reports a computed `hasPassword` boolean (Settings needs
 * to know whether to offer password re-authentication or the Google-only
 * confirm-by-email fallback for sensitive changes) -- must never leak the
 * raw passwordHash itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const findUniqueMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: { user: { findUnique: (...args: any[]) => findUniqueMock(...args) } },
}));

function signToken(userId: string) {
  return jwt.sign({ userId, email: 'u@example.com', role: 'USER' }, process.env.JWT_SECRET!, {
    algorithm: 'HS256', expiresIn: '15m',
  });
}

async function buildApp() {
  vi.resetModules();
  const { default: authRoutes } = await import('../../src/routes/auth');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => { findUniqueMock.mockReset(); });

describe('GET /auth/me', () => {
  it('reports hasPassword: true and never leaks passwordHash for a password account', async () => {
    findUniqueMock
      .mockResolvedValueOnce({ id: USER_ID, email: 'u@example.com', role: 'USER', name: 'Test User', isActive: true, isBanned: false }) // authenticate()
      .mockResolvedValueOnce({
        id: USER_ID, name: 'Test User', email: 'u@example.com', role: 'USER', avatarUrl: null,
        phone: null, bio: null, isVerified: false, createdAt: new Date(),
        passwordHash: '$2a$12$fakehashfakehashfakehashfakehashfakehashfakeh',
      });

    const app = await buildApp();
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.hasPassword).toBe(true);
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  it('reports hasPassword: false for a Google-only account', async () => {
    findUniqueMock
      .mockResolvedValueOnce({ id: USER_ID, email: 'u@example.com', role: 'USER', name: 'Test User', isActive: true, isBanned: false })
      .mockResolvedValueOnce({
        id: USER_ID, name: 'Test User', email: 'u@example.com', role: 'USER', avatarUrl: null,
        phone: null, bio: null, isVerified: true, createdAt: new Date(), passwordHash: null,
      });

    const app = await buildApp();
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.hasPassword).toBe(false);
  });

  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});
