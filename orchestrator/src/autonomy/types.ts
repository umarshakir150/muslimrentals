/**
 * Structured types for the autonomy layer — backlog, signals, memory,
 * cycles, approvals, events, and the Lead's own structured output. Kept
 * deliberately separate from src/types/schemas.ts (the execution engine's
 * artifact schemas) — see ai/autonomy-architecture.md "do not conflate
 * these layers". These are the row shapes persisted in SQLite
 * (src/autonomy/db.ts) and the schema the Lead's structured Claude call
 * must satisfy.
 */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AgentRole } from '../types/schemas.js';

// ─── Backlog ─────────────────────────────────────────────────────────────────
export const BacklogCategory = z.enum([
  'BUG',
  'FEATURE_GAP',
  'UX',
  'ACCESSIBILITY',
  'SECURITY',
  'PRIVACY',
  'TRUST_SAFETY',
  'LEGAL_FLAG',
  'TESTING',
  'TECH_DEBT',
  'PERFORMANCE',
  'INFRASTRUCTURE',
  'DEVOPS',
  'DOCUMENTATION',
  'PRODUCT_OPPORTUNITY',
]);
export type BacklogCategory = z.infer<typeof BacklogCategory>;

export const BacklogStatus = z.enum([
  'CANDIDATE',
  'TRIAGED',
  'READY',
  'SELECTED',
  'IN_PROGRESS',
  'BLOCKED',
  'APPROVAL_REQUIRED',
  'DONE',
  'REJECTED',
  'DEFERRED',
  'DUPLICATE',
]);
export type BacklogStatus = z.infer<typeof BacklogStatus>;

export const RiskLevel = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type RiskLevel = z.infer<typeof RiskLevel>;

// 0-5 integer scales throughout (userImpact/severity/effort/strategicRelevance)
// — coarse on purpose. See prioritization.ts for what each number means and
// how they combine; this file only defines shape, not scoring policy.
const Scale0to5 = z.number().int().min(0).max(5);
const Confidence0to1 = z.number().min(0).max(1);

export const BacklogItem = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  source: z.string(), // e.g. 'repo_scan', 'lead:cycle-<n>', 'qa:task-<id>'
  category: BacklogCategory,
  status: BacklogStatus,
  priority: z.number(), // deterministic computed score — see prioritization.ts
  priorityRationale: z.string().default(''),
  risk: RiskLevel,
  userImpact: Scale0to5,
  severity: Scale0to5,
  confidence: Confidence0to1,
  effort: Scale0to5,
  strategicRelevance: Scale0to5,
  evidence: z.array(z.string()).default([]),
  rationale: z.string(),
  dependencies: z.array(z.string()).default([]), // other BacklogItem ids
  createdAt: z.string(),
  updatedAt: z.string(),
  lastEvaluatedAt: z.string().optional(),
  relatedTasks: z.array(z.string()).default([]), // ai/tasks/<id> task ids
  relatedSignals: z.array(z.string()).default([]), // Signal ids
  requiresFounderDecision: z.boolean().default(false),
  requiresLegalReview: z.boolean().default(false),
  resolution: z.string().optional(),
});
export type BacklogItem = z.infer<typeof BacklogItem>;

