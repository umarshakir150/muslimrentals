import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { sanitizeInputs, preventHpp } from '../../src/middleware/sanitize';

function runSanitize(body: Record<string, unknown>) {
  const req = { body, query: {}, params: {} } as unknown as Request;
  const next = vi.fn() as NextFunction;
  sanitizeInputs(req, {} as Response, next);
  return req.body as Record<string, unknown>;
}

describe('sanitizeInputs', () => {
  it('strips <script> tags from string values', () => {
    const out = runSanitize({ bio: 'hello <script>alert(1)</script> world' });
    expect(out.bio).toBe('hello  world');
  });

  it('strips inline event-handler attributes', () => {
    const out = runSanitize({ bio: '<img src=x onerror="alert(1)">' });
    expect(out.bio).not.toMatch(/onerror/i);
  });

  it('drops __proto__, constructor, and prototype keys (prototype-pollution defense)', () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "constructor": "x", "prototype": "y", "name": "ok"}');
    const out = runSanitize(malicious);

    expect(out.name).toBe('ok');
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'prototype')).toBe(false);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('trims leading/trailing whitespace', () => {
    const out = runSanitize({ name: '   Ahmad   ' });
    expect(out.name).toBe('Ahmad');
  });

  it('recurses into nested objects and arrays', () => {
    const out = runSanitize({
      nested: { bio: '<script>x</script>clean' },
      list: ['<b>bold</b>', 'plain'],
    });
    expect((out.nested as any).bio).toBe('clean');
    expect((out.list as string[])[0]).toBe('bold');
    expect((out.list as string[])[1]).toBe('plain');
  });

  it('leaves non-string values (numbers, booleans, null) untouched', () => {
    const out = runSanitize({ price: 1500, furnished: true, notes: null });
    expect(out.price).toBe(1500);
    expect(out.furnished).toBe(true);
    expect(out.notes).toBeNull();
  });

  it('calls next() after sanitizing', () => {
    const next = vi.fn() as NextFunction;
    const req = { body: { a: '1' }, query: {}, params: {} } as unknown as Request;
    sanitizeInputs(req, {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('preventHpp', () => {
  it('keeps only the last value of a duplicated query parameter', () => {
    const req = { query: { sort: ['asc', 'desc'] } } as unknown as Request;
    const next = vi.fn() as NextFunction;
    preventHpp(req, {} as Response, next);

    expect(req.query.sort).toBe('desc');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('leaves single-value query params unchanged', () => {
    const req = { query: { city: 'Toronto' } } as unknown as Request;
    const next = vi.fn() as NextFunction;
    preventHpp(req, {} as Response, next);

    expect(req.query.city).toBe('Toronto');
  });
});
