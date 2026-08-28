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

// 'LeadPlan' isn't in the execution engine's JsonSchemas (src/types/schemas.ts)
// — it's an autonomy-layer schema (src/autonomy/types.ts), kept separate on
// purpose (see ai/autonomy-architecture.md "do not conflate these layers").
// This field is informational only; nothing reads it to look up a schema at
// runtime (every real invocation references its JsonSchemas.* constant
// directly), so a plain string literal escape hatch is enough here.
export type OutputSchemaName = keyof typeof JsonSchemas | 'LeadPlan';

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

// Install/typecheck/build-verify commands, shared by every role that needs
// to actually confirm its work compiles rather than just eyeball it —
// reviewers included. This repo is a monorepo with package.json/scripts
// only under rentals/backend/ and rentals/frontend/ (nothing at the
// worktree root), so every real invocation needs a `cd rentals/<x> &&`
// prefix; both the prefixed and bare forms are listed since dontAsk matches
// patterns literally and it's cheap to cover both rather than guess which
// one a given Claude Code version's Bash matching actually needs.
//
// Found the hard way on a real run: neither QA, Security, nor the
// Integrator could run `npm install`/`tsc`/`prisma generate` at all (no
// pattern here covered it, and `npm install*` was in the DENY list below)
// — this repo has no committed lockfile/node_modules, so without these
// every reviewer/integrator session was reduced to manual code reading,
// unable to confirm its own conclusions. `prisma migrate`/`db push`/`db
// execute` (real, stateful database mutations) are deliberately NOT
// included — generate/validate only, explicitly denied below too.
const VERIFY_BASH_ALLOW = [
  'Bash(npm install*)',
  'Bash(cd rentals/backend && npm install*)',
  'Bash(cd rentals/frontend && npm install*)',
  'Bash(npx tsc*)',
  'Bash(cd rentals/backend && npx tsc*)',
  'Bash(cd rentals/frontend && npx tsc*)',
  'Bash(npx prisma generate*)',
  'Bash(npx prisma validate*)',
  'Bash(cd rentals/backend && npx prisma generate*)',
  'Bash(cd rentals/backend && npx prisma validate*)',
  'Bash(npx next build*)',
  'Bash(cd rentals/frontend && npx next build*)',
];

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
  ...VERIFY_BASH_ALLOW,
];
// Live-product review (ai/operating-directive.md, agents/qa.md "Live
// product review"): scoped to the one published origin this product
// actually owns, never arbitrary external URLs. This is a domain-scoped
// --allowedTools pattern (WebFetch(domain:...)), not a bare 'WebFetch'
// grant — under --permission-mode dontAsk a role only gets to fetch that
// one origin, exactly like the Bash subcommand scoping above.
const LIVE_SITE_DOMAIN = 'muslimrentals.netlify.app';
const LIVE_SITE_WEBFETCH_ALLOW = [`WebFetch(domain:${LIVE_SITE_DOMAIN})`];

const DANGEROUS_BASH_DENY = [
  'Bash(git push*)',
  'Bash(git commit*)',
  'Bash(git reset*)',
  'Bash(rm *)',
  'Bash(rm)',
  'Bash(curl*)',
  'Bash(wget*)',
  'Bash(npm publish*)',
  'Bash(npx prisma migrate*)',
  'Bash(npx prisma db*)',
  'Bash(sudo*)',
  'Bash(ssh*)',
  'Bash(chmod*)',
];

// Engineering additionally needs to stage/commit inside its own isolated
// worktree/branch (never push, never touch another branch).
//
// IMPORTANT: under --permission-mode dontAsk (see claudeAdapter.ts), a tool
// being present in --tools is NOT enough to make it usable — dontAsk denies
// any call that doesn't also match an --allowedTools pattern, with no
// prompt and no fallback. This was discovered the hard way on the first
// real --full run: Write/Edit were in `tools` but never appeared in
// `allowedToolPatterns` (only specific Bash subcommands did), so every
// implementer session was silently denied all file writes and reported
// "no changes needed" after inspecting the repo read-only. `Write` and
// `Edit` below are bare tool-name entries (not Bash subpatterns) —
// required so dontAsk actually allows them.
const ENGINEERING_ALWAYS_ALLOW = [
  'Write',
  'Edit',
  ...REVIEW_BASH_ALLOW,
  'Bash(npm run build*)',
  'Bash(cd rentals/backend && npm run build*)',
  'Bash(cd rentals/frontend && npm run build*)',
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
  'Bash(npx prisma migrate*)',
  'Bash(npx prisma db*)',
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
    tools: [...READ_ONLY_TOOLS, 'WebFetch'],
    allowedToolPatterns: LIVE_SITE_WEBFETCH_ALLOW,
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
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch'],
    allowedToolPatterns: [...REVIEW_BASH_ALLOW, ...LIVE_SITE_WEBFETCH_ALLOW],
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
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch'],
    allowedToolPatterns: [...REVIEW_BASH_ALLOW, ...LIVE_SITE_WEBFETCH_ALLOW],
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
    allowedToolPatterns: ENGINEERING_ALWAYS_ALLOW,
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
    allowedToolPatterns: ENGINEERING_ALWAYS_ALLOW,
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
    allowedToolPatterns: ENGINEERING_ALWAYS_ALLOW,
    disallowedToolPatterns: ENGINEERING_BASH_DENY,
    canWriteCode: true,
    needsWorktree: true,
    outputSchema: 'ImplementationResult',
    artifactFilename: 'backend-implementation.md',
    maxBudgetUsd: 3.0,
  },
  // Orchestration-internal only — never selectable via SupervisorPlan.requiredAgents
  // (filtered out in planner.ts, same treatment as 'supervisor'). Invoked
  // directly by the Runner when 2+ implementer roles produced changes that
  // need reconciling. needsWorktree is false here because its worktree is
  // NOT created via the standard per-role createWorktree() path used for
  // engineering/frontend/backend — see src/supervisor/orchestrator.ts's
  // integration logic, which creates one dedicated integration worktree
  // shared across however many implementer branches need merging.
  integrator: {
    role: 'integrator',
    roleFile: 'agents/integrator.md',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    allowedToolPatterns: ENGINEERING_ALWAYS_ALLOW,
    disallowedToolPatterns: ENGINEERING_BASH_DENY,
    canWriteCode: true,
    needsWorktree: false,
    outputSchema: 'IntegrationResult',
    artifactFilename: 'integration-report.md',
    maxBudgetUsd: 3.0,
  },
  // Orchestration-internal, like 'integrator' — never selectable via a
  // SupervisorPlan (filtered in planner.ts). The autonomous product/CTO
  // layer (src/autonomy/lead.ts): reads signals/backlog/memory it's handed
  // as context and decides what to work on next. Deliberately read-only —
  // same architectural hard-boundary as Designer/Legal/Trust & Safety: it
  // reasons and proposes, it never touches the repo itself. See
  // ai/autonomy-architecture.md.
  lead: {
    role: 'lead',
    roleFile: 'agents/lead.md',
    tools: READ_ONLY_TOOLS,
    allowedToolPatterns: [],
    disallowedToolPatterns: [],
    canWriteCode: false,
    needsWorktree: false,
    outputSchema: 'LeadPlan',
    artifactFilename: 'lead-plan.json',
    maxBudgetUsd: 1.0,
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
