import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateFounderGate, parseFounderAuthorityBullets, FOUNDER_GATE_CATEGORIES } from '../src/approval/founderGate.js';
import { CLAUDE_MD } from '../src/paths.js';

const realClaudeMd = readFileSync(CLAUDE_MD, 'utf8');

describe('founderGate', () => {
  it('parses the founder-authority bullet list out of the real CLAUDE.md', () => {
    const bullets = parseFounderAuthorityBullets(realClaudeMd);
    expect(bullets.length).toBeGreaterThanOrEqual(FOUNDER_GATE_CATEGORIES.length);
  });

  it('every built-in gate category still matches a real bullet in CLAUDE.md (catches silent drift)', () => {
    const bullets = parseFounderAuthorityBullets(realClaudeMd).map((b) => b.toLowerCase());
    for (const category of FOUNDER_GATE_CATEGORIES) {
      const found = bullets.some((b) => b.includes(category.bulletSubstring.toLowerCase()));
      expect(found, `expected a CLAUDE.md bullet containing "${category.bulletSubstring}"`).toBe(true);
    }
  });

  it('flags production deployment language', () => {
    const result = evaluateFounderGate('Deploy the new listing filter to production', realClaudeMd);
    expect(result.required).toBe(true);
    expect(result.reasons.join(' ')).toMatch(/production deployment/i);
  });

  it('flags permanent bans', () => {
    const result = evaluateFounderGate('Permanently ban this user for repeated scam listings', realClaudeMd);
    expect(result.required).toBe(true);
    expect(result.reasons.join(' ')).toMatch(/permanent account bans/i);
  });

  it('flags production data deletion', () => {
    const result = evaluateFounderGate('Delete all production user data for the closed accounts', realClaudeMd);
    expect(result.required).toBe(true);
  });

  it('flags publishing legal policy', () => {
    const result = evaluateFounderGate('Publish the updated Terms of Service page', realClaudeMd);
    expect(result.required).toBe(true);
    expect(result.reasons.join(' ')).toMatch(/legal polic/i);
  });

  it('flags spending money', () => {
    const result = evaluateFounderGate('Set up a paid subscription billing plan for premium listings', realClaudeMd);
    expect(result.required).toBe(true);
  });

  it('flags major auth/security rewrites', () => {
    const result = evaluateFounderGate('Rewrite the authentication system to use passkeys instead of JWTs', realClaudeMd);
    expect(result.required).toBe(true);
  });

  it('does NOT flag an ordinary, low-risk feature request', () => {
    const result = evaluateFounderGate('Add the ability for users to report roommate profiles', realClaudeMd);
    expect(result.required).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('does NOT flag routine UI/copy work', () => {
    const result = evaluateFounderGate('Add a loading spinner to the listing filters panel', realClaudeMd);
    expect(result.required).toBe(false);
  });
});
