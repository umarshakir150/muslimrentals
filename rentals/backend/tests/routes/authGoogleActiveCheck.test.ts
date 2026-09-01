/**
 * Regression coverage for a real pre-existing gap found while building the
 * account-deletion flow (Settings milestone): POST /auth/google never
 * checked isActive/isBanned before issuing tokens, unlike /login and
 * /refresh, which both do. Without this, a deleted (isActive: false) or
 * banned account could still mint a fresh session via Google, since
 * googleId/email survive account deletion by design (anonymization, not a
 * hard row delete -- see users.ts's DELETE /users/me).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';

const findFirstMock = vi.fn();
const createMock    = vi.fn();
const updateMock     = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user: {
      findFirst: (...args: any[]) => findFirstMock(...args),
      create:    (...args: any[]) => createMock(...args),
      update:    (...args: any[]) => updateMock(...args),
    },
  },
}));

const verifyIdTokenMock = vi.fn();
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdTokenMock;
  },
}));

vi.mock('../../src/utils/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  welcomeEmail: vi.fn(() => '<html></html>'),
  passwordResetEmail: vi.fn(() => '<html></html>'),
  emailChangeVerificationEmail: vi.fn(() => '<html></html>'),
}));

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

beforeEach(() => {
  findFirstMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  verifyIdTokenMock.mockReset();
  verifyIdTokenMock.mockResolvedValue({
    getPayload: () => ({ sub: 'google-sub-123', email: 'u@example.com', name: 'Test User', picture: 'https://google.example/pic.jpg' }),
  });
});

describe('POST /auth/google active/banned guard', () => {
  it('rejects a deleted (isActive: false) existing account rather than issuing tokens', async () => {
    findFirstMock.mockResolvedValue({
      id: 'user-1', name: 'Deleted user', email: 'deleted-user-1@deleted.invalid',
      role: 'USER', avatarUrl: null, createdAt: new Date(), isActive: false, isBanned: false,
    });

    const app = await buildApp();
    const res = await request(app).post('/api/v1/auth/google').send({ credential: 'fake-credential' });

    expect(res.status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects a banned existing account rather than issuing tokens', async () => {
    findFirstMock.mockResolvedValue({
      id: 'user-1', name: 'Test User', email: 'u@example.com',
      role: 'USER', avatarUrl: null, createdAt: new Date(), isActive: true, isBanned: true,
    });

    const app = await buildApp();
    const res = await request(app).post('/api/v1/auth/google').send({ credential: 'fake-credential' });

    expect(res.status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('still allows a normal active account through, unchanged behavior', async () => {
    findFirstMock.mockResolvedValue({
      id: 'user-1', name: 'Test User', email: 'u@example.com',
      role: 'USER', avatarUrl: null, createdAt: new Date(), isActive: true, isBanned: false,
    });
    updateMock.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app).post('/api/v1/auth/google').send({ credential: 'fake-credential' });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });
});
