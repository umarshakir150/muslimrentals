/**
 * AutonomousCycle persistence (PART 9) + the cycle lock (PART 7/20: "cycle
 * lock prevents overlapping cycles"). The lock is a single mutex row in
 * `cycle_lock` (id='lock', enforced by a CHECK constraint) rather than an
 * in-memory flag, specifically so a process crash mid-cycle is *visible* on
 * restart instead of silently forgotten (PART 9: "a process crash must not
 * cause the system to forget a cycle was running") — see
 * `getInterruptedCycle()` / `isLockStale()` below, used by cycle.ts on
 * startup to decide RECOVERY_REQUIRED vs. safe-to-resume vs. safe-to-clear.
 */
import { getDb } from './db.js';
import { definedOnly, newId, nowIso } from './ids.js';
import { AutonomousCycle, type CycleStatus } from './types.js';

interface CycleRow {
  id: string;
  status: string;
  started_at: string;
  data: string;
}

function rowToCycle(row: CycleRow): AutonomousCycle {
  return AutonomousCycle.parse(JSON.parse(row.data));
}

function persist(cycle: AutonomousCycle): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO autonomous_cycles (id, status, started_at, data) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data`
  ).run(cycle.id, cycle.status, cycle.startedAt, JSON.stringify(cycle));
}

export function createCycle(): AutonomousCycle {
  const cycle: AutonomousCycle = AutonomousCycle.parse({
    id: newId('cyc'),
    startedAt: nowIso(),
    status: 'STARTING',
  });
  persist(cycle);
  return cycle;
}

export function getCycle(id: string): AutonomousCycle | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM autonomous_cycles WHERE id = ?').get(id) as CycleRow | undefined;
  return row ? rowToCycle(row) : undefined;
}

export interface UpdateCycleInput {
  status?: CycleStatus;
  completedAt?: string;
  signalsCollected?: number;
  backlogChanges?: number;
  selectedItems?: string[];
  tasksCreated?: string[];
  modelCalls?: number;
  retries?: number;
  approvalRequests?: string[];
  result?: string;
  nextEligibleAt?: string;
  summary?: string;
}

export function updateCycle(id: string, patch: UpdateCycleInput): AutonomousCycle {
  const existing = getCycle(id);
  if (!existing) throw new Error(`updateCycle: no cycle "${id}"`);
  const updated: AutonomousCycle = AutonomousCycle.parse({ ...existing, ...definedOnly(patch) });
  persist(updated);
  return updated;
}

/** Increment counters (modelCalls, retries, signalsCollected, backlogChanges)
 * rather than overwrite them — the caller doesn't need to track a running
 * total itself. */
export function incrementCycleCounters(id: string, delta: Partial<Pick<AutonomousCycle, 'signalsCollected' | 'backlogChanges' | 'modelCalls' | 'retries'>>): AutonomousCycle {
  const existing = getCycle(id);
  if (!existing) throw new Error(`incrementCycleCounters: no cycle "${id}"`);
  return updateCycle(id, {
    signalsCollected: existing.signalsCollected + (delta.signalsCollected ?? 0),
    backlogChanges: existing.backlogChanges + (delta.backlogChanges ?? 0),
    modelCalls: existing.modelCalls + (delta.modelCalls ?? 0),
    retries: existing.retries + (delta.retries ?? 0),
  });
}

export interface ListCyclesFilter {
  status?: CycleStatus;
  limit?: number;
}

export function listCycles(filter: ListCyclesFilter = {}): AutonomousCycle[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter.limit ? `LIMIT ${Math.max(0, Math.floor(filter.limit))}` : '';
  const rows = db.prepare(`SELECT * FROM autonomous_cycles ${where} ORDER BY started_at DESC ${limit}`).all(...params) as unknown as CycleRow[];
  return rows.map(rowToCycle);
}

export function getLatestCycle(): AutonomousCycle | undefined {
  return listCycles({ limit: 1 })[0];
}

const TERMINAL_STATUSES: CycleStatus[] = ['COMPLETED', 'FAILED', 'PAUSED'];

/** A cycle left in a non-terminal status by the most recent run — evidence
 * the process ended (crashed, was killed, container recycled) without ever
 * reaching COMPLETED/FAILED/PAUSED. Used by cycle.ts on startup instead of
 * trusting the lock alone, since the lock and the cycle row could in theory
 * disagree after a crash between the two writes. */
export function getInterruptedCycle(): AutonomousCycle | undefined {
  const latest = getLatestCycle();
  if (!latest) return undefined;
  return TERMINAL_STATUSES.includes(latest.status) ? undefined : latest;
}

interface LockRow {
  id: string;
  locked: number;
  cycle_id: string | null;
  locked_at: string | null;
  locked_by_pid: number | null;
}

export interface CycleLockState {
  locked: boolean;
  cycleId?: string;
  lockedAt?: string;
  lockedByPid?: number;
}

function readLock(): CycleLockState {
  const db = getDb();
  const row = db.prepare("SELECT * FROM cycle_lock WHERE id = 'lock'").get() as LockRow | undefined;
  if (!row || !row.locked) return { locked: false };
  return { locked: true, cycleId: row.cycle_id ?? undefined, lockedAt: row.locked_at ?? undefined, lockedByPid: row.locked_by_pid ?? undefined };
}

export function getCycleLock(): CycleLockState {
  return readLock();
}

/** Acquire the single-flight cycle lock. Returns false (does not throw) if
 * another cycle already holds it — cycle.ts treats that as "skip this
 * scheduler tick / CLI invocation," never as an error to retry around.
 * Records this process's own PID so a later invocation can tell an
 * abandoned lock apart from a genuinely still-running one — see
 * isLockStale(). */
export function acquireCycleLock(cycleId: string): boolean {
  const db = getDb();
  const current = readLock();
  if (current.locked) return false;
  db.prepare(
    `INSERT INTO cycle_lock (id, locked, cycle_id, locked_at, locked_by_pid) VALUES ('lock', 1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET locked=1, cycle_id=excluded.cycle_id, locked_at=excluded.locked_at, locked_by_pid=excluded.locked_by_pid`
  ).run(cycleId, nowIso(), process.pid);
  return true;
}

/** Release the lock. Idempotent — safe to call even if nothing is held, and
 * intentionally does NOT check that `cycleId` matches the current holder
 * (cycle.ts's own try/finally is the only caller in normal operation; a
 * mismatched release during crash-recovery cleanup is a deliberate,
 * explicit override, not a bug). */
export function releaseCycleLock(): void {
  const db = getDb();
  db.prepare("UPDATE cycle_lock SET locked = 0, cycle_id = NULL, locked_at = NULL, locked_by_pid = NULL WHERE id = 'lock'").run();
}

/** True if `pid` is not (or no longer) a live OS process. Uses the
 * zero-signal form of kill() — it never actually signals the process, it
 * only probes whether the OS still recognizes the PID. ESRCH = genuinely
 * gone; any other outcome (including EPERM, which means it exists but is
 * owned by someone else) counts as alive. */
function isPidDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/**
 * A lock is stale when whatever acquired it can no longer possibly finish
 * it — i.e. cycle.ts's own try/finally, which always runs releaseCycleLock()
 * on success, ordinary failure, AND its own internal cycle-timeout, will
 * never get the chance to run. Checked two ways:
 *   1. The cycle it points at already reached a terminal status (or
 *      doesn't exist) — something released the cycle without going
 *      through releaseCycleLock(). Cheap, no syscall, still checked first.
 *   2. The OS process that acquired it (locked_by_pid) is no longer alive.
 *      This is the check that actually matters for a real crash: a killed
 *      process leaves both the lock AND its cycle row in a NON-terminal
 *      state (that's exactly what makes it a crash), so check #1 alone
 *      can never catch it — confirmed for real by killing a live cycle
 *      mid-PRIORITIZING and observing the next invocation refuse to
 *      recover until this PID check was added. A pure time-based
 *      heuristic was considered and rejected: this system is
 *      single-machine by design (see orchestrator/README.md "Running
 *      autonomy persistently"), so a direct liveness probe is both
 *      available and unambiguous — no need to guess a timeout that risks
 *      either false-recovering a slow-but-alive cycle or waiting far
 *      longer than necessary on a genuinely dead one.
 * A lock with no recorded PID (e.g. one held before this column existed)
 * falls back to check #1 only.
 */
export function isLockStale(): boolean {
  const lock = readLock();
  if (!lock.locked) return false;
  if (lock.cycleId) {
    const cycle = getCycle(lock.cycleId);
    if (!cycle) return true;
    if (TERMINAL_STATUSES.includes(cycle.status)) return true;
  }
  if (lock.lockedByPid !== undefined) return isPidDead(lock.lockedByPid);
  return false;
}
