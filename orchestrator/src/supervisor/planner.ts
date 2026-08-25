/**
 * Builds a SupervisorPlan.
 *
 * Design split (see orchestrator/README.md "Supervisor" for the full
 * rationale): Claude's Supervisor call decides the *judgment calls* — which
 * agents this specific objective actually needs, why founder approval is or
 * isn't required, what risks to flag, what artifacts to expect. It does
 * NOT get to decide concurrency/scheduling — `parallelGroups` and
 * `dependencies` are computed deterministically in code from a fixed
 * canonical ordering (specialists -> implementers -> QA+Security), because
 * scheduling safety (who can run concurrently without corrupting whose
 * files) is exactly the kind of thing that belongs in reviewable,
 * deterministic, unit-tested code rather than model output. The model's
 * own proposed grouping is logged for comparison but never executed as-is.
 */
import type { AgentRole } from '../types/schemas.js';
import { SupervisorPlan, JsonSchemas } from '../types/schemas.js';
import type { ClaudeInvoker } from '../claude/claudeAdapter.js';
import { getProfile } from '../agents/registry.js';
import { buildContext, renderSystemPrompt, renderUserPrompt } from '../context/contextBuilder.js';
import { evaluateFounderGate } from '../approval/founderGate.js';
import { defaultScopes } from './crossBranchAnalysis.js';
import { logEvent } from '../logger.js';

export const DEFAULT_MAX_AGENTS_PER_TASK = 8;

// Canonical scheduling order. Support isn't part of the build pipeline
// (ai/workflow.md — it's inbound triage that *feeds* tasks in), but stays
// classified as a Group 1 specialist if a plan ever legitimately includes it.
export const GROUP_1_SPECIALISTS: AgentRole[] = ['designer', 'trust_safety', 'legal', 'support'];
export const GROUP_2_IMPLEMENTERS: AgentRole[] = ['engineering', 'frontend', 'backend'];
export const GROUP_3_REVIEWERS: AgentRole[] = ['qa', 'security'];

export function canonicalGrouping(requiredAgents: AgentRole[]): AgentRole[][] {
  const set = new Set(requiredAgents);
  const groups: AgentRole[][] = [];
  const g1 = GROUP_1_SPECIALISTS.filter((r) => set.has(r));
  const g2 = GROUP_2_IMPLEMENTERS.filter((r) => set.has(r));
  const g3 = GROUP_3_REVIEWERS.filter((r) => set.has(r));
  if (g1.length) groups.push(g1);
  if (g2.length) groups.push(g2);
  if (g3.length) groups.push(g3);
  // Anything outside the three known buckets (shouldn't happen given the
  // enum, but stay defensive) gets its own trailing group.
  const bucketed = new Set([...g1, ...g2, ...g3]);
  const leftover = requiredAgents.filter((r) => !bucketed.has(r));
  if (leftover.length) groups.push(leftover);
  return groups;
}

export function canonicalDependencies(groups: AgentRole[][]): Record<string, AgentRole[]> {
  const deps: Record<string, AgentRole[]> = {};
  let previous: AgentRole[] = [];
  for (const group of groups) {
    for (const role of group) deps[role] = [...previous];
    previous = [...previous, ...group];
  }
  return deps;
}

export interface PlanRequest {
  taskId: string;
  objective: string;
  mode: 'dry_run' | 'full';
  maxAgentsPerTask?: number;
}

const INSTRUCTION = `Respond with ONLY the JSON object matching the required schema — no prose, no markdown fences.

Choose "requiredAgents" from exactly this fixed set: supervisor, engineering, frontend, backend, qa, security, designer, trust_safety, legal, support. Never include "supervisor" itself. Include "engineering" (or "frontend"/"backend" if the work cleanly splits) only when this task needs real code changes. Include "qa" and "security" whenever "engineering"/"frontend"/"backend" is included — implementation is never done without independent review. Include "designer" for user-facing flow changes, "trust_safety" for anything touching user-generated content/messaging/moderation/profiles, "legal" for anything touching privacy/retention/consent/housing regulation/discrimination/terms. Do not include a role that genuinely isn't needed.

Set approvalRequirements.founderApprovalRequired to true if this task's OWN OBJECTIVE (not hypothetical future work) involves production deployment, irreversible production changes, deleting production data, permanent account bans, publishing legal policy, spending money, or major auth/security or architecture rewrites — per CLAUDE.md. List the specific reason(s) in approvalRequirements.reasons using CLAUDE.md's own wording where possible.

parallelGroups and dependencies: give your best proposal, but note the orchestrator computes the actual schedule deterministically and may override your proposal — this field is advisory/for-comparison only, so don't over-think it.`;

