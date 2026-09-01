/**
 * Regression coverage for POST /auth/forgot-password and POST /auth/reset-password.
 *
 * Covers the properties these routes are relied on for: anti-enumeration
 * (forgot-password's response never reveals whether the email has an
 * account), single-use expiring reset tokens, and forced logout of every
 * existing session on a successful reset. Prisma and email sending are
 * mocked -- there is no test database wired up in this repo yet (see
 * usersSettings.test.ts for the same established pattern this file follows).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';
process.env.FRONTEND_URL = 'https://muslimrentals.netlify.app';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const findUniqueMock = vi.fn();
const findFirstMock  = vi.fn();
const updateMock     = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => findUniqueMock(...args),
      findFirst:  (...args: any[]) => findFirstMock(...args),
      update:     (...args: any[]) => updateMock(...args),
    },
  },
}));

const sendEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/utils/email', () => ({
  sendEmail: (...args: any[]) => sendEmailMock(...args),
  passwordResetEmail:     vi.fn(() => '<html></html>'),
  passwordResetEmailText: vi.fn(() => 'text'),
  welcomeEmail:     vi.fn(() => '<html></html>'),
  welcomeEmailText: vi.fn(() => 'text'),
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
  findUniqueMock.mockReset();
  findFirstMock.mockReset();
  updateMock.mockReset();
  sendEmailMock.mockClear();
});

describe('POST /auth/forgot-password', () => {
  it('returns the same success response whether or not the account exists (anti-enumeration)', async () => {
    findUniqueMock.mockResolvedValueOnce(null); // no account for this email
    const app = await buildApp();
    const resNoAccount = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' });

    findUniqueMock.mockReset();
    findUniqueMock.mockResolvedValueOnce({ id: USER_ID, name: 'Test User', email: 'real@example.com' });
    updateMock.mockResolvedValueOnce({});
    const app2 = await buildApp();
    const resRealAccount = await request(app2).post('/api/v1/auth/forgot-password').send({ email: 'real@example.com' });

    expect(resNoAccount.status).toBe(200);
    expect(resRealAccount.status).toBe(200);
    expect(resNoAccount.body).toEqual(resRealAccount.body);
  });

  it('does not touch the database or send an email when no account matches', async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    const app = await buildApp();
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('generates a fresh expiring reset token, saves it, and emails a reset link to the account', async () => {
    findUniqueMock.mockResolvedValueOnce({ id: USER_ID, name: 'Test User', email: 'real@example.com' });
    updateMock.mockResolvedValueOnce({});

    const app = await buildApp();
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'real@example.com' });

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const [{ where, data }] = updateMock.mock.calls[0];
    expect(where).toEqual({ id: USER_ID });
    expect(data.resetToken).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex-encoded
    expect(data.resetTokenExpiry.getTime()).toBeGreaterThan(Date.now());
    expect(data.resetTokenExpiry.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000 + 1000);

    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'real@example.com' }));
  });

  it('still returns the safe success response even when email delivery fails (SMTP not configured)', async () => {
    findUniqueMock.mockResolvedValueOnce({ id: USER_ID, name: 'Test User', email: 'real@example.com' });
    updateMock.mockResolvedValueOnce({});
    sendEmailMock.mockRejectedValueOnce(new Error('SMTP not configured'));

    const app = await buildApp();
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'real@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('If an account exists, a reset link has been sent.');
  });

  it('rejects a malformed email before any DB lookup', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'not-an-email' });

    expect(res.status).toBe(422); // Zod validation failure
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

describe('POST /auth/reset-password', () => {
  it('rejects an invalid or expired token', async () => {
    findFirstMock.mockResolvedValueOnce(null); // no matching, unexpired token

    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'x'.repeat(64), password: 'newpassword123' });

    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects a token that has already been used once (single-use)', async () => {
    // After a successful reset, resetToken is cleared -- a second attempt
    // with the same token now finds no matching row, exactly like an
    // invalid token. Simulated directly since Prisma is mocked.
    findFirstMock.mockResolvedValueOnce(null);

    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'x'.repeat(64), password: 'newpassword123' });

    expect(res.status).toBe(400);
  });

  it('on a valid token: hashes the new password, clears the token and refreshToken, and clears the session cookie', async () => {
    findFirstMock.mockResolvedValueOnce({ id: USER_ID, email: 'real@example.com' });
    updateMock.mockResolvedValueOnce({});

    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'x'.repeat(64), password: 'newpassword123' });

    expect(res.status).toBe(200);
    const [{ where, data }] = updateMock.mock.calls[0];
    expect(where).toEqual({ id: USER_ID });
    expect(data.passwordHash).not.toBe('newpassword123'); // hashed, not stored raw
    expect(data.resetToken).toBeNull();
    expect(data.resetTokenExpiry).toBeNull();
    expect(data.refreshToken).toBeNull(); // forces logout of every existing session

    const setCookie = res.headers['set-cookie']?.join(';') || '';
    expect(setCookie).toMatch(/refreshToken=;/);
  });

  it('rejects a password shorter than 8 characters before any DB lookup', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'x'.repeat(64), password: 'short' });

    expect(res.status).toBe(422); // Zod validation failure
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});
