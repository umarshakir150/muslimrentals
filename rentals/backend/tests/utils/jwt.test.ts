import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const testUser = { id: 'user-123', email: 'jwt-test@example.com', role: 'USER' };

describe('jwt utils', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.JWT_SECRET = 'test-access-secret-at-least-32-chars-long';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars-long';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('signs and verifies an access token roundtrip', async () => {
    const { signAccessToken, verifyAccessToken } = await import('../../src/utils/jwt');
    const token = signAccessToken(testUser);
    const payload = verifyAccessToken(token);

    expect(payload.userId).toBe(testUser.id);
    expect(payload.email).toBe(testUser.email);
    expect(payload.role).toBe(testUser.role);
  });

  it('signs and verifies a refresh token roundtrip', async () => {
    const { signRefreshToken, verifyRefreshToken } = await import('../../src/utils/jwt');
    const token = signRefreshToken(testUser);
    const payload = verifyRefreshToken(token);

    expect(payload.userId).toBe(testUser.id);
  });

  it('rejects an access token verified with the refresh secret', async () => {
    const { signAccessToken, verifyRefreshToken } = await import('../../src/utils/jwt');
    const token = signAccessToken(testUser);

    expect(() => verifyRefreshToken(token)).toThrow();
  });

  it('rejects a tampered token', async () => {
    const { signAccessToken, verifyAccessToken } = await import('../../src/utils/jwt');
    const token = signAccessToken(testUser);
    const tampered = token.slice(0, -2) + (token.slice(-2) === 'aa' ? 'bb' : 'aa');

    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('rejects an already-expired token', async () => {
    vi.resetModules();
    process.env.JWT_EXPIRES_IN = '-1s';
    const { signAccessToken, verifyAccessToken } = await import('../../src/utils/jwt');
    const token = signAccessToken(testUser);

    expect(() => verifyAccessToken(token)).toThrow(/expired/i);
  });

  it('throws when JWT_SECRET is not set', async () => {
    vi.resetModules();
    delete process.env.JWT_SECRET;
    const { signAccessToken } = await import('../../src/utils/jwt');

    expect(() => signAccessToken(testUser)).toThrow(/JWT_SECRET/);
  });
});
