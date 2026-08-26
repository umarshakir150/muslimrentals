/**
 * The Lead/CTO planning module — PART 4. One real, bounded Claude call per
 * cycle (role 'lead', read-only tools, agents/lead.md instructions) that
 * answers "what should we work on next," never "how do we execute it" —
 * that remains the Supervisor's job (planner.ts), invoked separately by
 * cycle.ts once this module hands back a selected item.
 *
 * "Model proposes, code decides," applied at every step here exactly as it
 * already is in planner.ts:
 *   - The Lead proposes qualitative scoring inputs for new/updated backlog
 *     items; computePriority() always computes the real number.
 *   - The Lead proposes a selection; classifyRisk() always (re-)computes
 *     the real risk, regardless of what the item's own stored `risk` field
 *     or the Lead's own text says. A HIGH result blocks selection outright
 *     — this module never hands cycle.ts a HIGH-risk item to execute.
 *   - The Lead can name at most one selectedItemId — LeadPlan's schema is a
 *     single nullable string, not an array, so "maxSelectedImplementation
 *     TasksPerCycle = 1" (PART 7) is enforced by the shape of the output
 *     itself, not just a convention callers have to remember.
 *   - Duplicate detection against the existing backlog is always the
 *     deterministic Jaccard check in backlogStore.ts, never the model's own
 *     "is this new" claim.
 */
import type { ClaudeInvoker } from '../claude/claudeAdapter.js';
import { getProfile } from '../agents/registry.js';
import { buildContext, renderSystemPrompt, renderUserPrompt } from '../context/contextBuilder.js';
import { REPO_ROOT } from '../paths.js';
import { getStandingObjective } from './objective.js';
import { createBacklogItem, findSimilarBacklogItems, getBacklogItem, listBacklogItems, mergeDuplicate, updateBacklogItem } from './backlogStore.js';
import { getRelevantMemory } from './memoryStore.js';
import { classifyRisk, type RiskClassification } from './riskClassification.js';
import { createApprovalRequest } from './approvalStore.js';
import { logAutonomyEvent } from './eventLog.js';
import { AutonomyJsonSchemas, LeadPlan, type BacklogItem, type EscalationType, type Signal } from './types.js';

const SELECTABLE_STATUSES = new Set(['CANDIDATE', 'TRIAGED', 'READY']);

const INSTRUCTION = `Respond with ONLY the JSON object matching the required LeadPlan schema — no prose, no markdown fences.

You are the Lead — a read-only planning role. You never implement anything yourself; you decide what the existing multi-agent team should work on next, then the orchestrator (not you) hands it to the Supervisor for real execution, review, and integration.

Ground every claim in the backlog/signals/memory actually provided above, or in files you read yourself with your read-only tools. Do not invent findings you have not observed.

newBacklogItems: propose genuinely NEW candidate improvements this cycle (a handful at most — quality over quantity). Do not re-propose something already present in the current backlog above; the orchestrator will still deterministically re-check for near-duplicates and merge them, but you should check yourself first. Every candidate needs a concrete rationale and at least one evidence citation (a file path, a signal, a past finding).

updatedBacklogItems: use this to refresh an EXISTING item's scoring (new evidence changes your view of its impact/severity/effort) or to mark one item a duplicate of another (set mergeIntoId). Always give a rationale explaining the change.

selectedItemId: choose AT MOST ONE item to recommend actually starting this cycle — the single highest-value item you believe is safe and ready to execute now. It must be either:
  - the real "id" of an existing backlog item from the list above that is currently CANDIDATE, TRIAGED, or READY (not already DONE/IN_PROGRESS/BLOCKED/etc.), OR
  - "new:<index>" referring to the 0-based position of one of your own newBacklogItems entries (the orchestrator will resolve this to the real id once it's persisted).
Set it to null if nothing is currently safe/ready to start (that's a legitimate outcome — explain why in selectionRationale). Do not select an item whose dependencies (its "dependencies" field) are not yet DONE.

selectionRationale: explain in plain language why this item, not another — cite its priority, evidence, and why it's safe to start now. This is what CLAUDE.md and the founder will actually read to understand your reasoning.

escalations: use ONLY for genuine founder-level decisions — CLAUDE.md's own reserved categories (production deployment, irreversible production changes, deleting production data, permanent bans, publishing legal policy, spending money, major auth/security or architecture rewrites), ambiguous high-impact product direction, or anything you are not confident is safe to decide yourself. Do NOT escalate routine implementation details, ordinary component choices, obvious bug fixes, minor UX decisions, or normal agent/role selection — those are exactly what the existing team already handles without founder involvement. An empty escalations list is the normal, expected case most cycles.

Remember: core MVP functionality and fixing broken user journeys generally outrank cosmetic polish; security, privacy, and trust & safety issues generally outrank both; testing/verification gaps deserve real priority once autonomous changes are happening, since they are what makes further autonomous work safe to trust.`;