export async function buildPlan(req: PlanRequest, invoker: ClaudeInvoker): Promise<SupervisorPlan> {
  const profile = getProfile('supervisor');
  const bundle = buildContext({ role: 'supervisor', objective: req.objective });
  const systemPromptAddition = renderSystemPrompt(bundle);
  const userPrompt = renderUserPrompt(bundle, INSTRUCTION);

  logEvent({ taskId: req.taskId, event: 'agent_launch', role: 'supervisor', purpose: 'planning' });

  const result = await invoker.invoke({
    role: 'supervisor',
    systemPromptAddition,
    userPrompt,
    cwd: process.cwd(),
    jsonSchema: JsonSchemas.SupervisorPlan,
    tools: profile.tools,
    allowedToolPatterns: profile.allowedToolPatterns,
    disallowedToolPatterns: profile.disallowedToolPatterns,
    maxBudgetUsd: profile.maxBudgetUsd,
  });

  const parsed = SupervisorPlan.safeParse({
    ...(result.json as Record<string, unknown>),
    taskId: req.taskId,
    objective: req.objective,
  });

  let plan: SupervisorPlan;
  if (parsed.success) {
    plan = parsed.data;
  } else {
    logEvent({
      taskId: req.taskId,
      event: 'plan_validation_failed_using_fallback',
      role: 'supervisor',
      issues: parsed.error.issues.map((i) => i.message),
    });
    plan = {
      taskId: req.taskId,
      objective: req.objective,
      requiredAgents: ['designer', 'trust_safety', 'legal', 'engineering', 'qa', 'security'],
      dependencies: {},
      parallelGroups: [['designer', 'trust_safety', 'legal'], ['engineering'], ['qa', 'security']],
      implementationScopes: [],
      approvalRequirements: { founderApprovalRequired: false, reasons: [] },
      expectedArtifacts: [],
      riskNotes: ['Supervisor plan failed schema validation — used a conservative default plan.'],
    };
  }

  // Bound: max agents per task.
  const maxAgents = req.maxAgentsPerTask ?? DEFAULT_MAX_AGENTS_PER_TASK;
  if (plan.requiredAgents.length > maxAgents) {
    logEvent({
      taskId: req.taskId,
      event: 'plan_agent_count_clamped',
      requested: plan.requiredAgents.length,
      max: maxAgents,
    });
    plan.requiredAgents = plan.requiredAgents.slice(0, maxAgents);
  }
  // Supervisor never dispatches itself as a worker, and Integrator is
  // orchestration-internal only — invoked directly by the Runner when 2+
  // implementer roles run, never selected via the plan (see registry.ts).
  plan.requiredAgents = plan.requiredAgents.filter((r) => r !== 'supervisor' && r !== 'integrator');

  // Scheduling is always computed deterministically, never taken from the model.
  const modelGroups = plan.parallelGroups;
  plan.parallelGroups = canonicalGrouping(plan.requiredAgents);
  plan.dependencies = canonicalDependencies(plan.parallelGroups);
  logEvent({
    taskId: req.taskId,
    event: 'plan_scheduling_computed',
    modelProposed: modelGroups,
    actual: plan.parallelGroups,
  });

  // Implementation scope (which paths each implementer is expected to
  // touch) is likewise always computed deterministically — see
  // crossBranchAnalysis.ts's rationale. The model isn't asked for this at
  // all; there's nothing here for it to propose or override.
  const implementerRoles = plan.requiredAgents.filter((r) => GROUP_2_IMPLEMENTERS.includes(r));
  plan.implementationScopes = defaultScopes(implementerRoles);

  // Founder gate: union of the model's own judgment and the deterministic
  // CLAUDE.md-driven keyword gate. Never rely on model judgment alone for
  // a safety-critical stop condition.
  const deterministicGate = evaluateFounderGate(req.objective);
  const required = plan.approvalRequirements.founderApprovalRequired || deterministicGate.required;
  const reasons = Array.from(new Set([...plan.approvalRequirements.reasons, ...deterministicGate.reasons]));
  plan.approvalRequirements = { founderApprovalRequired: required, reasons };

  if (req.mode === 'dry_run') {
    plan.riskNotes = [...plan.riskNotes, 'DRY RUN — planning/analysis only, no implementation will occur.'];
  }

  logEvent({ taskId: req.taskId, event: 'agent_complete', role: 'supervisor', purpose: 'planning' });
  return plan;
}
