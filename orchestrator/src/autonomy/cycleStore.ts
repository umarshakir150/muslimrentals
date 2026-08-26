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
}

export interface CycleLockState {
  locked: boolean;
  cycleId?: string;
  lockedAt?: string;
}

function readLock(): CycleLockState {
  const db = getDb();
  const row = db.prepare("SELECT * FROM cycle_lock WHERE id = 'lock'").get() as LockRow | undefined;
  if (!row || !row.locked) return { locked: false };
  return { locked: true, cycleId: row.cycle_id ?? undefined, lockedAt: row.locked_at ?? undefined };
}

export function getCycleLock(): CycleLockState {
  return readLock();
}

/** Acquire the single-flight cycle lock. Returns false (does not throw) if
 * another cycle already holds it — cycle.ts treats that as "skip this
 * scheduler tick / CLI invocation," never as an error to retry around. */
export function acquireCycleLock(cycleId: string): boolean {
  const db = getDb();
  const current = readLock();
  if (current.locked) return false;
  db.prepare(
    `INSERT INTO cycle_lock (id, locked, cycle_id, locked_at) VALUES ('lock', 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET locked=1, cycle_id=excluded.cycle_id, locked_at=excluded.locked_at`
  ).run(cycleId, nowIso());
  return true;
}

/** Release the lock. Idempotent — safe to call even if nothing is held, and
 * intentionally does NOT check that `cycleId` matches the current holder
 * (cycle.ts's own try/finally is the only caller in normal operation; a
 * mismatched release during crash-recovery cleanup is a deliberate,
 * explicit override, not a bug). */
export function releaseCycleLock(): void {
  const db = getDb();
  db.prepare("UPDATE cycle_lock SET locked = 0, cycle_id = NULL, locked_at = NULL WHERE id = 'lock'").run();
}

/** A lock is stale when it's held but the cycle row it points at has
 * already reached a terminal status (or doesn't exist) — i.e. something
 * released the cycle without going through releaseCycleLock(), almost
 * always a crash. cycle.ts calls this on startup to decide whether to
 * clear an abandoned lock rather than wait on it forever. */
export function isLockStale(): boolean {
  const lock = readLock();
  if (!lock.locked || !lock.cycleId) return false;
  const cycle = getCycle(lock.cycleId);
  if (!cycle) return true;
  return TERMINAL_STATUSES.includes(cycle.status);
}
