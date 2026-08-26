/**
 * Lead planning module tests (PART 22) — the Claude call itself is always
 * scripted (ScriptedClaudeInvoker, same fake used by tests/orchestrator.
 * test.ts), so these are deterministic and never spend a real API call.
 * What's under test is the deterministic post-processing around that one
 * call: dedup, priority recomputation, selection resolution (including the
 * "new:<index>" convention), dependency blocking, and — most importantly —
 * that a HIGH-risk selection can never come back as `selected`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/autonomy/db.js';
import { getAutonomyDbPath } from '../src/paths.js';

// See tests/autonomyStores.test.ts for why each autonomy test file needs
// its own DB path when Vitest runs files in parallel.
process.env.ORCHESTRATOR_AUTONOMY_DB = path.join(path.dirname(getAutonomyDbPath()), 'autonomy-lead.db');
import { ScriptedClaudeInvoker } from '../src/claude/fakeInvoker.js';
import { runLeadPlanning } from '../src/autonomy/lead.js';
import { createBacklogItem, getBacklogItem } from '../src/autonomy/backlogStore.js';
import { getApprovalRequest, listApprovalRequests } from '../src/autonomy/approvalStore.js';
import type { LeadPlan } from '../src/autonomy/types.js';

function freshDb(): void {
  closeDb();
  const dbPath = getAutonomyDbPath();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
}

beforeEach(() => {
  freshDb();
});

function leadInvoker(plan: unknown): ScriptedClaudeInvoker {
  return new ScriptedClaudeInvoker({ lead: plan });
}

const emptyPlan: LeadPlan = {
  cycleSummary: 'Nothing to do.',
  newBacklogItems: [],
  updatedBacklogItems: [],
  selectedItemId: null,
  selectionRationale: 'No candidates observed.',
  escalations: [],
};

describe('runLeadPlanning', () => {
  it('creates new backlog items from the model output and can select one of them via "new:<index>"', async () => {
    const plan: LeadPlan = {
      cycleSummary: 'Found one bug worth fixing.',
      newBacklogItems: [
        {
          title: 'Saved listings empty state is blank',
          description: 'Show a message instead of a blank screen.',
          category: 'BUG',
          evidence: ['manual repro'],
          rationale: 'Confirmed papercut.',
          userImpact: 3,
          severity: 2,
          confidence: 0.8,
          effort: 1,
          strategicRelevance: 2,
          requiresFounderDecision: false,
          requiresLegalReview: false,
          relatedSignalIds: [],
        },
      ],
      updatedBacklogItems: [],
      selectedItemId: 'new:0',
      selectionRationale: 'Small, safe, high-confidence fix.',
      escalations: [],
    };

    const result = await runLeadPlanning({ invoker: leadInvoker(plan), cycleId: 'cyc_test1', signals: [] });

    expect(result.createdItems).toHaveLength(1);
    expect(result.selected).toBeDefined();
    expect(result.selected?.item.id).toBe(result.createdItems[0]?.id);
    expect(result.selected?.item.status).toBe('SELECTED');
    expect(result.selected?.risk.risk).toBe('LOW');
  });

  it('selects an existing backlog item by its real id', async () => {
    const existing = createBacklogItem({
      title: 'Fix accessibility label on filter button',
      description: 'Missing aria-label.',
      source: 'test',
      category: 'ACCESSIBILITY',
      userImpact: 2,
      severity: 1,
      confidence: 0.9,
      effort: 1,
      strategicRelevance: 1,
      rationale: 'Found via manual audit.',
    });

    const plan: LeadPlan = { ...emptyPlan, selectedItemId: existing.id, selectionRationale: 'Cheap, safe accessibility fix.' };
    const result = await runLeadPlanning({ invoker: leadInvoker(plan), cycleId: 'cyc_test2', signals: [] });

    expect(result.selected?.item.id).toBe(existing.id);
    expect(result.selectionNote).toBeUndefined();
  });

  it('a HIGH-risk selection never comes back as `selected` — it is blocked with a founder approval request instead', async () => {
    const existing = createBacklogItem({
      title: 'Deploy the new checkout flow to production',
      description: 'Ship it live.',
      source: 'test',
      category: 'FEATURE_GAP',
      userImpact: 5,
      severity: 5,
      confidence: 1,
      effort: 1,
      strategicRelevance: 5,
      rationale: 'Founder wants this live ASAP.',
    });

    const plan: LeadPlan = { ...emptyPlan, selectedItemId: existing.id, selectionRationale: 'Highest priority item.' };
    const result = await runLeadPlanning({ invoker: leadInvoker(plan), cycleId: 'cyc_test3', signals: [] });

    expect(result.selected).toBeUndefined();
    expect(result.selectionNote).toMatch(/HIGH risk/);
    expect(result.approvalRequestIds.length).toBeGreaterThan(0);
    const approval = getApprovalRequest(result.approvalRequestIds[0] as string);
    expect(approval?.status).toBe('PENDING');
    expect(getBacklogItem(existing.id)?.status).toBe('APPROVAL_REQUIRED');
  });

  it('an item with an unresolved dependency is marked BLOCKED, not selected', async () => {
    const dependency = createBacklogItem({
      title: 'Prerequisite schema change',
      description: 'Needed first.',
      source: 'test',
      category: 'TECH_DEBT',
      userImpact: 1,
      severity: 1,
      confidence: 0.8,
      effort: 2,
      strategicRelevance: 1,
      rationale: 'Blocks the other item.',
    });
    const dependent = createBacklogItem({
      title: 'Feature that needs the schema change',
      description: 'Depends on the above.',
      source: 'test',
      category: 'FEATURE_GAP',
      userImpact: 3,
      severity: 2,
      confidence: 0.8,
      effort: 2,
      strategicRelevance: 3,
      rationale: 'Wanted next.',
      dependencies: [dependency.id],
    });

    const plan: LeadPlan = { ...emptyPlan, selectedItemId: dependent.id, selectionRationale: 'Highest priority.' };
    const result = await runLeadPlanning({ invoker: leadInvoker(plan), cycleId: 'cyc_test4', signals: [] });

    expect(result.selected).toBeUndefined();
    expect(getBacklogItem(dependent.id)?.status).toBe('BLOCKED');
  });

  it('an invalid/unknown selectedItemId resolves to no selection, without crashing the cycle', async () => {
    const plan: LeadPlan = { ...emptyPlan, selectedItemId: 'bl_does_not_exist', selectionRationale: 'Whatever this is.' };
    const result = await runLeadPlanning({ invoker: leadInvoker(plan), cycleId: 'cyc_test5', signals: [] });
    expect(result.selected).toBeUndefined();
    expect(result.selectionNote).toBeDefined();
  });

  it('null selectedItemId is a legitimate "nothing to start" outcome', async () => {
    const result = await runLeadPlanning({ invoker: leadInvoker(emptyPlan), cycleId: 'cyc_test6', signals: [] });
    expect(result.selected).toBeUndefined();
    expect(result.selectionNote).toContain('No candidates observed');
  });

  it('a near-duplicate new candidate is merged into the existing item instead of creating a second row', async () => {
    createBacklogItem({
      title: 'Saved listings page shows a blank empty state',
      description: 'Existing item.',
      source: 'test',
      category: 'BUG',
      userImpact: 2,
      severity: 2,
      confidence: 0.7,
      effort: 1,
      strategicRelevance: 1,
      rationale: 'Already known.',
      evidence: ['original evidence'],
    });

    const plan: LeadPlan = {
      ...emptyPlan,
      newBacklogItems: [
        {
          title: 'Saved listings empty state is blank',
          description: 'Same bug, rediscovered.',
          category: 'BUG',
          evidence: ['new evidence from this cycle'],
          rationale: 'Rediscovered.',
          userImpact: 2,
          severity: 2,
          confidence: 0.7,
          effort: 1,
          strategicRelevance: 1,
          requiresFounderDecision: false,
          requiresLegalReview: false,
          relatedSignalIds: [],
        },
      ],
    };

    const result = await runLeadPlanning({ invoker: leadInvoker(plan), cycleId: 'cyc_test7', signals: [] });
    expect(result.createdItems).toHaveLength(0);
    expect(result.duplicatesAbsorbed).toHaveLength(1);
  });

  it('updatedBacklogItems with mergeIntoId marks the source DUPLICATE and folds evidence into the survivor', async () => {
    const survivor = createBacklogItem({
      title: 'Original item',
      description: 'd',
      source: 'test',
      category: 'BUG',
      userImpact: 1,
      severity: 1,
      confidence: 0.5,
      effort: 1,
      strategicRelevance: 1,
      rationale: 'r',
    });
    const dup = createBacklogItem({
      title: 'Same thing, different words',
      description: 'd2',
      source: 'test',
      category: 'BUG',
      userImpact: 1,
      severity: 1,
      confidence: 0.5,
      effort: 1,
      strategicRelevance: 1,
      rationale: 'r2',
    });

    const plan: LeadPlan = {
      ...emptyPlan,
      updatedBacklogItems: [{ id: dup.id, rationale: 'Same underlying issue.', mergeIntoId: survivor.id }],
    };
    const result = await runLeadPlanning({ invoker: leadInvoker(plan), cycleId: 'cyc_test8', signals: [] });
    expect(result.mergedDuplicates.map((i) => i.id)).toContain(dup.id);
    expect(getBacklogItem(dup.id)?.status).toBe('DUPLICATE');
  });

  it('escalations become persisted PENDING approval requests', async () => {
    const plan: LeadPlan = {
      ...emptyPlan,
      escalations: [
        {
          type: 'FOUNDER_DECISION_REQUIRED',
          title: 'Ambiguous product direction',
          description: 'Two reasonable options, no clear winner.',
          options: ['Option A', 'Option B'],
          recommendation: 'Lean toward Option A.',
        },
      ],
    };
    const result = await runLeadPlanning({ invoker: leadInvoker(plan), cycleId: 'cyc_test9', signals: [] });
    expect(result.approvalRequestIds).toHaveLength(1);
    expect(listApprovalRequests('PENDING').some((r) => r.title === 'Ambiguous product direction')).toBe(true);
  });

  it('an output that fails LeadPlan schema validation falls back to a safe no-op plan instead of throwing', async () => {
    const invoker = leadInvoker({ garbage: true }); // missing every required LeadPlan field
    const result = await runLeadPlanning({ invoker, cycleId: 'cyc_test10', signals: [] });
    expect(result.selected).toBeUndefined();
    expect(result.createdItems).toHaveLength(0);
    expect(result.plan.cycleSummary).toContain('failed schema validation');
  });
});
