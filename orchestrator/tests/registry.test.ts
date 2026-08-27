import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REGISTRY, getProfile, isImplementerRole, isReviewerRole } from '../src/agents/registry.js';
import { REPO_ROOT } from '../src/paths.js';

const READ_ONLY_ROLES = ['designer', 'legal', 'trust_safety', 'support', 'supervisor'] as const;
const REVIEW_BASH_ROLES = ['qa', 'security'] as const;
const IMPLEMENTER_ROLES = ['engineering', 'frontend', 'backend'] as const;

describe('agent registry — permission profiles', () => {
  it('every role file referenced actually exists in the repo', () => {
    for (const profile of Object.values(REGISTRY)) {
      expect(existsSync(path.join(REPO_ROOT, profile.roleFile)), profile.roleFile).toBe(true);
    }
  });

  it('read-only roles have no Write, Edit, or Bash — cannot enter implementation states', () => {
    for (const role of READ_ONLY_ROLES) {
      const profile = getProfile(role);
      expect(profile.tools, role).not.toContain('Write');
      expect(profile.tools, role).not.toContain('Edit');
      expect(profile.tools, role).not.toContain('Bash');
      expect(profile.canWriteCode, role).toBe(false);
      expect(profile.needsWorktree, role).toBe(false);
    }
  });

  it('QA and Security get Bash for tests/inspection but never Write or Edit', () => {
    for (const role of REVIEW_BASH_ROLES) {
      const profile = getProfile(role);
      expect(profile.tools, role).toContain('Bash');
      expect(profile.tools, role).not.toContain('Write');
      expect(profile.tools, role).not.toContain('Edit');
      expect(profile.canWriteCode, role).toBe(false);
      expect(profile.needsWorktree, role).toBe(false);
      expect(isReviewerRole(role)).toBe(true);
    }
  });

  it('QA and Security Bash access excludes destructive/publish commands by pattern', () => {
    for (const role of REVIEW_BASH_ROLES) {
      const profile = getProfile(role);
      const denyText = profile.disallowedToolPatterns.join(' ');
      expect(denyText).toMatch(/git push/);
      expect(denyText).toMatch(/rm /);
      expect(profile.allowedToolPatterns.join(' ')).not.toMatch(/git push/);
    }
  });

  it('implementer roles (engineering/frontend/backend) get Write/Edit/Bash and require a worktree', () => {
    for (const role of IMPLEMENTER_ROLES) {
      const profile = getProfile(role);
      expect(profile.tools, role).toContain('Write');
      expect(profile.tools, role).toContain('Edit');
      expect(profile.tools, role).toContain('Bash');
      expect(profile.canWriteCode, role).toBe(true);
      expect(profile.needsWorktree, role).toBe(true);
      expect(isImplementerRole(role)).toBe(true);
      expect(profile.disallowedToolPatterns.join(' ')).toMatch(/git push/);
    }
  });

  it('implementer roles allow-list Write and Edit by bare tool name (regression: dontAsk denies anything not explicitly allow-listed, even if present in --tools)', () => {
    // Discovered on the first real --full run: --tools granting Write/Edit
    // was NOT sufficient under --permission-mode dontAsk — every write was
    // denied because allowedToolPatterns only ever listed Bash subcommands,
    // never the bare 'Write'/'Edit' tool names. This test pins the fix.
    for (const role of IMPLEMENTER_ROLES) {
      const profile = getProfile(role);
      expect(profile.allowedToolPatterns, role).toContain('Write');
      expect(profile.allowedToolPatterns, role).toContain('Edit');
    }
  });

  it('no role is granted every tool unconditionally — each profile is deliberately scoped', () => {
    for (const [role, profile] of Object.entries(REGISTRY)) {
      expect(profile.tools.length, role).toBeGreaterThan(0);
      expect(profile.tools.length, role).toBeLessThanOrEqual(6);
    }
  });
});
