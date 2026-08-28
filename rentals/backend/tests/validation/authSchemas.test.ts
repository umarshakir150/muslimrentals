import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema, resetSchema } from '../../src/validation/authSchemas';

describe('registerSchema', () => {
  it('accepts a valid registration payload', () => {
    const result = registerSchema.safeParse({ name: 'Ahmad Khan', email: 'ahmad@example.com', password: 'password123' });
    expect(result.success).toBe(true);
  });

  it('rejects a password shorter than 8 characters', () => {
    const result = registerSchema.safeParse({ name: 'Ahmad Khan', email: 'ahmad@example.com', password: 'short1' });
    expect(result.success).toBe(false);
  });

  it('accepts a password at exactly the 8-character minimum', () => {
    const result = registerSchema.safeParse({ name: 'Ahmad Khan', email: 'ahmad@example.com', password: 'exactly8' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email format', () => {
    const result = registerSchema.safeParse({ name: 'Ahmad Khan', email: 'not-an-email', password: 'password123' });
    expect(result.success).toBe(false);
  });

  it('rejects a name of a single character (below the 2-char minimum)', () => {
    const result = registerSchema.safeParse({ name: 'A', email: 'ahmad@example.com', password: 'password123' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields (mass-assignment defense)', () => {
    const result = registerSchema.safeParse({
      name: 'Ahmad Khan', email: 'ahmad@example.com', password: 'password123', role: 'ADMIN',
    });
    expect(result.success).toBe(false);
  });

  it('lowercases and trims the email', () => {
    const result = registerSchema.safeParse({ name: 'Ahmad Khan', email: '  Ahmad@Example.COM  ', password: 'password123' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('ahmad@example.com');
  });
});

describe('loginSchema', () => {
  it('accepts any non-empty password (login does not re-enforce complexity)', () => {
    const result = loginSchema.safeParse({ email: 'ahmad@example.com', password: 'x' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({ email: 'ahmad@example.com', password: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing email', () => {
    const result = loginSchema.safeParse({ password: 'password123' });
    expect(result.success).toBe(false);
  });
});

describe('resetSchema', () => {
  it('accepts a 64-char hex token', () => {
    const result = resetSchema.safeParse({ token: 'a'.repeat(64), password: 'password123' });
    expect(result.success).toBe(true);
  });

  it('rejects a token that is not exactly 64 characters', () => {
    const result = resetSchema.safeParse({ token: 'a'.repeat(63), password: 'password123' });
    expect(result.success).toBe(false);
  });
});
