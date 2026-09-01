import { describe, it, expect } from 'vitest';
import { makeNetlifyPreviewOriginMatcher, makeOriginChecker } from '../../src/utils/corsOrigins';

// Root cause of the real bug this guards against: the Netlify Deploy Preview
// workflow got a real preview build (deploy-preview-2--muslimrentals.netlify.app)
// that could not load listings or log in, because ALLOWED_ORIGINS on Render
// only ever contained the exact production origin -- confirmed directly from
// Render's own request logs ("CORS: origin '...' not allowed.") on
// 2026-09-01. See ai/decisions.md for the full incident.

describe('makeNetlifyPreviewOriginMatcher', () => {
  it('returns null when no configured origin is a *.netlify.app URL (e.g. local dev)', () => {
    const matcher = makeNetlifyPreviewOriginMatcher(['http://localhost:3000']);
    expect(matcher).toBeNull();
  });

  it('returns null for an empty configured-origins list', () => {
    expect(makeNetlifyPreviewOriginMatcher([])).toBeNull();
  });

  it('matches a real Deploy Preview origin of the same site', () => {
    const matcher = makeNetlifyPreviewOriginMatcher(['https://muslimrentals.netlify.app']);
    expect(matcher).not.toBeNull();
    expect(matcher!('https://deploy-preview-2--muslimrentals.netlify.app')).toBe(true);
    expect(matcher!('https://deploy-preview-137--muslimrentals.netlify.app')).toBe(true);
  });

  it('matches a branch-deploy origin of the same site', () => {
    const matcher = makeNetlifyPreviewOriginMatcher(['https://muslimrentals.netlify.app']);
    expect(matcher!('https://some-feature-branch--muslimrentals.netlify.app')).toBe(true);
  });

  it('matches a raw deploy-permalink origin of the same site', () => {
    const matcher = makeNetlifyPreviewOriginMatcher(['https://muslimrentals.netlify.app']);
    expect(matcher!('https://6a96210931812a4ea2191cc0--muslimrentals.netlify.app')).toBe(true);
  });

  it('does NOT match a different, unrelated Netlify site (never widens trust beyond this one site)', () => {
    const matcher = makeNetlifyPreviewOriginMatcher(['https://muslimrentals.netlify.app']);
    expect(matcher!('https://deploy-preview-2--some-other-app.netlify.app')).toBe(false);
    expect(matcher!('https://attacker-site.netlify.app')).toBe(false);
  });

  it('does NOT match the bare production origin itself (that is handled by the exact-match allowlist, not this)', () => {
    const matcher = makeNetlifyPreviewOriginMatcher(['https://muslimrentals.netlify.app']);
    expect(matcher!('https://muslimrentals.netlify.app')).toBe(false);
  });

  it('does NOT match a non-Netlify origin, even if suffixed similarly', () => {
    const matcher = makeNetlifyPreviewOriginMatcher(['https://muslimrentals.netlify.app']);
    expect(matcher!('https://deploy-preview-2--muslimrentals.netlify.app.evil.com')).toBe(false);
    expect(matcher!('http://deploy-preview-2--muslimrentals.netlify.app')).toBe(false); // http, not https
  });
});

describe('makeOriginChecker', () => {
  it('allows the exact configured production origin', () => {
    const isAllowed = makeOriginChecker(['https://muslimrentals.netlify.app']);
    expect(isAllowed('https://muslimrentals.netlify.app')).toBe(true);
  });

  it('allows a real Deploy Preview origin of the configured site (the actual regression this fixes)', () => {
    const isAllowed = makeOriginChecker(['https://muslimrentals.netlify.app']);
    expect(isAllowed('https://deploy-preview-2--muslimrentals.netlify.app')).toBe(true);
  });

  it('rejects an origin that is neither the configured origin nor a preview of it', () => {
    const isAllowed = makeOriginChecker(['https://muslimrentals.netlify.app']);
    expect(isAllowed('https://evil.example.com')).toBe(false);
  });

  it('supports multiple configured origins (e.g. local dev alongside production)', () => {
    const isAllowed = makeOriginChecker(['http://localhost:3000', 'https://muslimrentals.netlify.app']);
    expect(isAllowed('http://localhost:3000')).toBe(true);
    expect(isAllowed('https://deploy-preview-9--muslimrentals.netlify.app')).toBe(true);
    expect(isAllowed('http://localhost:4000')).toBe(false);
  });
});
