/**
 * The background scheduler — PART 10. Deliberately dumb: it does not decide
 * product priorities (that's lead.ts, called via cycle.ts's runCycle()),
 * it only answers "is autonomy enabled, is nothing else running, is it
 * time yet — if so, launch ONE bounded cycle and wait."
 *
 * Two independent layers, on purpose:
 *   1. Scheduler STATE (this file's get/start/pause/resume/stop functions)
 *      — a row in scheduler_state, flipped by the CLI. Says whether
 *      autonomy is currently enabled at all.
 *   2. The scheduler LOOP (runSchedulerLoop) — an actual long-running Node
 *      process that polls state on a fixed interval and calls runCycle()
 *      when eligible. This is the piece that must not depend on any one
 *      terminal/Claude Code session staying open: it's started as an
 *      ordinary detached OS process (see orchestrator/README.md "Running
 *      autonomy persistently" for the exact command), so it keeps polling
 *      independent of whatever asked the CLI to flip the state.
 *
 * `cycle_lock` (cycleStore.ts) remains the actual single-flight guarantee
 * — even if the loop's own eligibility check races with something else,
 * runCycle() itself refuses to double-run.
 */
import { getDb } from './db.js';
import { nowIso } from './ids.js';
import { getCycleLock } from './cycleStore.js';
import { runCycle, type RunCycleOptions, type CycleOutcome } from './cycle.js';
import { logAutonomyEvent } from './eventLog.js';

export type SchedulerStatus = 'STOPPED' | 'RUNNING' | 'PAUSED';

export interface SchedulerState {
  status: SchedulerStatus;
  cadenceMinutes: number;
  nextEligibleAt?: string;
  updatedAt: string;
}

// Conservative default per PART 10 — a real product does not need an
// autonomous cycle firing every few minutes; every eligible cycle can do
// real (bounded) implementation work.
export const DEFAULT_CADENCE_MINUTES = 240;

interface Row {
  id: string;
  status: string;
  cadence_minutes: number;
  next_eligible_at: string | null;
  updated_at: string;
}

function rowToState(row: Row): SchedulerState {
  return { status: row.status as SchedulerStatus, cadenceMinutes: row.cadence_minutes, nextEligibleAt: row.next_eligible_at ?? undefined, updatedAt: row.updated_at };
}

export function getSchedulerState(): SchedulerState {
  const db = getDb();
  const row = db.prepare("SELECT * FROM scheduler_state WHERE id = 'default'").get() as Row | undefined;
  if (!row) return { status: 'STOPPED', cadenceMinutes: DEFAULT_CADENCE_MINUTES, updatedAt: nowIso() };
  return rowToState(row);
}

function persist(state: SchedulerState): SchedulerState {
  const db = getDb();
  db.prepare(
    `INSERT INTO scheduler_state (id, status, cadence_minutes, next_eligible_at, updated_at) VALUES ('default', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, cadence_minutes=excluded.cadence_minutes, next_eligible_at=excluded.next_eligible_at, updated_at=excluded.updated_at`
  ).run(state.status, state.cadenceMinutes, state.nextEligibleAt ?? null, state.updatedAt);
  return state;
}

/** EventType (types.ts) has AUTONOMY_PAUSED/AUTONOMY_RESUMED but no
 * dedicated started/stopped values — start and resume both mean "became
 * eligible to fire" (AUTONOMY_RESUMED); stop and pause both mean "will not
 * fire" (AUTONOMY_PAUSED). The scheduler_state.status column is what
 * actually distinguishes STOPPED from PAUSED for `autonomous status`. */
export function startAutonomy(cadenceMinutes?: number): SchedulerState {
  const current = getSchedulerState();
  const saved = persist({
    status: 'RUNNING',
    cadenceMinutes: cadenceMinutes ?? current.cadenceMinutes,
    nextEligibleAt: nowIso(),
    updatedAt: nowIso(),
  });
  logAutonomyEvent({ type: 'AUTONOMY_RESUMED', message: `Autonomy started. Cadence: every ${saved.cadenceMinutes} minute(s). Eligible immediately.` });
  return saved;
}

