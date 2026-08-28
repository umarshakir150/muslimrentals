/**
 * Durable worker-process tracking — the piece that lets a crash of the
 * orchestrator process ITSELF (not just a hung worker) be recovered from
 * safely. claudeAdapter.ts's in-memory `activeChildren` map is enough to
 * kill a still-running worker while the SAME orchestrator process is still
 * alive (killAll()); it's gone entirely the instant that process dies. This
 * module is what a NEW process, starting fresh, uses to find and reap
 * anything the OLD process left running.
 *
 * Ownership model: every row records `ownerPid` — the orchestrator
 * process's own pid at the moment it spawned that worker (same convention
 * already used for cycle_lock.locked_by_pid in cycleStore.ts). A row is
 * only ever a cleanup candidate once its ownerPid is confirmed dead; a
 * worker whose owner is still alive is left completely alone, no matter
 * how long it's been running — this module never assumes it owns
 * something a live process still owns.
 */
import { getDb } from './db.js';
import { newId, nowIso } from './ids.js';
import { isPidDead, isSameProcess, terminateProcessGroup } from '../process/liveness.js';
import type { ProcessRegistryHooks } from '../claude/claudeAdapter.js';

export interface WorkerProcessRow {
  id: string;
  pid: number;
  role: string;
  ownerPid: number;
  startTicks?: string;
  spawnedAt: string;
  status: 'RUNNING' | 'EXITED';
}

interface Row {
  id: string;
  pid: number;
  role: string;
  owner_pid: number;
  start_ticks: string | null;
  spawned_at: string;
  status: string;
}

function rowToWorker(row: Row): WorkerProcessRow {
  return {
    id: row.id,
    pid: row.pid,
    role: row.role,
    ownerPid: row.owner_pid,
    startTicks: row.start_ticks ?? undefined,
    spawnedAt: row.spawned_at,
    status: row.status as 'RUNNING' | 'EXITED',
  };
}

export function recordWorkerSpawned(input: { pid: number; role: string; startTicks: string | undefined }): string {
  const id = newId('wkr');
  getDb()
    .prepare('INSERT INTO worker_processes (id, pid, role, owner_pid, start_ticks, spawned_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.pid, input.role, process.pid, input.startTicks ?? null, nowIso(), 'RUNNING');
  return id;
}

/** Marks every still-RUNNING row for `pid` as EXITED. In ordinary
 * operation there is at most one (a pid can't be spawned twice while the
 * first is still alive), but this updates all matches rather than
 * assuming that, since "assume uniqueness" is exactly the kind of shortcut
 * that causes stale rows to linger silently. */
export function recordWorkerExited(pid: number): void {
  getDb().prepare("UPDATE worker_processes SET status = 'EXITED' WHERE pid = ? AND status = 'RUNNING'").run(pid);
}

export function listRunningWorkerRows(): WorkerProcessRow[] {
  const rows = getDb().prepare("SELECT * FROM worker_processes WHERE status = 'RUNNING'").all() as unknown as Row[];
  return rows.map(rowToWorker);
}

/** Wires recordWorkerSpawned/recordWorkerExited into the shape
 * CliClaudeInvoker expects — the one place the two modules actually meet. */
export function createWorkerProcessRegistry(): ProcessRegistryHooks {
  return {
    onSpawn: (info) => recordWorkerSpawned(info),
    onExit: (pid) => recordWorkerExited(pid),
  };
}

export interface OrphanCleanupResult {
  checked: number;
  terminated: WorkerProcessRow[];
  ownerStillAlive: WorkerProcessRow[];
  alreadyDead: WorkerProcessRow[];
  unverifiable: WorkerProcessRow[];
}

/**
 * The restart-recovery entry point — call once, early, before a new cycle
 * begins any real work (see cycle.ts). For every row still marked RUNNING:
 *
 *   1. If its ownerPid (the orchestrator process that spawned it) is still
 *      alive, leave it completely alone — a legitimately-running process
 *      still owns it, full stop. (In normal single-flight operation this
 *      shouldn't happen — the cycle lock already prevents two orchestrator
 *      processes running at once — but this module doesn't rely on that
 *      invariant holding elsewhere; it re-checks independently.)
 *   2. If the owner is dead, the worker is an orphan candidate. Its own
 *      identity is re-verified (pid liveness + start-time match) before
 *      anything is touched — "never kill a process merely because its PID
 *      resembles an old one." Only a confirmed match is terminated.
 *   3. Every row this function finishes examining is marked EXITED in the
 *      registry either way (a dead worker is dead; an unverifiable one is
 *      no longer something this process can safely act on again either),
 *      so a future call never re-examines the same stale row forever.
 */
export async function cleanupOrphanedWorkers(opts: { gracefulMs?: number } = {}): Promise<OrphanCleanupResult> {
  const gracefulMs = opts.gracefulMs ?? 5000;
  const rows = listRunningWorkerRows();
  const result: OrphanCleanupResult = { checked: rows.length, terminated: [], ownerStillAlive: [], alreadyDead: [], unverifiable: [] };

  for (const row of rows) {
    if (!isPidDead(row.ownerPid)) {
      result.ownerStillAlive.push(row);
      continue; // leave it alone entirely — do not mark EXITED, it may still legitimately finish
    }

    if (isPidDead(row.pid)) {
      // The worker itself already exited on its own (e.g. it finished
      // right as its owner crashed) — nothing to terminate.
      recordWorkerExited(row.pid);
      result.alreadyDead.push(row);
      continue;
    }

    if (!isSameProcess(row.pid, row.startTicks)) {
      // Alive, but we cannot confirm it's still the exact process we
      // spawned (start-time mismatch = pid reuse, or no start-time was
      // ever recorded to compare against) — never act on an unconfirmed
      // identity. Mark this row done so it isn't re-examined forever, but
      // the process itself is left completely untouched.
      recordWorkerExited(row.pid);
      result.unverifiable.push(row);
      continue;
    }

    await terminateProcessGroup(row.pid, { gracefulMs });
    recordWorkerExited(row.pid);
    result.terminated.push(row);
  }

  return result;
}