function summarizeBacklogItem(item: BacklogItem) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    category: item.category,
    status: item.status,
    priority: item.priority,
    risk: item.risk,
    userImpact: item.userImpact,
    severity: item.severity,
    confidence: item.confidence,
    effort: item.effort,
    strategicRelevance: item.strategicRelevance,
    evidence: item.evidence,
    rationale: item.rationale,
    dependencies: item.dependencies,
    relatedTasks: item.relatedTasks,
    lastEvaluatedAt: item.lastEvaluatedAt,
  };
}

function summarizeSignal(signal: Signal) {
  return {
    id: signal.id,
    source: signal.source,
    type: signal.type,
    category: signal.category,
    severity: signal.severity,
    confidence: signal.confidence,
    evidence: signal.evidence,
    location: signal.location,
  };
}

export interface LeadPlanningResult {
  plan: LeadPlan;
  createdItems: BacklogItem[];
  duplicatesAbsorbed: Array<{ candidateTitle: string; absorbedIntoId: string }>;
  updatedItems: BacklogItem[];
  mergedDuplicates: BacklogItem[];
  /** Present only when a real, currently-eligible (LOW/MEDIUM risk,
   * dependencies resolved) item was selected — cycle.ts may hand this
   * straight to the existing orchestrator (runTask()). */
  selected?: { item: BacklogItem; risk: RiskClassification };
  /** Always set when `selected` is absent — why nothing was started this
   * cycle (no candidate selected, invalid reference, unresolved
   * dependency, or blocked pending founder approval). */
  selectionNote?: string;
  /** ApprovalRequest ids created this cycle: the model's own escalations
   * plus (if applicable) the HIGH-risk-selection block. */
  approvalRequestIds: string[];
}

export interface RunLeadPlanningParams {
  invoker: ClaudeInvoker;
  cycleId: string;
  /** Signals gathered earlier in this same cycle (new + still-standing) —
   * the Lead's raw evidence base alongside the backlog and memory. */
  signals: Signal[];
}

function escalationTypeForBlockedSelection(item: BacklogItem): EscalationType {
  if (item.requiresLegalReview || item.category === 'LEGAL_FLAG') return 'LEGAL_REVIEW_REQUIRED';
  return 'FOUNDER_DECISION_REQUIRED';
}

