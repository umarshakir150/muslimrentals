/**
 * Agent registry — the single place that maps a persistent role
 * (agents/*.md) to how the orchestrator is allowed to run it.
 *
 * This is deliberately data, not prose: role *instructions* still live only
 * in agents/*.md (loaded at runtime by src/context/contextBuilder.ts) so we
 * never duplicate a role prompt inside application code. What lives here is
 * the operational contract for that role — which output schema it must
 * produce, and, most importantly, its permission profile.
 *
 * Permission enforcement model (see orchestrator/README.md "Agent
 * permissions" for the full rationale): the `tools` array is a HARD
 * boundary passed to `claude --tools`. A tool not listed here is
 * architecturally unavailable to that worker process — this is what makes
 * "Designer: read only" or "QA: no implementation edits" actually true,
 * not just a prompt-level suggestion. `allowedToolPatterns` /
 * `disallowedToolPatterns` further scope *within* a granted tool (mainly
 * Bash) via `claude --allowedTools` / `--disallowedTools`.
 */
import type { AgentRole } from '../types/schemas.js';
import { JsonSchemas } from '../types/schemas.js';

export type OutputSchemaName = keyof typeof JsonSchemas;

export interface PermissionProfile {
  role: AgentRole;
  /** Path to the persistent role instructions, relative to repo root. */
  roleFile: string;
  /** Hard tool allowlist — the actual security boundary. */
  tools: string[];
  /** Fine-grained allow patterns, mainly for Bash (e.g. "Bash(npm test*)"). */
  allowedToolPatterns: string[];
  /** Fine-grained deny patterns, checked even within an allowed tool. */
  disallowedToolPatterns: string[];
  /** True only for roles permitted to write application code. */
  canWriteCode: boolean;
  /** True if this role must run inside its own isolated git worktree. */
  needsWorktree: boolean;
  /** Which structured schema this role's Claude call must return. */
  outputSchema: OutputSchemaName;
  /** Artifact filename written under ai/tasks/<task-id>/. */
  artifactFilename: string;
  /** Hard per-invocation spend cap passed to `claude --max-budget-usd`. */
  maxBudgetUsd: number;
}

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];

// Bash patterns shared by the two reviewer roles that get limited Bash
// access (QA, Security): non-mutating inspection and test/lint runners
// only. Never git push/commit, never destructive shell commands.
const REVIEW_BASH_ALLOW = [
  'Bash(npm run test*)',
  'Bash(npm test*)',
  'Bash(npm run type-check*)',
  'Bash(npm run typecheck*)',
  'Bash(npm run lint*)',
  'Bash(npm audit*)',
  'Bash(git status*)',
  'Bash(git diff*)',
  'Bash(git log*)',
];
const DANGEROUS_BASH_DENY = [
  'Bash(git push*)',
  'Bash(git commit*)',
  'Bash(git reset*)',
  'Bash(rm *)',
  'Bash(rm)',
  'Bash(curl*)',
  'Bash(wget*)',
  'Bash(npm install*)',
  'Bash(npm publish*)',
  'Bash(sudo*)',
  'Bash(ssh*)',
  'Bash(chmod*)',
];

// Engineering additionally needs to stage/commit inside its own isolated
// worktree/branch (never push, never touch another branch).
const ENGINEERING_BASH_ALLOW = [
  ...REVIEW_BASH_ALLOW,
  'Bash(npm run build*)',
  'Bash(npm install)',
  'Bash(git add*)',
  'Bash(git commit*)',
  'Bash(git status*)',
  'Bash(git diff*)',
];
const ENGINEERING_BASH_DENY = [
  'Bash(git push*)',
  'Bash(git checkout main)',
  'Bash(git checkout master)',
  'Bash(rm -rf*)',
  'Bash(curl*)',
  'Bash(wget*)',
  'Bash(sudo*)',
  'Bash(ssh*)',
];

