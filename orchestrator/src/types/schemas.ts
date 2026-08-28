/**
 * Structured artifact schemas for the orchestrator.
 *
 * Zod is the single source of truth: each schema is used (a) to validate
 * whatever JSON a Claude worker returns, and (b) to generate the JSON
 * Schema passed to `claude --json-schema` so the model is constrained at
 * generation time too. Belt and suspenders — never trust model output
 * without re-validating it locally.
 */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Roles ─────────────────────────────────────────────────────────────────
// Matches the persistent roles defined under agents/*.md. Keep in sync with
// src/agents/registry.ts, which is the other half of "one role, one file".
export const AgentRole = z.enum([
  'supervisor',
  'engineering',
  'frontend',
  'backend',
  'qa',
  'security',
  'designer',
  'trust_safety',
  'legal',
  'support',
  'integrator',
  // Orchestration-internal, like 'integrator' — the autonomous product/CTO
  // layer above the Supervisor (src/autonomy/lead.ts). Never selectable via
  // a SupervisorPlan; filtered out in planner.ts the same way 'supervisor'
  // and 'integrator' are. See ai/autonomy-architecture.md.
  'lead',
]);
export type AgentRole = z.infer<typeof AgentRole>;

// ─── Task lifecycle state ───────────────────────────────────────────────────
// Mirrors the review loop required by the task: PLANNING -> ... -> COMPLETE,
// with FOUNDER_APPROVAL_REQUIRED and ABORTED as the two ways execution can
// stop short of COMPLETE.
export const TaskState = z.enum([
  'PLANNING',
  'SPECIALIST_REVIEW',
  'READY_FOR_IMPLEMENTATION',
  'IMPLEMENTING',
  // Single-implementer review path (unchanged from before multi-worker
  // integration existed — there is only ever one worktree to review, so
  // there's nothing to cross-check against).
  'QA_REVIEW',
  'SECURITY_REVIEW',
  'RE_REVIEW',
  // Multi-implementer path: entered only when 2+ implementer roles ran.
  // See orchestrator/README.md "Integration" for why this replaces
  // per-worktree review rather than running alongside it.
  'CROSS_BRANCH_ANALYSIS',
  'INTEGRATION',
  'INTEGRATED_QA_REVIEW',
  'INTEGRATED_SECURITY_REVIEW',
  'RE_INTEGRATION',
  // Shared by both paths.
  'CORRECTION_REQUIRED',
  'READY_FOR_FOUNDER',
  'FOUNDER_APPROVAL_REQUIRED',
  'COMPLETE',
  'DRY_RUN_COMPLETE',
  'ABORTED',
]);
export type TaskState = z.infer<typeof TaskState>;

// ─── Shared building blocks ─────────────────────────────────────────────────
export const Severity = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof Severity>;

