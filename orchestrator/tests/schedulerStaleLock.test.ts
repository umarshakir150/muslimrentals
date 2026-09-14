/**
 * Regression test for a real incident (2026-09-13): a process holding the
 * cycle lock was killed externally (a wrapper timeout, in this case) while
 * its cycle was still in a non-terminal status. runCycle() already
 * self-heals a lock like this via isLockStale() + releaseCycleLock() (see
 * cycleStore.ts's own doc comment on isLockStale), but runSchedulerTick()
 * checked getCycleLock().locked directly, without ever calling
 * isLockStale() first — so scheduler-tick reported cycle_already_running
 * forever, even though nothing was actually running, until someone
 * happened to run `agents:cycle` directly (which does go through
 * runCycle()'s self-heal). This proves runSchedulerTick() now clears a
 * stale lock the same way runCycle() does, instead of getting wedged.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { closeDb, getDb } from '../src/autonomy/db.js';
import { getAutonomyDbPath } from '../src/paths.js';

// See tests/autonomyStores.test.ts for why each autonomy test file needs
// its own DB path when Vitest runs files in parallel.
process.env.ORCHESTRATOR_AUTONOMY_DB = path.join(path.dirname(getAutonomyDbPath()), 'autonomy-scheduler-stalelock.db');

import { runSchedulerTick, startAutonomy } from '../src/autonomy/scheduler.js';
import { getCycleLock } from '../src/autonomy/cycleStore.js';
import type { ClaudeInvoker, ClaudeInvokeResult } from '../src/claude/claudeAdapter.js';
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

/** A pid guaranteed to already be dead: a process that has already run to
 * completion and exited, same technique used by
 * tests/processLifecycle.test.ts's workerRegistry orphan-cleanup tests. */
function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '0']).pid ?? 999999;
}

function insertCycleLock(cycleId: string, pid: number): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO autonomous_cycles (id, status, started_at, data) VALUES (?, 'PRIORITIZING', ?, ?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data`
  ).run(cycleId, new Date().toISOString(), JSON.stringify({ id: cycleId, startedAt: new Date().toISOString(), status: 'PRIORITIZING' }));
  db.prepare(
    `INSERT INTO cycle_lock (id, locked, cycle_id, locked_at, locked_by_pid) VALUES ('lock', 1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET locked=1, cycle_id=excluded.cycle_id, locked_at=excluded.locked_at, locked_by_pid=excluded.locked_by_pid`
  ).run(cycleId, new Date().toISOString(), pid);
}

/** A no-op Lead: selects nothing, so runCycle() completes almost instantly. */
function noopInvoker(): ClaudeInvoker {
  return {
    invoke: (): Promise<ClaudeInvokeResult> => {
      const plan: LeadPlan = {
        cycleSummary: 'Nothing to do.',
        newBacklogItems: [],
        updatedBacklogItems: [],
        selectedItemId: null,
        selectionRationale: 'No candidates observed.',
        escalations: [],
      };
      return Promise.resolve({ raw: '', json: plan, durationMs: 1 });
    },
  };
}

describe('runSchedulerTick — stale cycle lock recovery', () => {
  it('clears a lock left by a dead process and launches a fresh cycle, instead of reporting cycle_already_running forever', async () => {
    startAutonomy(); // RUNNING, eligible immediately
    insertCycleLock('cyc_test_stale', deadPid());
    expect(getCycleLock().locked).toBe(true);

    const outcome = await runSchedulerTick({ invoker: noopInvoker() });

    expect(outcome.result).toBe('launched');
    expect(outcome.cycleOutcome?.cycle?.status).toBe('COMPLETED');
    expect(outcome.cycleOutcome?.cycle?.id).not.toBe('cyc_test_stale');
    // The tick's own cycle released the lock behind it, same as any
    // ordinary completed cycle.
    expect(getCycleLock().locked).toBe(false);
  });

  it('still correctly reports cycle_already_running when the lock is genuinely held by a live process', async () => {
    startAutonomy();
    insertCycleLock('cyc_test_live', process.pid); // this test process itself -- definitely alive

    const outcome = await runSchedulerTick({ invoker: noopInvoker() });

    expect(outcome.result).toBe('cycle_already_running');
    expect(getCycleLock().locked).toBe(true);
    expect(getCycleLock().cycleId).toBe('cyc_test_live');
  });

  it('still reports not_eligible on cadence, independent of any lock state', async () => {
    const state = startAutonomy();
    // Push eligibility into the future — nothing should launch regardless
    // of the (here, free) lock.
    const db = getDb();
    db.prepare("UPDATE scheduler_state SET next_eligible_at = ? WHERE id = 'default'").run(new Date(Date.now() + 60_000).toISOString());
    void state;

    const outcome = await runSchedulerTick({ invoker: noopInvoker() });
    expect(outcome.result).toBe('not_eligible');
  });

  it('still reports disabled when autonomy is not RUNNING, independent of any lock state', async () => {
    // Never started — scheduler_state defaults to STOPPED.
    const outcome = await runSchedulerTick({ invoker: noopInvoker() });
    expect(outcome.result).toBe('disabled');
  });
});
