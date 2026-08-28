import { describe, it, expect, beforeAll } from 'vitest';

// Boundary-input coverage for the auth Zod schemas lives in
// tests/validation/authSchemas.test.ts (pure, no route wiring involved).
// This file instead confirms that importing the actual route module --
// which wires up Prisma, the Google OAuth client, and rate limiters --
// doesn't throw at load time, without ever making a DB or network call.
describe('routes/auth module', () => {
  beforeAll(() => {
    process.env.JWT_SECRET ||= 'test-access-secret-at-least-32-chars-long';
    process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-at-least-32-chars-long';
  });

  it('loads without throwing and exports an Express router', async () => {
    const mod = await import('../../src/routes/auth');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
