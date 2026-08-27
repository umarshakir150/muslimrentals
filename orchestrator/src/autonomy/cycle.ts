/**
 * The bounded autonomous cycle — PART 7. ONE call to runCycle() is ONE
 * finite cycle: it observes, plans, selects at most one item, hands it to
 * the EXISTING execution engine (runTask() in ../supervisor/orchestrator.js
 * — never reimplemented here), persists the outcome, and returns. It never
 * self-reschedules; src/autonomy/scheduler.ts is the (deliberately dumb)
 * layer that decides *when* to call this again.
 *
 * Lifecycle (matches PART 7's 19 numbered steps):
 *   1-2. acquire cycle lock / restore persistent state — cycleStore.ts's
 *        lock + an interrupted-cycle check (crash recovery, PART 21), plus
 *        workerRegistry.ts's cleanupOrphanedWorkers() — a crashed PREVIOUS
 *        process can leave a real OS worker process running with no
 *        in-memory record of it anywhere; this is what finds and reaps it
 *        before any new work begins.
 *   3-4. load standing objective, inspect previous cycle.
 *   5.   gather signals — signalSources.ts (+ optional deep sources).
 *   6-9. update/dedupe backlog, reprioritize, choose <=1 item, classify
 *        risk — all inside lead.ts (runLeadPlanning), which structurally
 *        can only ever return zero or one selection and always
 *        re-classifies risk deterministically before allowing selection.
 *   10.  stop/escalate founder-approval items — also inside lead.ts.
 *   11-13. hand eligible work to the existing orchestrator (runTask()),
 *        let it run its own specialists/implementers/reviewers/Integrator,
 *        receive the RunResult. A cycle timeout here (CycleTimeoutError)
 *        or a worker timeout inside any individual call (WorkerTimeoutError,
 *        claudeAdapter.ts) both terminate the underlying process(es), not
 *        just the logical wait — see the `finally` block below.
 *   14-16. update backlog + memory + persist the cycle/event record.
 *   17.  generate a cycle summary (AutonomousCycle.summary).
 *   18-19. terminate any worker process this cycle still owns
 *        (invoker.killAll()), release the lock, return.
 */
import { WorkerTimeoutError, type ClaudeInvoker } from '../claude/claudeAdapter.js';
import { runTask } from '../supervisor/orchestrator.js';
import { getStandingObjective } from './objective.js';
import { DEFAULT_SIGNAL_SOURCES } from './signalSources.js';
import { deepSignalSource } from './deepSignalSource.js';
import { liveSiteSignalSource } from './liveSiteSignalSource.js';
import { recordSignal } from './signalStore.js';
import { runLeadPlanning, type LeadPlanningResult } from './lead.js';
import { updateBacklogItem, linkBacklogItemToTask } from './backlogStore.js';
import { recordMemory } from './memoryStore.js';
import { createApprovalRequest } from './approvalStore.js';
import { logAutonomyEvent } from './eventLog.js';
import { nowIso } from './ids.js';
import { cleanupOrphanedWorkers } from './workerRegistry.js';
import {
  acquireCycleLock,
  createCycle,
  getCycleLock,
  getInterruptedCycle,
  getLatestCycle,
  isLockStale,
  releaseCycleLock,
  updateCycle,
} from './cycleStore.js';
import type { AutonomousCycle, Signal } from './types.js';
import { pushBranch as realPushBranch, mergeToProductionBranch as realMergeToProductionBranch, type PushResult, type ProductionMergeResult, type WorktreeHandle } from '../git/worktree.js';
import { verifyLiveDeploy as realVerifyLiveDeploy, type LiveVerificationResult } from './liveDeployVerification.js';

