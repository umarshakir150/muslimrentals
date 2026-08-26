/**
 * End-to-end bounded-cycle tests (PART 22/23) — these are the tests that
 * actually prove the autonomy layer CALLS the existing execution engine
 * rather than reimplementing it: runCycle() here drives the real
 * runTask() (src/supervisor/orchestrator.ts), with only the Claude calls
 * scripted (ScriptedClaudeInvoker — same fake tests/orchestrator.test.ts
 * uses), so QA/Security/the founder gate/worktree isolation all really run.
 *
 * Worktree cleanup: unlike tests/orchestrator.test.ts, these tests don't
 * track/remove the worktrees runTask() creates via cycle.ts, because
 * CycleOutcome deliberately doesn't expose RunResult's internals (see
 * cycle.ts) — leaving that out of the autonomy layer's public return shape
 * on purpose, since callers (the scheduler, the CLI) have no legitimate
 * reason to reach into worktree handles. ORCHESTRATOR_WORKTREES_DIR is
 * already a scratch directory wiped by tests/globalSetup.ts at the start
 * of the whole suite, so leftover worktrees here cost disk, not
 * correctness.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/autonomy/db.js';
import { getAutonomyDbPath } from '../src/paths.js';

// See tests/autonomyStores.test.ts for why each autonomy test file needs
// its own DB path when Vitest runs files in parallel.
process.env.ORCHESTRATOR_AUTONOMY_DB = path.join(path.dirname(getAutonomyDbPath()), 'autonomy-cycle.db');
import { ScriptedClaudeInvoker } from '../src/claude/fakeInvoker.js';
import { runCycle } from '../src/autonomy/cycle.js';
import { createCycle, getCycle, updateCycle } from '../src/autonomy/cycleStore.js';
import { getBacklogItem, listAllBacklogItems } from '../src/autonomy/backlogStore.js';
import { listApprovalRequests } from '../src/autonomy/approvalStore.js';
import { scriptedAnalysis, scriptedImplementation, scriptedPlan, scriptedReview } from './testUtils.js';
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

const emptyPlan: LeadPlan = {
  cycleSummary: 'Nothing worth doing this cycle.',
  newBacklogItems: [],
  updatedBacklogItems: [],
  selectedItemId: null,
  selectionRationale: 'No eligible candidates.',
  escalations: [],
};

function leadSelectsNewCandidate(overrides: Partial<LeadPlan['newBacklogItems'][number]> = {}): LeadPlan {
  return {
    cycleSummary: 'Found one small, safe fix worth doing now.',
    newBacklogItems: [
      {
        title: 'Add a loading spinner to the listing filters panel',
        description: 'The filters panel has no loading indicator while results refresh.',
        category: 'UX',
        evidence: ['manual inspection of the filters panel'],
        rationale: 'Small, safe, well-understood UX gap.',
        userImpact: 2,
        severity: 1,
        confidence: 0.8,
        effort: 1,
        strategicRelevance: 1,
        requiresFounderDecision: false,
        requiresLegalReview: false,
        relatedSignalIds: [],
        ...overrides,
      },
    ],
    updatedBacklogItems: [],
    selectedItemId: 'new:0',
    selectionRationale: 'Highest-value safe item available this cycle.',
    escalations: [],
  };
}

describe('runCycle — end to end (real execution engine, scripted Claude)', () => {
  it('selects its own candidate, runs it through the REAL orchestrator (specialists, implementer, QA, Security), completes, and marks the backlog item DONE + linked', async () => {
    const invoker = new ScriptedClaudeInvoker({
      lead: leadSelectsNewCandidate(),
      supervisor: scriptedPlan(['designer', 'engineering', 'qa', 'security']),
      designer: scriptedAnalysis('designer'),
      engineering: scriptedImplementation(),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });

    const outcome = await runCycle({ invoker });

    expect(outcome.skippedReason).toBeUndefined();
    expect(outcome.cycle?.status).toBe('COMPLETED');
    expect(outcome.execution?.finalState).toBe('COMPLETE');
    expect(outcome.leadResult?.selected).toBeDefined();

    const item = getBacklogItem(outcome.leadResult!.selected!.item.id);
    expect(item?.status).toBe('DONE');
    expect(item?.relatedTasks).toContain(outcome.execution?.taskId);

    // Proves QA and Security really ran as part of this — not bypassed.
    expect(invoker.callsFor('qa')).toHaveLength(1);
    expect(invoker.callsFor('security')).toHaveLength(1);
  });

  it('an empty backlog and no signals still terminates cleanly with no selection and no execution call', async () => {
    const invoker = new ScriptedClaudeInvoker({ lead: emptyPlan });
    const outcome = await runCycle({ invoker });

    expect(outcome.cycle?.status).toBe('COMPLETED');
    expect(outcome.execution).toBeUndefined();
    expect(outcome.leadResult?.selected).toBeUndefined();
    expect(invoker.callsFor('supervisor')).toHaveLength(0);
  });

  it("the execution engine's OWN founder-approval gate firing mid-task (independent of the Lead's own risk read) is surfaced as a persisted approval request, and the backlog item is blocked, not marked DONE", async () => {
    // Lead itself sees nothing risky in the text (LOW/MEDIUM), but the
    // Supervisor's own judgment (scripted here, simulating a real model
    // catching something keyword-matching alone would miss) flags founder
    // approval as required — proving the execution engine's existing gate
    // still fires and is never silently skipped by the autonomy layer.
    const invoker = new ScriptedClaudeInvoker({
      lead: leadSelectsNewCandidate(),
      supervisor: scriptedPlan(['engineering', 'qa', 'security'], { founderApprovalRequired: true, reasons: ['Supervisor judgment: touches a sensitive area.'] }),
    });

    const outcome = await runCycle({ invoker });

    expect(outcome.execution?.finalState).toBe('FOUNDER_APPROVAL_REQUIRED');
    const item = getBacklogItem(outcome.leadResult!.selected!.item.id);
    expect(item?.status).toBe('APPROVAL_REQUIRED');
    expect(item?.status).not.toBe('DONE');
    const approvals = listApprovalRequests('PENDING');
    expect(approvals.some((a) => a.taskId === outcome.execution?.taskId)).toBe(true);
  });

  it('execution that does not reach COMPLETE (dry_run mode — the one currently-reachable non-COMPLETE, non-founder-gate terminal state) leaves the backlog item BLOCKED, never DONE', async () => {
    // ABORTED exists in the schema but is not yet reachable anywhere in
    // the execution engine today (verified: no code path sets it) — using
    // mode: 'dry_run' exercises the same "not COMPLETE, not
    // FOUNDER_APPROVAL_REQUIRED" branch in cycle.ts honestly, with a real
    // reachable finalState (DRY_RUN_COMPLETE) instead of fabricating one.
    const invoker = new ScriptedClaudeInvoker({
      lead: leadSelectsNewCandidate(),
      supervisor: scriptedPlan(['engineering']),
      engineering: scriptedAnalysis('engineering'),
    });

    const outcome = await runCycle({ invoker, mode: 'dry_run' });

    expect(outcome.execution?.finalState).toBe('DRY_RUN_COMPLETE');
    const item = getBacklogItem(outcome.leadResult!.selected!.item.id);
    expect(item?.status).toBe('BLOCKED');
    expect(item?.status).not.toBe('DONE');
  });

  it('a model-call budget of 0 skips the Lead call entirely and fails the cycle safely, without ever calling Claude', async () => {
    const invoker = new ScriptedClaudeInvoker({
      lead: () => {
        throw new Error('Lead must never be called when the budget is already exhausted.');
      },
    });
    const outcome = await runCycle({ invoker, maxModelCallsPerCycle: 0 });
    expect(outcome.cycle?.status).toBe('FAILED');
    expect(outcome.cycle?.result).toBe('model_call_budget_exhausted');
  });

  it('the cycle lock prevents a second overlapping runCycle call — it is skipped, not queued or duplicated', async () => {
    const slowInvoker = new ScriptedClaudeInvoker({ lead: emptyPlan }, () => 60);
    const first = runCycle({ invoker: slowInvoker });
    // Give the first call time to acquire the lock before the second starts.
    await new Promise((r) => setTimeout(r, 10));
    const second = await runCycle({ invoker: new ScriptedClaudeInvoker({ lead: emptyPlan }) });
    expect(second.skippedReason).toBe('ANOTHER_CYCLE_RUNNING');
    const firstResult = await first;
    expect(firstResult.cycle?.status).toBe('COMPLETED');
  });

  it('detects a cycle left interrupted by a crashed process, marks it FAILED for visibility, and still runs a normal new cycle without duplicating any work', async () => {
    const crashed = createCycle();
    updateCycle(crashed.id, { status: 'EXECUTING' }); // simulate the process dying mid-cycle

    const invoker = new ScriptedClaudeInvoker({ lead: emptyPlan });
    const outcome = await runCycle({ invoker });

    expect(getCycle(crashed.id)?.status).toBe('FAILED');
    expect(getCycle(crashed.id)?.result).toBe('recovery_marked_incomplete');
    expect(getCycle(crashed.id)?.tasksCreated).toEqual([]); // nothing was fabricated for it

    expect(outcome.cycle?.id).not.toBe(crashed.id);
    expect(outcome.cycle?.status).toBe('COMPLETED');
  });

  it('a stale held lock (pointing at an already-terminal cycle) is cleared automatically rather than blocking forever', async () => {
    const stale = createCycle();
    updateCycle(stale.id, { status: 'FAILED', completedAt: new Date().toISOString() });
    const { acquireCycleLock } = await import('../src/autonomy/cycleStore.js');
    acquireCycleLock(stale.id); // simulate a lock left behind without a matching release

    const invoker = new ScriptedClaudeInvoker({ lead: emptyPlan });
    const outcome = await runCycle({ invoker });
    expect(outcome.skippedReason).toBeUndefined();
    expect(outcome.cycle?.status).toBe('COMPLETED');
  });

  it('newly-created backlog items are never auto-selected within the SAME cycle that created them beyond the one structural selection — findings become candidates first, not immediate recursive execution', async () => {
    // The Lead itself can only ever name a single selectedItemId (schema:
    // a nullable string, not an array) — this test proves that even when
    // several high-value new candidates are proposed in one cycle, at most
    // one is ever actually started, and the rest remain CANDIDATE for a
    // future cycle to evaluate.
    // Deliberately unrelated titles/wording — near-identical titles would
    // legitimately trigger the Jaccard dedup check tested elsewhere
    // (tests/leadPlanning.test.ts), which is not what this test is about.
    const titles = ['Add pagination to the roommate browse page', 'Fix a typo in the footer copyright year', 'Improve error logging in the messages route'];
    const plan: LeadPlan = {
      cycleSummary: 'Found three unrelated things; only starting the best one.',
      newBacklogItems: titles.map((title) => ({
        title,
        description: 'desc',
        category: 'TECH_DEBT' as const,
        evidence: ['evidence'],
        rationale: 'rationale',
        userImpact: 1,
        severity: 1,
        confidence: 0.5,
        effort: 1,
        strategicRelevance: 1,
        requiresFounderDecision: false,
        requiresLegalReview: false,
        relatedSignalIds: [],
      })),
      updatedBacklogItems: [],
      selectedItemId: 'new:0',
      selectionRationale: 'Best of the three.',
      escalations: [],
    };
    const invoker = new ScriptedClaudeInvoker({
      lead: plan,
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementation(),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });

    const outcome = await runCycle({ invoker });
    expect(outcome.leadResult?.createdItems).toHaveLength(3);
    const statuses = listAllBacklogItems().map((i) => i.status);
    expect(statuses.filter((s) => s === 'IN_PROGRESS' || s === 'DONE' || s === 'SELECTED')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'CANDIDATE')).toHaveLength(2);
  });
});
