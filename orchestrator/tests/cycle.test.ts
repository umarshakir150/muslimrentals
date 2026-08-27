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
import { spawnSync } from 'node:child_process';
import { closeDb, getDb } from '../src/autonomy/db.js';
import { getAutonomyDbPath } from '../src/paths.js';

// See tests/autonomyStores.test.ts for why each autonomy test file needs
// its own DB path when Vitest runs files in parallel.
process.env.ORCHESTRATOR_AUTONOMY_DB = path.join(path.dirname(getAutonomyDbPath()), 'autonomy-cycle.db');
import { ScriptedClaudeInvoker } from '../src/claude/fakeInvoker.js';
import { runCycle } from '../src/autonomy/cycle.js';
import { acquireCycleLock, createCycle, getCycle, updateCycle } from '../src/autonomy/cycleStore.js';

/** A PID guaranteed to no longer be alive — spawnSync blocks until the
 * child has already exited, so by the time it returns, its pid is dead. */
function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '0']).pid ?? 999999;
}
import { getBacklogItem, listAllBacklogItems } from '../src/autonomy/backlogStore.js';
import { listApprovalRequests } from '../src/autonomy/approvalStore.js';
import { scriptedAnalysis, scriptedImplementation, scriptedImplementationWithFiles, scriptedPlan, scriptedReview } from './testUtils.js';
import type { LeadPlan } from '../src/autonomy/types.js';
import { listAutonomyEvents } from '../src/autonomy/eventLog.js';
import type { PushResult, ProductionMergeResult, WorktreeHandle } from '../src/git/worktree.js';
import type { LiveVerificationResult } from '../src/autonomy/liveDeployVerification.js';

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

  it('autoPush=false (the default) never invokes the push function, even on a real COMPLETE', async () => {
    const invoker = new ScriptedClaudeInvoker({
      // Distinct titles per test below (taskId = timestamp + title slug,
      // second-granularity — see src/task/taskId.ts) so two tests reaching
      // real execution in the same wall-clock second never collide on the
      // same worktree path.
      lead: leadSelectsNewCandidate({ title: 'autoPush test: no-op when autoPush is off' }),
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementation(),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });
    let calls = 0;
    const pushBranchFn = async (): Promise<PushResult> => {
      calls += 1;
      return { pushed: true, branch: 'should-not-be-called' };
    };

    const outcome = await runCycle({ invoker, pushBranchFn });

    expect(outcome.execution?.finalState).toBe('COMPLETE');
    expect(calls).toBe(0);
    expect(listAutonomyEvents({ type: 'BRANCH_PUSHED' })).toHaveLength(0);
  });

  it('autoPush=true pushes the reviewed branch exactly once when execution reaches COMPLETE, and records a BRANCH_PUSHED event — the real origin remote is never touched (pushBranchFn is fully injected)', async () => {
    const invoker = new ScriptedClaudeInvoker({
      lead: leadSelectsNewCandidate({ title: 'autoPush test: pushes on COMPLETE' }),
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementation(),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });
    const pushedHandles: WorktreeHandle[] = [];
    const pushBranchFn = async (handle: WorktreeHandle): Promise<PushResult> => {
      pushedHandles.push(handle);
      return { pushed: true, branch: handle.branch };
    };

    const outcome = await runCycle({ invoker, autoPush: true, pushBranchFn });

    expect(outcome.execution?.finalState).toBe('COMPLETE');
    expect(pushedHandles).toHaveLength(1);
    expect(pushedHandles[0]?.branch).toMatch(/^agents\//);
    const events = listAutonomyEvents({ type: 'BRANCH_PUSHED' });
    expect(events).toHaveLength(1);
    expect(events[0]?.message).toContain(pushedHandles[0]?.branch);
  });

  it('autoPush=true does NOT push when execution does not reach COMPLETE (dry_run)', async () => {
    const invoker = new ScriptedClaudeInvoker({
      lead: leadSelectsNewCandidate({ title: 'autoPush test: no push on non-COMPLETE (dry run)' }),
      supervisor: scriptedPlan(['engineering']),
      engineering: scriptedAnalysis('engineering'),
    });
    let calls = 0;
    const pushBranchFn = async (): Promise<PushResult> => {
      calls += 1;
      return { pushed: true, branch: 'should-not-be-called' };
    };

    const outcome = await runCycle({ invoker, mode: 'dry_run', autoPush: true, pushBranchFn });

    expect(outcome.execution?.finalState).toBe('DRY_RUN_COMPLETE');
    expect(calls).toBe(0);
  });

  it('autoPush=true records BRANCH_PUSH_FAILED (not a cycle failure) when the push itself fails, and the cycle still completes with the task marked DONE', async () => {
    const invoker = new ScriptedClaudeInvoker({
      lead: leadSelectsNewCandidate({ title: 'autoPush test: push failure is recorded, not fatal' }),
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementation(),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });
    const pushBranchFn = async (handle: WorktreeHandle): Promise<PushResult> => ({
      pushed: false,
      branch: handle.branch,
      reason: 'simulated rejection — remote branch diverged',
    });

    const outcome = await runCycle({ invoker, autoPush: true, pushBranchFn });

    expect(outcome.cycle?.status).toBe('COMPLETED');
    expect(outcome.execution?.finalState).toBe('COMPLETE');
    const item = getBacklogItem(outcome.leadResult!.selected!.item.id);
    expect(item?.status).toBe('DONE'); // a push failure doesn't undo a reviewed, completed task
    const failEvents = listAutonomyEvents({ type: 'BRANCH_PUSH_FAILED' });
    expect(failEvents).toHaveLength(1);
    expect(failEvents[0]?.message).toContain('simulated rejection');
    expect(listAutonomyEvents({ type: 'BRANCH_PUSHED' })).toHaveLength(0);
  });

  it('autoMergeToProduction never invokes the merge function when the completed task touches no rentals/ files (orchestrator-infra-only change)', async () => {
    const invoker = new ScriptedClaudeInvoker({
      lead: leadSelectsNewCandidate({ title: 'prodMerge test: infra-only change is never deployed' }),
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementationWithFiles({ 'orchestrator/src/some-infra-file.ts': 'export const x = 1;\n' }),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });
    let calls = 0;
    const mergeToProductionFn = async (): Promise<ProductionMergeResult> => {
      calls += 1;
      return { merged: true, pushed: true, productionSha: 'deadbeef' };
    };

    const outcome = await runCycle({ invoker, autoPush: true, pushBranchFn: async (h) => ({ pushed: true, branch: h.branch }), autoMergeToProduction: true, mergeToProductionFn });

    expect(outcome.execution?.finalState).toBe('COMPLETE');
    expect(calls).toBe(0);
    expect(listAutonomyEvents({ type: 'PRODUCTION_MERGED' })).toHaveLength(0);
  });

  it('autoMergeToProduction skips a schema-changing branch and files a DESTRUCTIVE_ACTION_APPROVAL_REQUIRED instead of deploying it', async () => {
    const invoker = new ScriptedClaudeInvoker({
      lead: leadSelectsNewCandidate({ title: 'prodMerge test: schema change is never auto-deployed' }),
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementationWithFiles({ 'rentals/backend/prisma/schema.prisma': 'model X { id String @id }\n' }),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });
    let calls = 0;
    const mergeToProductionFn = async (): Promise<ProductionMergeResult> => {
      calls += 1;
      return { merged: true, pushed: true, productionSha: 'deadbeef' };
    };

    const outcome = await runCycle({ invoker, autoPush: true, pushBranchFn: async (h) => ({ pushed: true, branch: h.branch }), autoMergeToProduction: true, mergeToProductionFn });

    expect(outcome.execution?.finalState).toBe('COMPLETE');
    expect(calls).toBe(0); // never even attempted a production merge
    expect(listAutonomyEvents({ type: 'PRODUCTION_MERGE_SKIPPED' })).toHaveLength(1);
    const approvals = listApprovalRequests('PENDING');
    expect(approvals.some((a) => a.type === 'DESTRUCTIVE_ACTION_APPROVAL_REQUIRED')).toBe(true);
  });

  it('autoMergeToProduction merges and pushes a real product change, recording PRODUCTION_MERGED with the production sha', async () => {
    const invoker = new ScriptedClaudeInvoker({
      // Deliberately avoids the word "deploy(s)" in the title/rationale —
      // that bare keyword trips the founder-gate's production_deployment
      // pattern (see ai/decisions.md's false-positive writeup) and would
      // make the Lead correctly refuse to select this as HIGH risk,
      // exactly like the real bl_a29a729f incident this session found.
      lead: leadSelectsNewCandidate({ title: 'prodMerge test: a real safe product change is merged and pushed' }),
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementationWithFiles({ 'rentals/frontend/src/app/example/page.tsx': 'export default function P() { return null; }\n' }),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });
    const mergeCalls: Array<{ source: string; production: string }> = [];
    const mergeToProductionFn = async (source: string, production: string): Promise<ProductionMergeResult> => {
      mergeCalls.push({ source, production });
      return { merged: true, pushed: true, productionSha: 'cafef00d' };
    };

    const outcome = await runCycle({
      invoker,
      autoPush: true,
      pushBranchFn: async (h) => ({ pushed: true, branch: h.branch }),
      autoMergeToProduction: true,
      productionBranch: 'main',
      mergeToProductionFn,
    });

    expect(outcome.execution?.finalState).toBe('COMPLETE');
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0]?.production).toBe('main');
    const events = listAutonomyEvents({ type: 'PRODUCTION_MERGED' });
    expect(events).toHaveLength(1);
    expect(events[0]?.message).toContain('cafef00d');
  });

  it('a failed/conflicted production merge records PRODUCTION_MERGE_CONFLICT or PRODUCTION_MERGE_FAILED and files a RECOVERY_REQUIRED approval, never force-pushed', async () => {
    const invoker = new ScriptedClaudeInvoker({
      lead: leadSelectsNewCandidate({ title: 'prodMerge test: a real merge conflict is reported, not forced' }),
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementationWithFiles({ 'rentals/frontend/src/app/example2/page.tsx': 'export default function P() { return null; }\n' }),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });
    const mergeToProductionFn = async (): Promise<ProductionMergeResult> => ({
      merged: false,
      pushed: false,
      conflictedFiles: ['rentals/frontend/src/app/example2/page.tsx'],
      reason: 'Real merge conflict against production — not auto-resolved, needs founder/human attention.',
    });

    const outcome = await runCycle({ invoker, autoPush: true, pushBranchFn: async (h) => ({ pushed: true, branch: h.branch }), autoMergeToProduction: true, mergeToProductionFn });

    expect(outcome.execution?.finalState).toBe('COMPLETE');
    const conflictEvents = listAutonomyEvents({ type: 'PRODUCTION_MERGE_CONFLICT' });
    expect(conflictEvents).toHaveLength(1);
    expect(listAutonomyEvents({ type: 'PRODUCTION_MERGED' })).toHaveLength(0);
    const approvals = listApprovalRequests('PENDING');
    expect(approvals.some((a) => a.type === 'RECOVERY_REQUIRED')).toBe(true);
  });

  it('live verification: an unreachable live site is recorded as LIVE_VERIFICATION_UNREACHABLE, never treated as a regression (no approval filed)', async () => {
    const invoker = new ScriptedClaudeInvoker({
      lead: leadSelectsNewCandidate({ title: 'prodMerge test: unreachable live site is not a regression' }),
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementationWithFiles({ 'rentals/frontend/src/app/example3/page.tsx': 'export default function P() { return null; }\n' }),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });
    const mergeToProductionFn = async (): Promise<ProductionMergeResult> => ({ merged: true, pushed: true, productionSha: 'abc123' });
    const verifyLiveDeployFn = async (): Promise<LiveVerificationResult> => ({
      verified: false,
      reachable: false,
      summary: 'Could not run the live verification check at all: network egress blocked.',
      findings: [],
    });

    const outcome = await runCycle({
      invoker,
      autoPush: true,
      pushBranchFn: async (h) => ({ pushed: true, branch: h.branch }),
      autoMergeToProduction: true,
      mergeToProductionFn,
      verifyLiveDeployAfterProductionMerge: true,
      verifyLiveDeployFn,
    });

    expect(outcome.execution?.finalState).toBe('COMPLETE');
    expect(listAutonomyEvents({ type: 'LIVE_VERIFICATION_UNREACHABLE' })).toHaveLength(1);
    expect(listAutonomyEvents({ type: 'LIVE_VERIFICATION_FAILED' })).toHaveLength(0);
    const approvals = listApprovalRequests('PENDING');
    expect(approvals.some((a) => a.title.includes('Live regression'))).toBe(false);
  });

  it('live verification: a reachable-but-broken live site is recorded as LIVE_VERIFICATION_FAILED and files a RECOVERY_REQUIRED approval', async () => {
    const invoker = new ScriptedClaudeInvoker({
      lead: leadSelectsNewCandidate({ title: 'prodMerge test: a real live regression is a real finding' }),
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementationWithFiles({ 'rentals/frontend/src/app/example4/page.tsx': 'export default function P() { return null; }\n' }),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });
    const mergeToProductionFn = async (): Promise<ProductionMergeResult> => ({ merged: true, pushed: true, productionSha: 'def456' });
    const verifyLiveDeployFn = async (): Promise<LiveVerificationResult> => ({
      verified: false,
      reachable: true,
      summary: 'REACHABLE — the new page returns a 500 error.',
      findings: ['GET /example4 returns HTTP 500'],
    });

    const outcome = await runCycle({
      invoker,
      autoPush: true,
      pushBranchFn: async (h) => ({ pushed: true, branch: h.branch }),
      autoMergeToProduction: true,
      mergeToProductionFn,
      verifyLiveDeployAfterProductionMerge: true,
      verifyLiveDeployFn,
    });

    expect(outcome.execution?.finalState).toBe('COMPLETE');
    expect(listAutonomyEvents({ type: 'LIVE_VERIFICATION_FAILED' })).toHaveLength(1);
    const approvals = listApprovalRequests('PENDING');
    const found = approvals.find((a) => a.title.includes('Live regression'));
    expect(found).toBeDefined();
    expect(found?.type).toBe('RECOVERY_REQUIRED');
    expect(found?.description).toContain('500');
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
    // Faithfully simulate a real crash: BOTH the cycle row is left
    // non-terminal AND the lock is left held, by a PID that is actually
    // dead — not just the cycle row alone. An earlier version of this test
    // only did the former, which passed by accident (getInterruptedCycle()
    // alone was enough at the time) and masked a real gap: isLockStale()
    // used to only treat a lock as stale once the cycle it pointed at was
    // already terminal, which a genuine crash — by definition — never
    // reaches on its own. That gap was only caught by a real kill -9
    // against a real running cycle (see the PART 21 demonstration), not by
    // this suite, precisely because this test wasn't simulating the lock
    // half of a real crash. It does now.
    const crashed = createCycle();
    updateCycle(crashed.id, { status: 'EXECUTING' });
    acquireCycleLock(crashed.id);
    getDb().prepare("UPDATE cycle_lock SET locked_by_pid = ? WHERE id = 'lock'").run(deadPid());

    const invoker = new ScriptedClaudeInvoker({ lead: emptyPlan });
    const outcome = await runCycle({ invoker });

    expect(getCycle(crashed.id)?.status).toBe('FAILED');
    expect(getCycle(crashed.id)?.result).toBe('recovery_marked_incomplete');
    expect(getCycle(crashed.id)?.tasksCreated).toEqual([]); // nothing was fabricated for it

    expect(outcome.skippedReason).toBeUndefined();
    expect(outcome.cycle?.id).not.toBe(crashed.id);
    expect(outcome.cycle?.status).toBe('COMPLETED');
  });

  it('does NOT treat a lock held by a still-alive process as stale, even if its cycle is non-terminal — a genuinely concurrent run must be left alone, not barged into', async () => {
    const stillRunning = createCycle();
    updateCycle(stillRunning.id, { status: 'EXECUTING' });
    acquireCycleLock(stillRunning.id); // acquired by THIS test process — very much alive

    const invoker = new ScriptedClaudeInvoker({ lead: emptyPlan });
    const outcome = await runCycle({ invoker });
    expect(outcome.skippedReason).toBe('ANOTHER_CYCLE_RUNNING');
    expect(getCycle(stillRunning.id)?.status).toBe('EXECUTING'); // untouched — never barged into
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