export async function runLeadPlanning(params: RunLeadPlanningParams): Promise<LeadPlanningResult> {
  const { invoker, cycleId, signals } = params;
  const objective = getStandingObjective();
  const backlog = listBacklogItems({ limit: 40 });
  const memory = getRelevantMemory({ limit: 15 });

  const profile = getProfile('lead');
  const bundle = buildContext({ role: 'lead', objective });
  const systemPromptAddition = renderSystemPrompt(bundle);

  const contextBlock = [
    `## Standing founder objective\n\n${objective}`,
    `## Current backlog (${backlog.length} items, priority-sorted; full history of anything already worked on lives in ai/tasks/)\n\n${JSON.stringify(backlog.map(summarizeBacklogItem), null, 2)}`,
    `## Signals available this cycle (${signals.length})\n\n${JSON.stringify(signals.map(summarizeSignal), null, 2)}`,
    `## Relevant organizational memory (${memory.length} records)\n\n${JSON.stringify(memory, null, 2)}`,
  ].join('\n\n');

  const userPrompt = renderUserPrompt(bundle, `${contextBlock}\n\n${INSTRUCTION}`);

  logAutonomyEvent({ type: 'AGENT_STARTED', cycleId, message: 'Lead planning call started.' });

  const result = await invoker.invoke({
    role: 'lead',
    systemPromptAddition,
    userPrompt,
    cwd: REPO_ROOT,
    jsonSchema: AutonomyJsonSchemas.LeadPlan,
    tools: profile.tools,
    allowedToolPatterns: profile.allowedToolPatterns,
    disallowedToolPatterns: profile.disallowedToolPatterns,
    maxBudgetUsd: profile.maxBudgetUsd,
  });

  const parsed = LeadPlan.safeParse(result.json);
  let plan: LeadPlan;
  if (parsed.success) {
    plan = parsed.data;
  } else {
    logAutonomyEvent({
      type: 'AGENT_COMPLETED',
      cycleId,
      message: 'Lead output failed LeadPlan schema validation — treated as a no-op planning pass.',
      data: { issues: parsed.error.issues.map((i) => i.message) },
    });
    plan = {
      cycleSummary: 'Lead output failed schema validation this cycle. No backlog changes or selection were made; the cycle will still complete safely and retry next time.',
      newBacklogItems: [],
      updatedBacklogItems: [],
      selectedItemId: null,
      selectionRationale: 'N/A — invalid model output.',
      escalations: [],
    };
  }

  logAutonomyEvent({ type: 'AGENT_COMPLETED', cycleId, message: 'Lead planning call completed.', data: { summary: plan.cycleSummary } });

  // ── Apply new candidates — deterministic dedup against the real backlog ──
  const createdItems: BacklogItem[] = [];
  const duplicatesAbsorbed: Array<{ candidateTitle: string; absorbedIntoId: string }> = [];
  const newItemIdByIndex = new Map<number, string>();

  plan.newBacklogItems.forEach((candidate, index) => {
    const similar = findSimilarBacklogItems(candidate.title, candidate.category, 0.6);
    const survivor = similar[0];
    if (survivor) {
      const merged = updateBacklogItem(survivor.id, {
        evidence: Array.from(new Set([...survivor.evidence, ...candidate.evidence])),
        changeReason: `Lead proposed a near-duplicate candidate ("${candidate.title}") this cycle — evidence merged into this existing item instead of creating a new one.`,
      });
      duplicatesAbsorbed.push({ candidateTitle: candidate.title, absorbedIntoId: merged.id });
      newItemIdByIndex.set(index, merged.id);
      logAutonomyEvent({ type: 'BACKLOG_ITEM_UPDATED', cycleId, backlogItemId: merged.id, message: `Absorbed near-duplicate candidate "${candidate.title}" into existing item.` });
      return;
    }

    const created = createBacklogItem({
      title: candidate.title,
      description: candidate.description,
      source: `lead:${cycleId}`,
      category: candidate.category,
      userImpact: candidate.userImpact,
      severity: candidate.severity,
      confidence: candidate.confidence,
      effort: candidate.effort,
      strategicRelevance: candidate.strategicRelevance,
      evidence: candidate.evidence,
      rationale: candidate.rationale,
      requiresFounderDecision: candidate.requiresFounderDecision,
      requiresLegalReview: candidate.requiresLegalReview,
      relatedSignals: candidate.relatedSignalIds,
    });
    createdItems.push(created);
    newItemIdByIndex.set(index, created.id);
    logAutonomyEvent({ type: 'BACKLOG_ITEM_CREATED', cycleId, backlogItemId: created.id, message: `New backlog candidate: ${created.title}` });
  });

  // ── Apply updates to existing items (including duplicate merges) ──
  const updatedItems: BacklogItem[] = [];
  const mergedDuplicates: BacklogItem[] = [];

  for (const update of plan.updatedBacklogItems) {
    const existing = getBacklogItem(update.id);
    if (!existing) {
      logAutonomyEvent({ type: 'BACKLOG_ITEM_UPDATED', cycleId, message: `Lead referenced unknown backlog item "${update.id}" in updatedBacklogItems — skipped.` });
      continue;
    }
    if (update.mergeIntoId) {
      const survivor = getBacklogItem(update.mergeIntoId);
      if (!survivor) {
        logAutonomyEvent({ type: 'BACKLOG_ITEM_UPDATED', cycleId, message: `Lead asked to merge "${update.id}" into unknown item "${update.mergeIntoId}" — skipped.` });
        continue;
      }
      const dup = mergeDuplicate(update.id, update.mergeIntoId, update.rationale);
      mergedDuplicates.push(dup);
      logAutonomyEvent({ type: 'BACKLOG_ITEM_UPDATED', cycleId, backlogItemId: update.mergeIntoId, message: `Merged duplicate "${dup.id}" into "${update.mergeIntoId}": ${update.rationale}` });
      continue;
    }
    const priorityInputsChanged =
      update.userImpact !== undefined || update.severity !== undefined || update.confidence !== undefined || update.effort !== undefined || update.strategicRelevance !== undefined;
    const updated = updateBacklogItem(update.id, {
      status: update.status,
      userImpact: update.userImpact,
      severity: update.severity,
      confidence: update.confidence,
      effort: update.effort,
      strategicRelevance: update.strategicRelevance,
      dependencies: update.dependencies,
      resolution: update.resolution,
      changeReason: update.rationale,
    });
    updatedItems.push(updated);
    logAutonomyEvent({
      type: priorityInputsChanged ? 'PRIORITY_CHANGED' : 'BACKLOG_ITEM_UPDATED',
      cycleId,
      backlogItemId: updated.id,
      message: `${updated.title}: ${update.rationale}`,
    });
  }

  // ── Resolve escalations into persisted ApprovalRequests ──
  const approvalRequestIds: string[] = [];
  for (const escalation of plan.escalations) {
    const request = createApprovalRequest({
      type: escalation.type,
      title: escalation.title,
      description: escalation.description,
      backlogItemId: escalation.backlogItemId,
      cycleId,
      options: escalation.options,
      recommendation: escalation.recommendation,
      tradeoffs: escalation.tradeoffs,
    });
    approvalRequestIds.push(request.id);
    if (escalation.backlogItemId) {
      const item = getBacklogItem(escalation.backlogItemId);
      if (item && item.status !== 'DONE' && item.status !== 'REJECTED' && item.status !== 'DUPLICATE') {
        updateBacklogItem(item.id, { status: 'APPROVAL_REQUIRED', changeReason: `Lead escalation: ${escalation.title}` });
      }
    }
    logAutonomyEvent({ type: 'APPROVAL_REQUIRED', cycleId, backlogItemId: escalation.backlogItemId, message: escalation.title, data: { approvalRequestId: request.id, escalationType: escalation.type } });
  }

  // ── Resolve the selection — the one place a HIGH-risk item is guaranteed to be blocked before any execution can start ──
  const resolveSelectedId = (raw: string): string | undefined => {
    if (raw.startsWith('new:')) {
      const index = Number(raw.slice('new:'.length));
      return Number.isInteger(index) ? newItemIdByIndex.get(index) : undefined;
    }
    return getBacklogItem(raw) ? raw : undefined;
  };

  let selected: LeadPlanningResult['selected'];
  let selectionNote: string | undefined;

  if (!plan.selectedItemId) {
    selectionNote = `Lead selected nothing this cycle. Rationale: ${plan.selectionRationale}`;
  } else {
    const resolvedId = resolveSelectedId(plan.selectedItemId);
    const item = resolvedId ? getBacklogItem(resolvedId) : undefined;
    if (!item) {
      selectionNote = `Lead selected "${plan.selectedItemId}", which did not resolve to a real backlog item — no work started this cycle.`;
    } else if (!SELECTABLE_STATUSES.has(item.status)) {
      selectionNote = `Lead selected "${item.title}" (${item.id}), but its status is ${item.status}, not eligible for fresh selection — no work started this cycle.`;
    } else if (item.dependencies.some((depId) => getBacklogItem(depId)?.status !== 'DONE')) {
      updateBacklogItem(item.id, { status: 'BLOCKED', changeReason: 'Selected by Lead, but has unresolved dependencies — blocked until they are DONE.' });
      selectionNote = `Lead selected "${item.title}" (${item.id}), but it has unresolved dependencies — marked BLOCKED instead of starting.`;
    } else {
      const risk = classifyRisk(item);
      if (risk.risk === 'HIGH') {
        const request = createApprovalRequest({
          type: escalationTypeForBlockedSelection(item),
          title: `Founder approval required to start: ${item.title}`,
          description: `The Lead selected this item this cycle (rationale: ${plan.selectionRationale}), but deterministic risk classification marked it HIGH: ${risk.reasons.join(' ')}`,
          backlogItemId: item.id,
          cycleId,
          recommendation: plan.selectionRationale,
        });
        approvalRequestIds.push(request.id);
        const blocked = updateBacklogItem(item.id, { status: 'APPROVAL_REQUIRED', risk: 'HIGH', changeReason: `Selected by Lead, blocked pending founder approval: ${risk.reasons.join(' ')}` });
        logAutonomyEvent({ type: 'APPROVAL_REQUIRED', cycleId, backlogItemId: blocked.id, message: `HIGH-risk selection blocked: ${blocked.title}`, data: { approvalRequestId: request.id, reasons: risk.reasons } });
        selectionNote = `Lead selected "${item.title}" (${item.id}), but it is HIGH risk — a founder approval request was created instead of starting work.`;
      } else {
        const readied = updateBacklogItem(item.id, { status: 'SELECTED', risk: risk.risk, changeReason: `Selected by Lead this cycle: ${plan.selectionRationale}` });
        selected = { item: readied, risk };
        logAutonomyEvent({ type: 'TASK_SELECTED', cycleId, backlogItemId: readied.id, message: `Selected: ${readied.title}`, data: { risk: risk.risk, reasons: risk.reasons } });
      }
    }
  }

  return {
    plan,
    createdItems,
    duplicatesAbsorbed,
    updatedItems,
    mergedDuplicates,
    selected,
    selectionNote,
    approvalRequestIds,
  };
}