export const DEFAULT_MAX_MODEL_CALLS_PER_CYCLE = 5;
export const DEFAULT_CYCLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — generous default for a real full task run
/** Per-worker (single claude CLI call) timeout — deliberately shorter than
 * DEFAULT_CYCLE_TIMEOUT_MS: a cycle can involve several sequential/
 * concurrent worker calls (specialists, implementer(s), QA, Security,
 * Integrator), so the cycle-level bound is the ceiling on the whole
 * execution phase while this bounds any ONE call within it from hanging
 * indefinitely. 20 minutes is generous relative to real observed worker
 * durations (the heaviest real calls — an implementer running a genuine
 * `npm install` — took 6-9 minutes in practice) while still catching a
 * genuinely stuck process well before it could exhaust the cycle budget
 * on its own. Callers that construct their own invoker (e.g.
 * autonomyCli.ts, for real cycle/scheduler-loop runs) are expected to pass
 * this as CliClaudeInvokerOptions.defaultTimeoutMs; nothing in cycle.ts
 * itself enforces it directly, since the timeout has to live at the point
 * that actually owns the OS process (claudeAdapter.ts). */
export const DEFAULT_WORKER_TIMEOUT_MS = 20 * 60 * 1000;

export interface RunCycleOptions {
  invoker: ClaudeInvoker;
  /** Execution mode handed to the existing orchestrator for the selected
   * item. Defaults to 'full' — a real autonomous cycle is expected to
   * actually implement, review, and integrate (PART 23), not merely plan. */
  mode?: 'dry_run' | 'full';
  /** Opt-in Designer/Security "deep" signal source — costs two real Claude
   * calls, so off by default (PART 2). */
  includeDeepSignals?: boolean;
  /** Opt-in QA pass against the real published site
   * (https://muslimrentals.netlify.app/) — costs one real Claude call plus
   * real WebFetch requests, so off by default (ai/operating-directive.md
   * "Live product as a signal source"). */
  includeLiveSiteSignal?: boolean;
  /** Push the reviewed branch to `origin` once execution reaches COMPLETE
   * (ai/operating-directive.md "Autonomous commit + push authority") —
   * never main/master, only the task-scoped `agents/<taskId>/...` branch
   * runTask() already produced and had reviewed. Off by default here;
   * autonomyCli.ts turns this on specifically for `cycle`/`scheduler-loop`
   * real autonomous runs, not the ad-hoc single-task CLI. */
  autoPush?: boolean;
  /** Injectable so tests can assert push *decisions* without ever touching
   * the real `origin` remote. Defaults to the real git push. */
  pushBranchFn?: (handle: WorktreeHandle) => Promise<PushResult>;
  /** After a COMPLETE task's branch is pushed, also merge it into the real
   * production branch and push that (non-force) — see
   * ai/operating-directive.md "Production deploy policy". Only applies
   * when the task actually changed something under `rentals/` (product
   * code); a Prisma schema/migration change is deliberately never
   * auto-merged — it needs a human to apply the migration against the
   * real production database first. Off by default here; on by default
   * for real autonomous runs via autonomyCli.ts. */
  autoMergeToProduction?: boolean;
  /** Defaults to 'main'. */
  productionBranch?: string;
  /** Injectable so tests never touch the real production branch. */
  mergeToProductionFn?: (sourceBranch: string, productionBranch: string) => Promise<ProductionMergeResult>;
  /** After a successful production merge, run one bounded live-site check
   * (agents/qa.md "Live product review") confirming the change is
   * actually live. Off by default — costs a real Claude call plus a real
   * network fetch that may simply be unreachable in a given environment
   * (see orchestrator/README.md "Production deploy policy"). */
  verifyLiveDeployAfterProductionMerge?: boolean;
  /** Injectable so tests never make a real network call. */
  verifyLiveDeployFn?: (invoker: ClaudeInvoker, whatChanged: string, productionSha: string) => Promise<LiveVerificationResult>;
  maxAgentsPerTask?: number;
  maxRetryCycles?: number;
  maxConcurrency?: number;
  maxModelCallsPerCycle?: number;
  cycleTimeoutMs?: number;
}

export interface CycleExecutionOutcome {
  taskId: string;
  finalState: string;
}

