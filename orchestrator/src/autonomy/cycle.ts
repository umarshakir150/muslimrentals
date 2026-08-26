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
 *        lock + an interrupted-cycle check (crash recovery, PART 21).
 *   3-4. load standing objective, inspect previous cycle.
 *   5.   gather signals — signalSources.ts (+ optional deep sources).
 *   6-9. update/dedupe backlog, reprioritize, choose <=1 item, classify
 *        risk — all inside lead.ts (runLeadPlanning), which structurally
 *        can only ever return zero or one selection and always
 *        re-classifies risk deterministically before allowing selection.
 *   10.  stop/escalate founder-approval items — also inside lead.ts.
 *   11-13. hand eligible work to the existing orchestrator (runTask()),
 *        let it run its own specialists/implementers/reviewers/Integrator,
 *        receive the RunResult.
 *   14-16. update backlog + memory + persist the cycle/event record.
 *   17.  generate a cycle summary (AutonomousCycle.summary).
 *   18-19. release the lock, return.
 */
import type { ClaudeInvoker } from '../claude/claudeAdapter.js';
import { runTask } from '../supervisor/orchestrator.js';
import { getStandingObjective } from './objective.js';
import { DEFAULT_SIGNAL_SOURCES } from './signalSources.js';
import { deepSignalSource } from './deepSignalSource.js';
import { recordSignal } from './signalStore.js';
import { runLeadPlanning, type LeadPlanningResult } from './lead.js';
import { updateBacklogItem, linkBacklogItemToTask } from './backlogStore.js';
import { recordMemory } from './memoryStore.js';
import { createApprovalRequest } from './approvalStore.js';
import { logAutonomyEvent } from './eventLog.js';
import { nowIso } from './ids.js';
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

export const DEFAULT_MAX_MODEL_CALLS_PER_CYCLE = 5;
export const DEFAULT_CYCLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — generous default for a real full task run

export interface RunCycleOptions {
  invoker: ClaudeInvoker;
  /** Execution mode handed to the existing orchestrator for the selected
   * item. Defaults to 'full' — a real autonomous cycle is expected to
   * actually implement, review, and integrate (PART 23), not merely plan. */
  mode?: 'dry_run' | 'full';
  /** Opt-in Designer/Security "deep" signal source — costs two real Claude
   * calls, so off by default (PART 2). */
  includeDeepSignals?: boolean;
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

function raceWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timed out after ${ms}ms waiting for ${label}. This stops the autonomy layer's own bookkeeping and releases the cycle lock, but does NOT forcibly kill an already-spawned "claude" child process the execution engine may have started — see ai/autonomy-architecture.md "Deliberately deferred" for why a true worker-level kill switch is out of scope here.`
          )
        ),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
        updateBacklogItem(item.id, { status: 'BLOCKED', changeReason: `Execution threw before finishing: ${message}` });
        recordMemory({
          scope: 'known_issue',
          type: 'execution_error',
          content: `"${item.title}" (backlog ${item.id}) threw an error during execution: ${message}`,
          source: `cycle:${cycle.id}`,
          confidence: 0.8,
        });
        logAutonomyEvent({ type: 'BACKLOG_ITEM_UPDATED', cycleId: cycle.id, backlogItemId: item.id, message: `Execution threw for "${item.title}": ${message}` });
      }
    }

    // ── Steps 14-17: persist outcome + cycle summary ──
    const summaryParts = [leadResult.plan.cycleSummary, execution ? `Execution: ${execution.finalState} (ai/tasks/${execution.taskId}).` : (leadResult.selectionNote ?? 'No item selected this cycle.')];
    const finished = updateCycle(cycle.id, {
      status: 'COMPLETED',
      completedAt: nowIso(),
      modelCalls,
      backlogChanges: leadResult.createdItems.length + leadResult.updatedItems.length + leadResult.mergedDuplicates.length,
      selectedItems: leadResult.selected ? [leadResult.selected.item.id] : [],
      tasksCreated: execution ? [execution.taskId] : [],
      approvalRequests: leadResult.approvalRequestIds,
      result: execution ? execution.finalState : 'no_selection',
      summary: summaryParts.filter(Boolean).join(' '),
    });
    logAutonomyEvent({ type: 'CYCLE_COMPLETED', cycleId: cycle.id, message: finished.summary ?? 'Cycle completed.' });

    return { cycle: finished, leadResult, execution };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = updateCycle(cycle.id, { status: 'FAILED', completedAt: nowIso(), result: 'unexpected_error', summary: `Cycle failed unexpectedly: ${message}` });
    logAutonomyEvent({ type: 'CYCLE_FAILED', cycleId: cycle.id, message: failed.summary ?? message });
    return { cycle: failed };
  } finally {
    releaseCycleLock();
  }
}