export const REGISTRY: Record<AgentRole, PermissionProfile> = {
  supervisor: {
    role: 'supervisor',
    roleFile: 'agents/supervisor.md',
    tools: READ_ONLY_TOOLS,
    allowedToolPatterns: [],
    disallowedToolPatterns: [],
    canWriteCode: false,
    needsWorktree: false,
    outputSchema: 'SupervisorPlan',
    artifactFilename: 'plan.json',
    maxBudgetUsd: 1.0,
  },
  designer: {
    role: 'designer',
    roleFile: 'agents/designer.md',
    tools: READ_ONLY_TOOLS,
    allowedToolPatterns: [],
    disallowedToolPatterns: [],
    canWriteCode: false,
    needsWorktree: false,
    outputSchema: 'AgentAnalysis',
    artifactFilename: 'designer.md',
    maxBudgetUsd: 0.75,
  },
  legal: {
    role: 'legal',
    roleFile: 'agents/legal.md',
    tools: READ_ONLY_TOOLS,
    allowedToolPatterns: [],
    disallowedToolPatterns: [],
    canWriteCode: false,
    needsWorktree: false,
    outputSchema: 'AgentAnalysis',
    artifactFilename: 'legal.md',
    maxBudgetUsd: 0.75,
  },
  trust_safety: {
    role: 'trust_safety',
    roleFile: 'agents/trust-safety.md',
    tools: READ_ONLY_TOOLS,
    allowedToolPatterns: [],
    disallowedToolPatterns: [],
    canWriteCode: false,
    needsWorktree: false,
    outputSchema: 'AgentAnalysis',
    artifactFilename: 'trust-safety.md',
    maxBudgetUsd: 0.75,
  },
  support: {
    role: 'support',
    roleFile: 'agents/support.md',
    tools: READ_ONLY_TOOLS,
    allowedToolPatterns: [],
    disallowedToolPatterns: [],
    canWriteCode: false,
    needsWorktree: false,
    outputSchema: 'AgentAnalysis',
    artifactFilename: 'support.md',
    maxBudgetUsd: 0.5,
  },
  qa: {
    role: 'qa',
    roleFile: 'agents/qa.md',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    allowedToolPatterns: REVIEW_BASH_ALLOW,
    disallowedToolPatterns: DANGEROUS_BASH_DENY,
    canWriteCode: false,
    needsWorktree: false,
    outputSchema: 'ReviewResult',
    artifactFilename: 'qa.json',
    maxBudgetUsd: 1.0,
  },
  security: {
    role: 'security',
    roleFile: 'agents/security.md',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    allowedToolPatterns: REVIEW_BASH_ALLOW,
    disallowedToolPatterns: DANGEROUS_BASH_DENY,
    canWriteCode: false,
    needsWorktree: false,
    outputSchema: 'ReviewResult',
    artifactFilename: 'security.json',
    maxBudgetUsd: 1.0,
  },
  engineering: {
    role: 'engineering',
    roleFile: 'agents/engineering.md',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    allowedToolPatterns: ENGINEERING_BASH_ALLOW,
    disallowedToolPatterns: ENGINEERING_BASH_DENY,
    canWriteCode: true,
    needsWorktree: true,
    outputSchema: 'ImplementationResult',
    artifactFilename: 'engineering-plan.md',
    maxBudgetUsd: 3.0,
  },
  frontend: {
    role: 'frontend',
    roleFile: 'agents/frontend.md',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    allowedToolPatterns: ENGINEERING_BASH_ALLOW,
    disallowedToolPatterns: ENGINEERING_BASH_DENY,
    canWriteCode: true,
    needsWorktree: true,
    outputSchema: 'ImplementationResult',
    artifactFilename: 'frontend-implementation.md',
    maxBudgetUsd: 3.0,
  },
  backend: {
    role: 'backend',
    roleFile: 'agents/backend.md',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    allowedToolPatterns: ENGINEERING_BASH_ALLOW,
    disallowedToolPatterns: ENGINEERING_BASH_DENY,
    canWriteCode: true,
    needsWorktree: true,
    outputSchema: 'ImplementationResult',
    artifactFilename: 'backend-implementation.md',
    maxBudgetUsd: 3.0,
  },
};

export function getProfile(role: AgentRole): PermissionProfile {
  const profile = REGISTRY[role];
  if (!profile) throw new Error(`Unknown agent role: ${role}`);
  return profile;
}

/** True for any role that is a code-writing implementer (needs a worktree). */
export function isImplementerRole(role: AgentRole): boolean {
  return getProfile(role).canWriteCode;
}

/** True for the two independent post-implementation reviewer roles. */
export function isReviewerRole(role: AgentRole): boolean {
  return role === 'qa' || role === 'security';
}