export interface CycleOutcome {
  /** Set when this invocation did nothing because another cycle already
   * holds the lock — the correct, safe response to an overlapping call,
   * not an error. */
  skippedReason?: 'ANOTHER_CYCLE_RUNNING';
  cycle?: AutonomousCycle;
  leadResult?: LeadPlanningResult;
  execution?: CycleExecutionOutcome;
}

/** Thrown when the execution phase (runTask()) exceeds its configured
 * cycle timeout. Distinct from WorkerTimeoutError (claudeAdapter.ts,
 * one worker call) — a cycle timeout can fire even if every individual
 * worker call is well within ITS OWN timeout, simply because enough of
 * them ran (sequentially or across correction cycles) to exceed the
 * cycle's total budget. */
export class CycleTimeoutError extends Error {
  constructor(
    public readonly ms: number,
    public readonly label: string
  ) {
    super(`Timed out after ${ms}ms waiting for ${label}.`);
    this.name = 'CycleTimeoutError';
  }
}

/**
 * Races `promise` against a timeout. A bare `Promise.race` only abandons
 * interest in the loser — it does NOT cancel whatever the loser was
 * actually doing, which used to mean a cycle timeout left runTask() (and
 * any worker process it had spawned) running indefinitely in the
 * background even after this function had already returned control to the
 * caller with a timeout error. Callers are expected to actually terminate
 * the underlying work once they see a CycleTimeoutError — see cycle.ts's
 * `finally` block, which unconditionally calls `invoker.killAll()` so this
 * is true no matter which branch a cycle exits through, not only the
 * explicit timeout path.
 *
 * `promise.catch(() => {})` below exists only to prevent Node's
 * unhandledRejection warning/crash when `promise` eventually settles on
 * its own after already losing the race (e.g. once its worker process has
 * been terminated and its own invoke() call rejects) — it does not change
 * what the race itself resolves to, since Promise.race already committed
 * to the first settlement by the time this attaches a second, independent
 * listener to the same promise.
 */
function raceWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CycleTimeoutError(ms, label)), ms);
  });
  const result = Promise.race([promise, timeout]);
  promise.catch(() => {});
  return result.finally(() => clearTimeout(timer));
}

/**
 * ai/operating-directive.md "Production deploy policy": once a task's
 * branch has been pushed (already reviewed — QA PASS, Security APPROVED,
 * and it never reached COMPLETE at all if it matched a CLAUDE.md
 * founder-authority category), also merge it into the real production
 * branch so the live Netlify deploy actually picks it up — unless it's not
 * a product change at all (nothing under rentals/ — pure orchestrator/docs
 * work has nothing to deploy) or it touches the Prisma schema/migrations,
 * which always needs a human to actually apply the migration against the
 * real production database first; auto-merging code that expects an
 * unapplied schema change risks crashing the live backend for everyone,
 * not just users of the new feature.
 */