// ─── Signals ─────────────────────────────────────────────────────────────────
export const Signal = z.object({
  id: z.string(),
  source: z.string(), // 'repo_scan' | 'build_typecheck' | 'project_state' | ... (open string, see signalSources.ts)
  type: z.string(), // finer-grained: 'todo_comment' | 'type_error' | 'unresolved_qa_finding' | ...
  category: BacklogCategory,
  severity: Scale0to5,
  confidence: Confidence0to1,
  evidence: z.string(),
  location: z.string().optional(),
  observedAt: z.string(),
  fingerprint: z.string(), // dedup key — see signalStore.ts
  relatedBacklogItems: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type Signal = z.infer<typeof Signal>;

// ─── Memory ──────────────────────────────────────────────────────────────────
export const MemoryScope = z.enum(['product', 'agent', 'decision', 'known_issue']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryStatus = z.enum(['ACTIVE', 'SUPERSEDED', 'ARCHIVED']);
export type MemoryStatus = z.infer<typeof MemoryStatus>;

export const MemoryRecord = z.object({
  id: z.string(),
  scope: MemoryScope,
  agent: AgentRole.optional(), // set when scope === 'agent'
  type: z.string(), // e.g. 'pattern', 'constraint', 'lesson', 'decision', 'issue'
  content: z.string(),
  source: z.string(), // taskId / cycleId / free text
  createdAt: z.string(),
  updatedAt: z.string(),
  confidence: Confidence0to1,
  supersedes: z.string().optional(), // id of the MemoryRecord this replaces
  status: MemoryStatus.default('ACTIVE'),
  productArea: z.string().optional(), // e.g. 'listings', 'messaging', 'roommate-profiles' — for retrieval filtering
});
export type MemoryRecord = z.infer<typeof MemoryRecord>;

// ─── Autonomous cycles ─────────────────────────────────────────────────────────
export const CycleStatus = z.enum([
  'STARTING',
  'OBSERVING',
  'PRIORITIZING',
  'EXECUTING',
  'WAITING_FOR_APPROVAL',
  'COMPLETED',
  'FAILED',
  'PAUSED',
]);
export type CycleStatus = z.infer<typeof CycleStatus>;

export const AutonomousCycle = z.object({
  id: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: CycleStatus,
  signalsCollected: z.number().int().default(0),
  backlogChanges: z.number().int().default(0),
  selectedItems: z.array(z.string()).default([]), // BacklogItem ids
  tasksCreated: z.array(z.string()).default([]), // ai/tasks/<id> ids
  modelCalls: z.number().int().default(0),
  retries: z.number().int().default(0),
  approvalRequests: z.array(z.string()).default([]), // ApprovalRequest ids
  result: z.string().optional(),
  nextEligibleAt: z.string().optional(),
  summary: z.string().optional(),
});
export type AutonomousCycle = z.infer<typeof AutonomousCycle>;

// ─── Approvals ───────────────────────────────────────────────────────────────
export const EscalationType = z.enum([
  'FOUNDER_DECISION_REQUIRED',
  'LEGAL_REVIEW_REQUIRED',
  'PRODUCTION_APPROVAL_REQUIRED',
  'DESTRUCTIVE_ACTION_APPROVAL_REQUIRED',
  'SPENDING_APPROVAL_REQUIRED',
  'SECURITY_ARCHITECTURE_APPROVAL_REQUIRED',
  'AMBIGUOUS_HIGH_IMPACT_PRODUCT_DECISION',
  'RETRY_LIMIT_EXHAUSTED',
  'RECOVERY_REQUIRED',
]);
export type EscalationType = z.infer<typeof EscalationType>;

export const ApprovalStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalRequest = z.object({
  id: z.string(),
  type: EscalationType,
  backlogItemId: z.string().optional(),
  cycleId: z.string().optional(),
  taskId: z.string().optional(),
  title: z.string(),
  description: z.string(),
  options: z.array(z.string()).default([]),
  recommendation: z.string().optional(),
  tradeoffs: z.string().optional(),
  createdAt: z.string(),
  status: ApprovalStatus.default('PENDING'),
  decidedAt: z.string().optional(),
  decisionNote: z.string().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

// ─── Events ──────────────────────────────────────────────────────────────────
export const EventType = z.enum([
  'CYCLE_STARTED',
  'SIGNAL_COLLECTED',
  'BACKLOG_ITEM_CREATED',
  'BACKLOG_ITEM_UPDATED',
  'PRIORITY_CHANGED',
  'TASK_SELECTED',
  'TASK_CREATED',
  'AGENT_STARTED',
  'AGENT_COMPLETED',
  'REVIEW_FAILED',
  'CORRECTION_STARTED',
  'REVIEW_PASSED',
  'INTEGRATION_COMPLETED',
  'APPROVAL_REQUIRED',
  'APPROVAL_GRANTED',
  'APPROVAL_REJECTED',
  'TASK_COMPLETED',
  'BRANCH_PUSHED',
  'BRANCH_PUSH_FAILED',
  'PRODUCTION_MERGED',
  'PRODUCTION_MERGE_SKIPPED',
  'PRODUCTION_MERGE_CONFLICT',
  'PRODUCTION_MERGE_FAILED',
  'LIVE_VERIFICATION_PASSED',
  'LIVE_VERIFICATION_FAILED',
  'LIVE_VERIFICATION_UNREACHABLE',
  'CYCLE_COMPLETED',
  'CYCLE_FAILED',
  'AUTONOMY_PAUSED',
  'AUTONOMY_RESUMED',
]);
export type EventType = z.infer<typeof EventType>;

export const EventRecord = z.object({
  id: z.string(),
  ts: z.string(),
  type: EventType,
  cycleId: z.string().optional(),
  taskId: z.string().optional(),
  backlogItemId: z.string().optional(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type EventRecord = z.infer<typeof EventRecord>;

// ─── Standing objective ─────────────────────────────────────────────────────
export const DEFAULT_STANDING_OBJECTIVE =
  'Make Muslim Rentals into the best safe, trustworthy, functional and usable MVP possible. ' +
  'Prioritize completing core user journeys, fixing serious bugs, protecting users, improving ' +
  'reliability and testability, and reducing launch-blocking risk. Prefer meaningful MVP progress ' +
  'over speculative complexity, growth hacks, premature optimization, or unnecessary infrastructure.';

// ─── Lead's structured output (one real Claude call per cycle) ────────────────
export const NewBacklogCandidate = z.object({
  title: z.string(),
  description: z.string(),
  category: BacklogCategory,
  evidence: z.array(z.string()).default([]),
  rationale: z.string(),
  userImpact: Scale0to5,
  severity: Scale0to5,
  confidence: Confidence0to1,
  effort: Scale0to5,
  strategicRelevance: Scale0to5,
  requiresFounderDecision: z.boolean().default(false),
  requiresLegalReview: z.boolean().default(false),
  relatedSignalIds: z.array(z.string()).default([]),
});
export type NewBacklogCandidate = z.infer<typeof NewBacklogCandidate>;

export const BacklogItemUpdate = z.object({
  id: z.string(),
  rationale: z.string(),
  status: BacklogStatus.optional(),
  userImpact: Scale0to5.optional(),
  severity: Scale0to5.optional(),
  confidence: Confidence0to1.optional(),
  effort: Scale0to5.optional(),
  strategicRelevance: Scale0to5.optional(),
  dependencies: z.array(z.string()).optional(),
  resolution: z.string().optional(),
  mergeIntoId: z.string().optional(), // set when this update marks `id` DUPLICATE of another item
});
export type BacklogItemUpdate = z.infer<typeof BacklogItemUpdate>;

export const LeadEscalation = z.object({
  type: EscalationType,
  backlogItemId: z.string().optional(),
  title: z.string(),
  description: z.string(),
  options: z.array(z.string()).default([]),
  recommendation: z.string().optional(),
  tradeoffs: z.string().optional(),
});
export type LeadEscalation = z.infer<typeof LeadEscalation>;

export const LeadPlan = z.object({
  cycleSummary: z.string(),
  newBacklogItems: z.array(NewBacklogCandidate).default([]),
  updatedBacklogItems: z.array(BacklogItemUpdate).default([]),
  selectedItemId: z.string().nullable(),
  selectionRationale: z.string(),
  escalations: z.array(LeadEscalation).default([]),
});
export type LeadPlan = z.infer<typeof LeadPlan>;

function toJsonSchemaDocument(schema: z.ZodTypeAny): Record<string, unknown> {
  const { $schema: _drop, ...rest } = zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>;
  return rest;
}

// Mirrors src/types/schemas.ts's JsonSchemas export — same $refStrategy:'none'
// requirement (Anthropic API needs type:"object" at the schema root; see
// that file's own comment for the full story of why).
export const AutonomyJsonSchemas = {
  LeadPlan: toJsonSchemaDocument(LeadPlan),
} as const;