export const Finding = z.object({
  severity: Severity,
  finding: z.string().min(1),
  evidence: z.string().optional(),
  recommendedAction: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

// ─── ImplementationScope ──────────────────────────────────────────────────────
// Per-implementer file-path ownership, e.g. { agent: "frontend",
// expectedPaths: ["rentals/frontend/**"], allowedSharedPaths: [] }. Always
// computed deterministically per role (src/supervisor/crossBranchAnalysis.ts)
// rather than left to model judgment — same reasoning as parallelGroups
// scheduling: this is a safety-relevant boundary, not a creative decision.
export const ImplementationScope = z.object({
  agent: AgentRole,
  expectedPaths: z.array(z.string()).min(1),
  allowedSharedPaths: z.array(z.string()).default([]),
});
export type ImplementationScope = z.infer<typeof ImplementationScope>;

// ─── SupervisorPlan ──────────────────────────────────────────────────────────
export const SupervisorPlan = z.object({
  taskId: z.string(),
  objective: z.string(),
  requiredAgents: z.array(AgentRole).min(1),
  // Which agents must finish before a given agent may start.
  dependencies: z.record(AgentRole, z.array(AgentRole)).default({}),
  // Ordered groups; agents within a group may run concurrently, groups run
  // in order. e.g. [["designer","trust_safety","legal"],["engineering"],["qa","security"]]
  parallelGroups: z.array(z.array(AgentRole)).min(1),
  // Only populated for implementer roles; empty for a task with 0-1 implementers.
  implementationScopes: z.array(ImplementationScope).default([]),
  approvalRequirements: z.object({
    founderApprovalRequired: z.boolean(),
    reasons: z.array(z.string()).default([]),
  }),
  expectedArtifacts: z.array(z.string()).default([]),
  riskNotes: z.array(z.string()).default([]),
});
export type SupervisorPlan = z.infer<typeof SupervisorPlan>;

// ─── AgentAnalysis ───────────────────────────────────────────────────────────
// Used by read-only/analysis roles: designer, legal, trust_safety, support.
export const AgentAnalysis = z.object({
  role: AgentRole,
  taskId: z.string(),
  summary: z.string(),
  findings: z.array(Finding).default([]),
  openQuestions: z.array(z.string()).default([]),
  recommendation: z.string(),
});
export type AgentAnalysis = z.infer<typeof AgentAnalysis>;

// ─── ImplementationResult ───────────────────────────────────────────────────
// Used by engineering (and, per-file, frontend/backend if ever split out).
export const ImplementationResult = z.object({
  role: z.literal('engineering'),
  taskId: z.string(),
  branch: z.string(),
  filesChanged: z.array(z.string()).default([]),
  summary: z.string(),
  testPlan: z.string(),
  selfCheckNotes: z.array(z.string()).default([]),
  // True only if Engineering explicitly decided no code change was needed
  // (e.g. the task turned out to be documentation/analysis only).
  noChangesNeeded: z.boolean().default(false),
});
export type ImplementationResult = z.infer<typeof ImplementationResult>;

// ─── WorkerChangeSet / ChangedFilesReport ─────────────────────────────────────
// Ground truth for what one implementer's worktree actually changed relative
// to the task's base commit — computed from git, never from a model's
// self-report (see src/git/worktree.ts diffNameStatus()).
export const WorkerChangeSet = z.object({
  agent: AgentRole,
  branch: z.string(),
  added: z.array(z.string()).default([]),
  modified: z.array(z.string()).default([]),
  deleted: z.array(z.string()).default([]),
  renamed: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
});
export type WorkerChangeSet = z.infer<typeof WorkerChangeSet>;

export const ChangedFilesReport = z.object({
  taskId: z.string(),
  baseCommit: z.string(),
  workers: z.array(WorkerChangeSet),
});
export type ChangedFilesReport = z.infer<typeof ChangedFilesReport>;

// ─── OverlapReport ─────────────────────────────────────────────────────────────
// Deterministic cross-branch analysis output (src/supervisor/crossBranchAnalysis.ts) —
// no model involved. This is what makes "two implementers silently diverged
// on the same file" a detected condition instead of something only a human
// (or an unlucky founder in production) discovers later.
export const OverlapClassification = z.enum(['EXPECTED_SHARED', 'SUSPICIOUS', 'CONFLICTING']);
export type OverlapClassification = z.infer<typeof OverlapClassification>;

export const OverlapEntry = z.object({
  path: z.string(),
  agents: z.array(AgentRole).min(2),
  classification: OverlapClassification,
  reason: z.string(),
});
export type OverlapEntry = z.infer<typeof OverlapEntry>;

export const OutOfScopeEntry = z.object({
  agent: AgentRole,
  path: z.string(),
  classification: z.literal('OUT_OF_SCOPE_REVIEW_REQUIRED'),
  reason: z.string(),
});
export type OutOfScopeEntry = z.infer<typeof OutOfScopeEntry>;

export const OverlapReport = z.object({
  taskId: z.string(),
  overlaps: z.array(OverlapEntry).default([]),
  outOfScope: z.array(OutOfScopeEntry).default([]),
  // True if anything here requires the Integrator agent's judgment rather
  // than a purely mechanical merge — any CONFLICTING overlap, or any
  // out-of-scope entry at all.
  hasBlockingIssues: z.boolean(),
});
export type OverlapReport = z.infer<typeof OverlapReport>;

// ─── IntegrationResult ───────────────────────────────────────────────────────
// The Integrator's structured output. Never a final approval — see
// agents/integrator.md: the Integrator reconciles, it does not sign off.
export const IntegrationDecision = z.object({
  path: z.string(),
  // e.g. "frontend", "backend", "combined", "kept-base" — free text because
  // the set of implementer roles involved varies per task.
  chosenSource: z.string(),
  combined: z.boolean().default(false),
  rationale: z.string(),
  behaviorChanged: z.string().optional(),
});
export type IntegrationDecision = z.infer<typeof IntegrationDecision>;

export const IntegrationResult = z.object({
  role: z.literal('integrator'),
  taskId: z.string(),
  branch: z.string(),
  decisions: z.array(IntegrationDecision).default([]),
  filesChanged: z.array(z.string()).default([]),
  summary: z.string(),
  // Non-empty means integration FAILED to reach a clean, mergeable state —
  // the orchestrator treats this as blocking, never as a partial success.
  unresolvedConflicts: z.array(z.string()).default([]),
});
export type IntegrationResult = z.infer<typeof IntegrationResult>;

// ─── ReviewResult ────────────────────────────────────────────────────────────
// Used by qa and security. Verdict vocabulary matches agents/qa.md and
// agents/security.md exactly: QA says PASS/CHANGES_REQUIRED, Security says
// APPROVED/CHANGES_REQUIRED.
export const ReviewVerdict = z.enum(['PASS', 'APPROVED', 'CHANGES_REQUIRED']);
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

export const ReviewResult = z.object({
  role: z.enum(['qa', 'security']),
  taskId: z.string(),
  verdict: ReviewVerdict,
  findings: z.array(Finding).default([]),
  notes: z.string().optional(),
});
export type ReviewResult = z.infer<typeof ReviewResult>;

// ─── FinalTaskReport ─────────────────────────────────────────────────────────
export const FinalTaskReport = z.object({
  taskId: z.string(),
  objective: z.string(),
  finalState: TaskState,
  agentsInvolved: z.array(AgentRole),
  approvalGate: z.object({
    required: z.boolean(),
    reasons: z.array(z.string()).default([]),
  }),
  qaVerdict: ReviewVerdict.optional(),
  securityVerdict: ReviewVerdict.optional(),
  correctionCycles: z.number().int().min(0),
  summary: z.string(),
  filesChanged: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
});
export type FinalTaskReport = z.infer<typeof FinalTaskReport>;

// ─── JSON Schema export for --json-schema ───────────────────────────────────
// $refStrategy: 'none' fully inlines every subschema instead of de-duping
// repeated ones (e.g. the AgentRole enum, reused across requiredAgents/
// dependencies/parallelGroups) behind $ref/definitions. This is
// deliberate: Claude Code turns --json-schema into an Anthropic API tool's
// input_schema, and the API requires `type: "object"` at that schema's own
// root — a `{"$ref": "...", "definitions": {...}}` wrapper (zod-to-json-
// schema's default) fails with "tools.N.custom.input_schema.type: Field
// required" because the type lives one level down, inside `definitions`,
// not at the root. Verified empirically against the installed CLI
// (2.1.243) — see orchestrator/README.md "Troubleshooting". A few dozen
// duplicated bytes for the AgentRole enum is a trivial cost next to a
// hard failure on every single worker invocation.
function toJsonSchemaDocument(schema: z.ZodTypeAny): Record<string, unknown> {
  const { $schema: _drop, ...rest } = zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>;
  return rest;
}

export const JsonSchemas = {
  SupervisorPlan: toJsonSchemaDocument(SupervisorPlan),
  AgentAnalysis: toJsonSchemaDocument(AgentAnalysis),
  ImplementationResult: toJsonSchemaDocument(ImplementationResult),
  IntegrationResult: toJsonSchemaDocument(IntegrationResult),
  ReviewResult: toJsonSchemaDocument(ReviewResult),
  FinalTaskReport: toJsonSchemaDocument(FinalTaskReport),
} as const;