async function attemptProductionMerge(
  options: RunCycleOptions,
  cycleId: string,
  item: { id: string; title: string },
  runResult: { taskId: string; finalReport: { filesChanged: string[] } },
  sourceBranch: string
): Promise<void> {
  const filesChanged = runResult.finalReport.filesChanged;
  if (!filesChanged.some((f) => f.startsWith('rentals/'))) return; // nothing product-facing to deploy

  const productionBranch = options.productionBranch ?? 'main';

  if (filesChanged.some((f) => f.includes('prisma/schema.prisma') || f.includes('prisma/migrations/'))) {
    logAutonomyEvent({
      type: 'PRODUCTION_MERGE_SKIPPED',
      cycleId,
      backlogItemId: item.id,
      taskId: runResult.taskId,
      message: `"${item.title}" changes the Prisma schema/migrations — not auto-merged to production. A human needs to apply the migration against the real production database first, then merge manually.`,
    });
    createApprovalRequest({
      type: 'DESTRUCTIVE_ACTION_APPROVAL_REQUIRED',
      title: `Schema-changing branch ready but not auto-deployed: ${item.title}`,
      description: `"${item.title}" (ai/tasks/${runResult.taskId}) passed review and was pushed to "${sourceBranch}", but it changes the database schema, so it was NOT auto-merged into production ("${productionBranch}"). Apply the migration against the real production database, then merge this branch manually.`,
      backlogItemId: item.id,
      cycleId,
      taskId: runResult.taskId,
    });
    return;
  }

  const merge = await (options.mergeToProductionFn ?? realMergeToProductionBranch)(sourceBranch, productionBranch);
  if (!merge.pushed) {
    logAutonomyEvent({
      type: merge.conflictedFiles ? 'PRODUCTION_MERGE_CONFLICT' : 'PRODUCTION_MERGE_FAILED',
      cycleId,
      backlogItemId: item.id,
      taskId: runResult.taskId,
      message: `Production merge of "${item.title}" into "${productionBranch}" did not complete: ${merge.reason ?? 'unknown reason'}`,
    });
    createApprovalRequest({
      type: 'RECOVERY_REQUIRED',
      title: `Production merge failed: ${item.title}`,
      description: `Attempted to merge ai/tasks/${runResult.taskId}'s reviewed branch ("${sourceBranch}") into production ("${productionBranch}") but it failed: ${merge.reason ?? 'unknown reason'}${merge.conflictedFiles?.length ? ` Conflicted files: ${merge.conflictedFiles.join(', ')}.` : ''}`,
      backlogItemId: item.id,
      cycleId,
      taskId: runResult.taskId,
    });
    return;
  }

  logAutonomyEvent({
    type: 'PRODUCTION_MERGED',
    cycleId,
    backlogItemId: item.id,
    taskId: runResult.taskId,
    message: `Merged "${item.title}" into production branch "${productionBranch}" at ${merge.productionSha}.`,
  });

  if (!options.verifyLiveDeployAfterProductionMerge) return;

  const verify = await (options.verifyLiveDeployFn ?? realVerifyLiveDeploy)(options.invoker, item.title, merge.productionSha as string);
  if (!verify.reachable) {
    logAutonomyEvent({
      type: 'LIVE_VERIFICATION_UNREACHABLE',
      cycleId,
      backlogItemId: item.id,
      taskId: runResult.taskId,
      message: `Could not reach the live site to verify "${item.title}" after production merge — not treated as a regression: ${verify.summary}`,
    });
  } else if (verify.verified) {
    logAutonomyEvent({
      type: 'LIVE_VERIFICATION_PASSED',
      cycleId,
      backlogItemId: item.id,
      taskId: runResult.taskId,
      message: `Confirmed "${item.title}" is live and working: ${verify.summary}`,
    });
  } else {
    logAutonomyEvent({
      type: 'LIVE_VERIFICATION_FAILED',
      cycleId,
      backlogItemId: item.id,
      taskId: runResult.taskId,
      message: `Live site was reachable but did not confirm "${item.title}" is working: ${verify.summary}`,
    });
    createApprovalRequest({
      type: 'RECOVERY_REQUIRED',
      title: `Live regression after production deploy: ${item.title}`,
      description: `After merging ai/tasks/${runResult.taskId} into production (${merge.productionSha}), live verification found a real problem: ${[verify.summary, ...verify.findings].join(' | ')}`,
      backlogItemId: item.id,
      cycleId,
      taskId: runResult.taskId,
    });
  }
}

/** Runs exactly one bounded autonomous cycle and returns. Never throws for
 * an ordinary in-cycle failure (a bad Lead response, a failed task
 * execution, a budget limit) — those are all persisted as a FAILED or
 * COMPLETED-with-a-failure-result cycle instead, so a caller (the
 * scheduler, a CLI command) never has to wrap this in its own try/catch to
 * stay alive. Only a truly unexpected error (e.g. the SQLite file itself
 * became unwritable) can still throw. */