export function pauseAutonomy(): SchedulerState {
  const current = getSchedulerState();
  const saved = persist({ ...current, status: 'PAUSED', updatedAt: nowIso() });
  logAutonomyEvent({ type: 'AUTONOMY_PAUSED', message: 'Autonomy paused — the scheduler loop will not launch new cycles until resumed.' });
  return saved;
}

export function resumeAutonomy(): SchedulerState {
  const current = getSchedulerState();
  const saved = persist({ ...current, status: 'RUNNING', nextEligibleAt: nowIso(), updatedAt: nowIso() });
  logAutonomyEvent({ type: 'AUTONOMY_RESUMED', message: 'Autonomy resumed — eligible immediately.' });
  return saved;
}

export function stopAutonomy(): SchedulerState {
  const current = getSchedulerState();
  const saved = persist({ ...current, status: 'STOPPED', updatedAt: nowIso() });
  logAutonomyEvent({ type: 'AUTONOMY_PAUSED', message: 'Autonomy stopped.' });
  return saved;
}

/** Change cadence without touching enabled/paused/stopped status. */
export function setCadenceMinutes(cadenceMinutes: number): SchedulerState {
  const current = getSchedulerState();
  return persist({ ...current, cadenceMinutes, updatedAt: nowIso() });
}

export type SchedulerTickResult = 'launched' | 'not_eligible' | 'disabled' | 'cycle_already_running';

export interface SchedulerTickOutcome {
  result: SchedulerTickResult;
  cycleOutcome?: CycleOutcome;
}

/** One eligibility check, and — only if eligible — one bounded runCycle().
 * Pure enough to unit test directly (no interval, no process lifetime). */
export async function runSchedulerTick(cycleOptions: RunCycleOptions): Promise<SchedulerTickOutcome> {
  const state = getSchedulerState();
  if (state.status !== 'RUNNING') return { result: 'disabled' };
  if (getCycleLock().locked) return { result: 'cycle_already_running' };

  const now = nowIso();
  if (state.nextEligibleAt && state.nextEligibleAt > now) return { result: 'not_eligible' };

  // Advance eligibility before launching — a cycle can legitimately take
  // longer than one tick interval, so this alone prevents a second tick
  // from trying to launch again the moment this one finishes, without
  // relying only on cycle_lock (which is the actual hard guarantee).
  persist({ ...state, nextEligibleAt: new Date(Date.now() + state.cadenceMinutes * 60_000).toISOString(), updatedAt: nowIso() });

  const cycleOutcome = await runCycle(cycleOptions);
  return { result: 'launched', cycleOutcome };
}

export interface SchedulerLoopOptions extends RunCycleOptions {
  /** How often to check eligibility, in ms. NOT the cadence between
   * cycles (that's scheduler_state.cadenceMinutes) — this just controls
   * how promptly the loop notices it has become eligible. Default 60s. */
  tickIntervalMs?: number;
  /** Called after every tick. Return 'stop' to end the loop — used by
   * tests and by the CLI's bounded demo mode; a real persistent run omits
   * this and the loop runs until the process itself is stopped. */
  onTick?: (outcome: SchedulerTickOutcome) => void | 'stop';
}

/** The actual long-running process body — see orchestrator/README.md for
 * the exact command to start this detached from any one terminal session.
 * Never resolves on its own unless `onTick` returns 'stop'. */
export async function runSchedulerLoop(options: SchedulerLoopOptions): Promise<void> {
  const tickIntervalMs = options.tickIntervalMs ?? 60_000;
  for (;;) {
    const outcome = await runSchedulerTick(options);
    const signal = options.onTick?.(outcome);
    if (signal === 'stop') return;
    await new Promise((resolve) => setTimeout(resolve, tickIntervalMs));
  }
}