export async function runCycle(options: RunCycleOptions): Promise<CycleOutcome> {
  if (isLockStale()) {
    releaseCycleLock();
    logAutonomyEvent({ type: 'CYCLE_FAILED', message: 'Cleared a stale cycle lock left by a previous process (crash, restart, or container recycle).' });
  }
  if (getCycleLock().locked) {
    return { skippedReason: 'ANOTHER_CYCLE_RUNNING' };
  }

  const interrupted = getInterruptedCycle();
  if (interrupted) {
    const failed = updateCycle(interrupted.id, {
      status: 'FAILED',
      completedAt: nowIso(),
      result: 'recovery_marked_incomplete',
      summary:
        'Cycle did not reach a terminal status before the process ended (crash, restart, or container recycle) — marked FAILED for visibility on the next startup. No duplicate execution was attempted; any partially-completed ai/tasks/ work this cycle started is untouched and can be resumed manually via the existing orchestrator resume commands, or re-selected by a future cycle through the normal backlog/signal mechanism.',
    });
    logAutonomyEvent({ type: 'CYCLE_FAILED', cycleId: failed.id, message: failed.summary ?? 'Marked FAILED on restart.' });
  }

  // Reap any real OS worker process left behind by a PREVIOUS orchestrator
  // process that crashed (lost entirely from claudeAdapter.ts's in-memory
  // registry the instant that process died — this is the only way a NEW
  // process can find it). Always runs, not only after detecting an
  // interrupted cycle above: cheap when nothing is orphaned (a SELECT that
  // usually returns nothing), and awaited to completion before any new
  // cycle is created below, so a new cycle never begins while a previous
  // run's worker might still be alive and spending real model usage.
  const cleanup = await cleanupOrphanedWorkers();
  if (cleanup.terminated.length > 0 || cleanup.unverifiable.length > 0) {
    logAutonomyEvent({
      type: 'CYCLE_FAILED',
      message: `Startup cleanup: terminated ${cleanup.terminated.length} orphaned worker process(es) left by a crashed run (${cleanup.terminated.map((w) => `${w.role}:${w.pid}`).join(', ') || 'none'}); ${cleanup.unverifiable.length} recorded worker(s) could not be safely confirmed and were left untouched.`,
    });
  }

  const previousCycle = getLatestCycle();
  const cycle = createCycle();
  if (!acquireCycleLock(cycle.id)) {
    const failed = updateCycle(cycle.id, {
      status: 'FAILED',
      completedAt: nowIso(),
      result: 'lock_race',
      summary: 'Could not acquire the cycle lock (raced with another process) — aborted immediately, no work attempted.',
    });
    return { skippedReason: 'ANOTHER_CYCLE_RUNNING', cycle: failed };
  }

  const maxModelCalls = options.maxModelCallsPerCycle ?? DEFAULT_MAX_MODEL_CALLS_PER_CYCLE;
  let modelCalls = 0;
  const canCallModel = () => modelCalls < maxModelCalls;

  try {
    logAutonomyEvent({
      type: 'CYCLE_STARTED',
      cycleId: cycle.id,
      message: `Cycle started. Previous cycle: ${previousCycle ? `${previousCycle.id} (${previousCycle.status})` : 'none — this is the first cycle.'}`,
    });
    updateCycle(cycle.id, { status: 'OBSERVING' });

    const objective = getStandingObjective();

    // ── Step 5: gather signals ──
    const sources = [...DEFAULT_SIGNAL_SOURCES];
    if (options.includeDeepSignals) {
      if (canCallModel()) {
        sources.push(deepSignalSource(options.invoker, 'designer', objective));
        modelCalls += 1;
      }
      if (canCallModel()) {
        sources.push(deepSignalSource(options.invoker, 'security', objective));
        modelCalls += 1;
      }
    }
    if (options.includeLiveSiteSignal && canCallModel()) {
      sources.push(liveSiteSignalSource(options.invoker, objective));
      modelCalls += 1;
    }

    const collectedSignals: Signal[] = [];
    let newSignalCount = 0;
    for (const source of sources) {
      try {
        const inputs = await source.collect();
        for (const input of inputs) {
          const { signal, isNew } = recordSignal(input);
          collectedSignals.push(signal);
          if (isNew) newSignalCount++;
        }
      } catch (err) {
        logAutonomyEvent({
          type: 'SIGNAL_COLLECTED',
          cycleId: cycle.id,
          message: `Signal source "${source.name}" failed and was skipped: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    updateCycle(cycle.id, { status: 'PRIORITIZING', signalsCollected: collectedSignals.length });
    logAutonomyEvent({
      type: 'SIGNAL_COLLECTED',
      cycleId: cycle.id,
      message: `Collected ${collectedSignals.length} signals this cycle (${newSignalCount} newly observed, ${collectedSignals.length - newSignalCount} still-standing from before).`,
    });

    // ── Steps 6-10: Lead planning (backlog update/dedupe, reprioritize, select <=1, classify risk, escalate) ──
    if (!canCallModel()) {
      const failed = updateCycle(cycle.id, {
        status: 'FAILED',
        completedAt: nowIso(),
        result: 'model_call_budget_exhausted',
        summary: `maxModelCallsPerCycle (${maxModelCalls}) was reached before the Lead could run — no planning or selection happened this cycle. Will retry fresh next cycle.`,
      });
      logAutonomyEvent({ type: 'CYCLE_FAILED', cycleId: cycle.id, message: failed.summary ?? '' });
      return { cycle: failed };
    }

    const leadResult = await runLeadPlanning({ invoker: options.invoker, cycleId: cycle.id, signals: collectedSignals });
    modelCalls += 1;

    // ── Steps 11-13: hand the selected item (if any) to the EXISTING orchestrator ──
    updateCycle(cycle.id, { status: 'EXECUTING' });
    let execution: CycleExecutionOutcome | undefined;
    let executionError: string | undefined;
    let executionTimedOut = false;

    if (leadResult.selected) {
      const item = leadResult.selected.item;
      const objectiveText = [
        item.title,
        '',
        item.description,
        '',
        `Why this matters (backlog rationale): ${item.rationale}`,
        item.evidence.length ? `\nEvidence:\n${item.evidence.map((e) => `- ${e}`).join('\n')}` : '',
      ].join('\n');

      updateBacklogItem(item.id, { status: 'IN_PROGRESS', changeReason: 'Execution started via the existing multi-agent orchestrator.' });
      logAutonomyEvent({
        type: 'TASK_CREATED',
        cycleId: cycle.id,
        backlogItemId: item.id,
        message: `Handing "${item.title}" to the existing orchestrator (risk: ${leadResult.selected.risk.risk}).`,
      });

      try {
        const runResult = await raceWithTimeout(
          runTask({
            objective: objectiveText,
            mode: options.mode ?? 'full',
            invoker: options.invoker,
            maxAgentsPerTask: options.maxAgentsPerTask,
            maxRetryCycles: options.maxRetryCycles,
            maxConcurrency: options.maxConcurrency,
          }),
          options.cycleTimeoutMs ?? DEFAULT_CYCLE_TIMEOUT_MS,
          'the execution phase (runTask)'
        );

        linkBacklogItemToTask(item.id, runResult.taskId);
        execution = { taskId: runResult.taskId, finalState: runResult.finalState };

        if (runResult.finalState === 'COMPLETE') {
          updateBacklogItem(item.id, {
            status: 'DONE',
            resolution: `Completed via ai/tasks/${runResult.taskId}.`,
            changeReason: 'Execution completed and passed all required reviews.',
          });
          recordMemory({
            scope: 'decision',
            type: 'cycle_outcome',
            content: `"${item.title}" (backlog ${item.id}) completed successfully via ai/tasks/${runResult.taskId}.`,
            source: `cycle:${cycle.id}`,
            confidence: 0.9,
          });
          logAutonomyEvent({ type: 'TASK_COMPLETED', cycleId: cycle.id, backlogItemId: item.id, taskId: runResult.taskId, message: `Completed: ${item.title}` });

          if (options.autoPush) {
            // The reviewed, mergeable result: the integration branch when
            // 2+ implementers ran (see orchestrator.ts "this is the
            // reviewed, mergeable result"), otherwise the single
            // implementer's own branch. Never main/master — both are
            // always a task-scoped agents/<taskId>/... branch.
            const handle = runResult.integrationWorktree ?? Object.values(runResult.worktrees)[0];
            if (handle) {
              const push = await (options.pushBranchFn ?? realPushBranch)(handle);
              if (push.pushed) {
                logAutonomyEvent({
                  type: 'BRANCH_PUSHED',
                  cycleId: cycle.id,
                  backlogItemId: item.id,
                  taskId: runResult.taskId,
                  message: `Pushed reviewed branch "${push.branch}" to origin.`,
                });

                if (options.autoMergeToProduction) {
                  await attemptProductionMerge(options, cycle.id, item, runResult, handle.branch);
                }
              } else {
                logAutonomyEvent({
                  type: 'BRANCH_PUSH_FAILED',
                  cycleId: cycle.id,
                  backlogItemId: item.id,
                  taskId: runResult.taskId,
                  message: `Push of reviewed branch "${push.branch}" failed — left unpushed for manual follow-up: ${push.reason ?? 'unknown reason'}`,
                });
              }
            }
          }
        } else if (runResult.finalState === 'FOUNDER_APPROVAL_REQUIRED') {
          const approval = createApprovalRequest({
            type: 'FOUNDER_DECISION_REQUIRED',
            title: `Founder approval required mid-execution: ${item.title}`,
            description: `The execution engine's own founder-approval gate fired while working on ai/tasks/${runResult.taskId}. See that task's founder-gate artifact for the exact reasons.`,
            backlogItemId: item.id,
            cycleId: cycle.id,
            taskId: runResult.taskId,
          });
          updateBacklogItem(item.id, { status: 'APPROVAL_REQUIRED', changeReason: 'Execution engine founder-approval gate fired mid-task.' });
          logAutonomyEvent({
            type: 'APPROVAL_REQUIRED',
            cycleId: cycle.id,
            backlogItemId: item.id,
            taskId: runResult.taskId,
            message: `Execution engine founder gate fired for "${item.title}".`,
            data: { approvalRequestId: approval.id },
          });
        } else {
          updateBacklogItem(item.id, {
            status: 'BLOCKED',
            resolution: `Execution did not complete (finalState=${runResult.finalState}) — see ai/tasks/${runResult.taskId}.`,
            changeReason: 'Execution finished without reaching COMPLETE — preserved (not marked DONE) for a future cycle or manual follow-up.',
          });
          recordMemory({
            scope: 'known_issue',
            type: 'execution_incomplete',
            content: `"${item.title}" (backlog ${item.id}) did not complete — finalState=${runResult.finalState}. See ai/tasks/${runResult.taskId}.`,
            source: `cycle:${cycle.id}`,
            confidence: 0.8,
          });
          logAutonomyEvent({
            type: 'BACKLOG_ITEM_UPDATED',
            cycleId: cycle.id,
            backlogItemId: item.id,
            taskId: runResult.taskId,
            message: `Execution did not complete for "${item.title}" (finalState=${runResult.finalState}) — marked BLOCKED, not DONE.`,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        executionError = message;
        // requirement 1 ("mark the relevant run as timing out"): a cycle
        // timeout gets its own distinct, accurate label everywhere —
        // backlog changeReason, memory, event, and (below) the cycle's own
        // `result` field — rather than being folded into the generic
        // "threw" bucket. The actual termination of whatever was still
        // running happens unconditionally in this function's `finally`
        // block (invoker.killAll()), regardless of which catch branch
        // this is, so it's covered whether or not this `if` is accurate.
        if (err instanceof CycleTimeoutError) executionTimedOut = true;
        updateBacklogItem(item.id, {
          status: 'BLOCKED',
          changeReason: executionTimedOut
            ? `Execution exceeded its ${(err as CycleTimeoutError).ms}ms cycle timeout — the in-flight worker process was terminated.`
            : `Execution threw before finishing: ${message}`,
        });
        recordMemory({
          scope: 'known_issue',
          type: executionTimedOut ? 'execution_timeout' : 'execution_error',
          content: `"${item.title}" (backlog ${item.id}) ${executionTimedOut ? 'timed out' : 'threw an error'} during execution: ${message}`,
          source: `cycle:${cycle.id}`,
          confidence: 0.8,
        });
        logAutonomyEvent({
          type: 'BACKLOG_ITEM_UPDATED',
          cycleId: cycle.id,
          backlogItemId: item.id,
          message: `Execution ${executionTimedOut ? 'timed out' : 'threw'} for "${item.title}": ${message}`,
        });
      }
    }

    // ── Steps 14-17: persist outcome + cycle summary ──
    // A selection can end in four genuinely different states — completed
    // execution, no item was eligible/selected at all, a selection was
    // made and execution genuinely started but threw before runTask()
    // could return a RunResult (e.g. a real git/buffer failure, observed
    // for real during the PART 23 demonstration this distinction was added
    // for), or execution exceeded its cycle timeout and was terminated.
    // Collapsing any of these into "no_selection" would silently hide that
    // real work was actually attempted — never do that.
    const summaryParts = [
      leadResult.plan.cycleSummary,
      execution
        ? `Execution: ${execution.finalState} (ai/tasks/${execution.taskId}).`
        : executionTimedOut
          ? `Execution for "${leadResult.selected?.item.title}" exceeded its cycle timeout and was terminated: ${executionError}`
          : executionError
            ? `Execution attempted for "${leadResult.selected?.item.title}" but threw before finishing: ${executionError}`
            : (leadResult.selectionNote ?? 'No item selected this cycle.'),
    ];
    const finished = updateCycle(cycle.id, {
      status: 'COMPLETED',
      completedAt: nowIso(),
      modelCalls,
      backlogChanges: leadResult.createdItems.length + leadResult.updatedItems.length + leadResult.mergedDuplicates.length,
      selectedItems: leadResult.selected ? [leadResult.selected.item.id] : [],
      tasksCreated: execution ? [execution.taskId] : [],
      approvalRequests: leadResult.approvalRequestIds,
      result: execution ? execution.finalState : executionTimedOut ? 'cycle_timeout' : executionError ? 'execution_error' : 'no_selection',
      summary: summaryParts.filter(Boolean).join(' '),
    });
    logAutonomyEvent({ type: 'CYCLE_COMPLETED', cycleId: cycle.id, message: finished.summary ?? 'Cycle completed.' });

    return { cycle: finished, leadResult, execution };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A worker (e.g. the Lead's own call, which isn't wrapped by
    // raceWithTimeout the way the execution phase is) can also time out
    // and throw directly here — label it distinctly for accurate status
    // reporting rather than the generic bucket every other unexpected
    // failure falls into.
    const result = err instanceof WorkerTimeoutError ? 'worker_timeout' : 'unexpected_error';
    const failed = updateCycle(cycle.id, { status: 'FAILED', completedAt: nowIso(), result, summary: `Cycle failed unexpectedly: ${message}` });
    logAutonomyEvent({ type: 'CYCLE_FAILED', cycleId: cycle.id, message: failed.summary ?? message });
    return { cycle: failed };
  } finally {
    // Whatever this cycle spawned, it owns — no worker process it started
    // should still be alive once this function returns, no matter which
    // branch it exited through (success, an ordinary failure, a cycle
    // timeout, or a worker timeout). Safe and cheap to call even when
    // nothing is running (resolves immediately), and the invoker itself
    // never touches a process it didn't spawn.
    await options.invoker.killAll?.('cycle ending — reaping any still-running workers');
    releaseCycleLock();
  }
}
