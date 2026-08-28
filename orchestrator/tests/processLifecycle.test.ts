/**
 * Deterministic tests for worker/cycle process-lifecycle ownership — the
 * fix for the real gap found in the earlier live-cycle demonstration: a
 * cycle timeout released the cycle lock without ever terminating the
 * `claude` child process (or anything IT had spawned) that was still
 * running, which could leave a live worker — and ongoing model spend —
 * running after the cycle that started it was already marked stopped.
 *
 * No real Claude calls anywhere in this file. Every "worker" here is one
 * of tests/fixtures/*.mjs — small, disposable, standalone Node scripts
 * that stand in for a real `claude` binary and behave predictably (hang
 * until signaled; ignore or honor SIGTERM; spawn a grandchild) — spawned
 * through the exact same CliClaudeInvoker code path a real worker would
 * be, just pointed at a fixture instead of the real CLI.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb } from '../src/autonomy/db.js';
import { getAutonomyDbPath } from '../src/paths.js';
import { CliClaudeInvoker, WorkerTimeoutError, type ClaudeInvokeOptions, type ProcessRegistryHooks } from '../src/claude/claudeAdapter.js';
import { isPidDead, readProcStartTicks } from '../src/process/liveness.js';
import { recordWorkerSpawned, listRunningWorkerRows, cleanupOrphanedWorkers } from '../src/autonomy/workerRegistry.js';
import { runCycle, CycleTimeoutError } from '../src/autonomy/cycle.js';
import { getCycleLock } from '../src/autonomy/cycleStore.js';
import { getBacklogItem } from '../src/autonomy/backlogStore.js';
import type { ClaudeInvoker, ClaudeInvokeResult } from '../src/claude/claudeAdapter.js';
import type { LeadPlan } from '../src/autonomy/types.js';

// See tests/autonomyStores.test.ts for why each autonomy test file needs
// its own DB path when Vitest runs files in parallel.
process.env.ORCHESTRATOR_AUTONOMY_DB = path.join(path.dirname(getAutonomyDbPath()), 'autonomy-processlifecycle.db');

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

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const HANG_GRACEFUL = path.join(FIXTURES_DIR, 'hangGraceful.mjs');
const HANG_IGNORE_SIGTERM = path.join(FIXTURES_DIR, 'hangIgnoreSigterm.mjs');
const HANG_WITH_CHILD = path.join(FIXTURES_DIR, 'hangWithChild.mjs');

function baseOptions(overrides: Partial<ClaudeInvokeOptions> = {}): ClaudeInvokeOptions {
  return {
    role: 'test-worker',
    systemPromptAddition: 'irrelevant — fixture ignores all CLI args',
    userPrompt: 'irrelevant',
    cwd: process.cwd(),
    jsonSchema: {},
    tools: [],
    allowedToolPatterns: [],
    disallowedToolPatterns: [],
    maxBudgetUsd: 0.01,
    ...overrides,
  };
}

/** Kills a manually-spawned (not through CliClaudeInvoker) fixture process
 * outright, for test cleanup — bypasses the graceful/force pipeline since
 * the test is done with it either way. */
function forceKill(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone — fine
  }
}

/** terminateProcessGroup() only tracks and confirms death of the ONE pid it
 * was asked to manage (the worker itself) — it signals the whole process
 * GROUP, but doesn't enumerate or wait on each member individually. A
 * grandchild reparented to PID 1 after its immediate parent dies sits as a
 * zombie until PID 1 reaps it, which this environment's own PID 1 was
 * observed taking up to ~1.4s to do — already-dead-but-not-yet-reaped, not
 * a sign the kill failed. Polling here (rather than a single immediate
 * check) is what actually distinguishes those two cases. */
async function waitForDead(pid: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isPidDead(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return isPidDead(pid);
}

describe('CliClaudeInvoker — worker process ownership', () => {
  it('1. a worker that exceeds its timeout is terminated', async () => {
    const spawnedInfo: { pid: number }[] = [];
    // A registry hook lets us capture the real pid so we can assert it's actually dead afterward.
    const invoker = new CliClaudeInvoker(HANG_GRACEFUL, {
      gracefulTerminationMs: 300,
      registry: { onSpawn: (info) => spawnedInfo.push({ pid: info.pid }), onExit: () => {} },
    });

    await expect(invoker.invoke(baseOptions({ timeoutMs: 200 }))).rejects.toThrow(WorkerTimeoutError);
    expect(spawnedInfo).toHaveLength(1);
    expect(isPidDead(spawnedInfo[0]!.pid)).toBe(true);
  });

  it('2. a child process spawned BY the worker is also terminated (process-group kill)', async () => {
    const invoker = new CliClaudeInvoker(HANG_WITH_CHILD, { gracefulTerminationMs: 300 });
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'muslimrentals-pidfile-'));
    const pidFile = path.join(tmpDir, 'grandchild.pid');

    await expect(invoker.invoke(baseOptions({ timeoutMs: 200, userPrompt: pidFile }))).rejects.toThrow(WorkerTimeoutError);

    // Give the fixture a moment to have written the file before the timeout fired — it writes
    // synchronously at startup, well before the 200ms timeout, so this should already exist.
    expect(existsSync(pidFile)).toBe(true);
    const grandchildPid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(await waitForDead(grandchildPid)).toBe(true);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('3. graceful termination succeeds without escalating to force-kill', async () => {
    const invoker = new CliClaudeInvoker(HANG_GRACEFUL, { gracefulTerminationMs: 2000 });
    try {
      await invoker.invoke(baseOptions({ timeoutMs: 200 }));
      throw new Error('expected a WorkerTimeoutError');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkerTimeoutError);
      expect((err as WorkerTimeoutError).termination).toBe('terminated_gracefully');
    }
  });

  it('4. a worker that ignores SIGTERM is force-terminated (SIGKILL fallback)', async () => {
    const invoker = new CliClaudeInvoker(HANG_IGNORE_SIGTERM, { gracefulTerminationMs: 300 });
    try {
      await invoker.invoke(baseOptions({ timeoutMs: 200 }));
      throw new Error('expected a WorkerTimeoutError');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkerTimeoutError);
      expect((err as WorkerTimeoutError).termination).toBe('force_terminated');
    }
  });

  it('5. an unrelated process is never terminated by a timeout on a different worker', async () => {
    // Spawned directly, NOT through CliClaudeInvoker — this invoker has
    // never heard of this process and must never touch it.
    const unrelated = spawn(HANG_GRACEFUL, [], { detached: true, stdio: 'ignore' });
    expect(unrelated.pid).toBeDefined();

    const invoker = new CliClaudeInvoker(HANG_IGNORE_SIGTERM, { gracefulTerminationMs: 300 });
    await expect(invoker.invoke(baseOptions({ timeoutMs: 200 }))).rejects.toThrow(WorkerTimeoutError);

    expect(isPidDead(unrelated.pid as number)).toBe(false);
    forceKill(unrelated.pid);
  });

  it('11. a timed-out worker is never retried by the bounded-retry loop (retry limits stay bounded)', async () => {
    let spawnCount = 0;
    const registry: ProcessRegistryHooks = { onSpawn: () => { spawnCount++; }, onExit: () => {} };
    const invoker = new CliClaudeInvoker(HANG_IGNORE_SIGTERM, { gracefulTerminationMs: 200, registry });
    await expect(invoker.invoke(baseOptions({ timeoutMs: 150 }))).rejects.toThrow(WorkerTimeoutError);
    // The invoke() retry loop allows up to 2 attempts for an ordinary
    // process-level failure — a WorkerTimeoutError must short-circuit that
    // and never trigger a second spawn.
    expect(spawnCount).toBe(1);
  });
});

describe('workerRegistry — cross-restart orphan cleanup', () => {
  function deadPid(): number {
    return spawnSync(process.execPath, ['-e', '0']).pid ?? 999999;
  }

  it('8. restart detects a still-live worker whose owner process is dead', () => {
    const worker = spawn(HANG_GRACEFUL, [], { detached: true, stdio: 'ignore' });
    const startTicks = readProcStartTicks(worker.pid as number);
    const db = getDb();
    db.prepare('INSERT INTO worker_processes (id, pid, role, owner_pid, start_ticks, spawned_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'wkr_test_orphan',
      worker.pid as number,
      'engineering',
      deadPid(), // owner is confirmed dead — a genuine orphan
      startTicks ?? null,
      new Date().toISOString(),
      'RUNNING'
    );

    expect(listRunningWorkerRows().some((w) => w.pid === worker.pid)).toBe(true);
    forceKill(worker.pid);
  });

  it('9. restart cleanup terminates an owned orphaned worker safely and marks the row EXITED', async () => {
    const worker = spawn(HANG_IGNORE_SIGTERM, [], { detached: true, stdio: 'ignore' });
    const startTicks = readProcStartTicks(worker.pid as number);
    recordWorkerSpawned({ pid: worker.pid as number, role: 'engineering', startTicks });
    // recordWorkerSpawned always uses the CURRENT process (this test
    // runner) as owner_pid — overwrite it to a confirmed-dead pid so this
    // row is a genuine orphan candidate, not one this live process still owns.
    getDb().prepare('UPDATE worker_processes SET owner_pid = ? WHERE pid = ?').run(deadPid(), worker.pid as number);

    const result = await cleanupOrphanedWorkers({ gracefulMs: 200 });
    expect(result.terminated.map((w) => w.pid)).toContain(worker.pid);
    expect(isPidDead(worker.pid as number)).toBe(true);
    expect(listRunningWorkerRows().some((w) => w.pid === worker.pid)).toBe(false);
  });

  it('never touches an orphan candidate whose owner is still alive', async () => {
    const worker = spawn(HANG_GRACEFUL, [], { detached: true, stdio: 'ignore' });
    const startTicks = readProcStartTicks(worker.pid as number);
    recordWorkerSpawned({ pid: worker.pid as number, role: 'engineering', startTicks });
    // owner_pid defaults to process.pid (this live test process) — never overwritten here.

    const result = await cleanupOrphanedWorkers({ gracefulMs: 200 });
    expect(result.ownerStillAlive.map((w) => w.pid)).toContain(worker.pid);
    expect(isPidDead(worker.pid as number)).toBe(false);
    forceKill(worker.pid);
  });

  it('never terminates a live pid whose recorded start-time no longer matches (pid reuse protection)', async () => {
    const worker = spawn(HANG_GRACEFUL, [], { detached: true, stdio: 'ignore' });
    recordWorkerSpawned({ pid: worker.pid as number, role: 'engineering', startTicks: 'not-the-real-starttime' });
    getDb().prepare('UPDATE worker_processes SET owner_pid = ? WHERE pid = ?').run(deadPid(), worker.pid as number);

    const result = await cleanupOrphanedWorkers({ gracefulMs: 200 });
    expect(result.unverifiable.map((w) => w.pid)).toContain(worker.pid);
    expect(isPidDead(worker.pid as number)).toBe(false); // left completely alone
    forceKill(worker.pid);
  });
});

describe('runCycle — cycle-level timeout actually terminates work, not just the wait', () => {
  /** A ClaudeInvoker whose 'supervisor' role call hangs forever — enough to
   * make runTask()'s own planning phase (and therefore the whole execution
   * phase raceWithTimeout() wraps) never resolve on its own, so a short
   * cycleTimeoutMs is guaranteed to be what ends the cycle. No real
   * process is spawned by this fake — it exists to prove the LOGICAL
   * cycle-timeout state machine (result labeling, lock release, backlog
   * update) independent of real OS process termination, which the
   * CliClaudeInvoker-level tests above already cover for real. */
  function hangingInvoker(): ClaudeInvoker {
    return {
      invoke: (options): Promise<ClaudeInvokeResult> => {
        if (options.role === 'lead') {
          const plan: LeadPlan = {
            cycleSummary: 'Selecting the one candidate.',
            newBacklogItems: [
              {
                title: 'Task that will hang forever',
                description: 'd',
                category: 'TECH_DEBT',
                evidence: ['e'],
                rationale: 'r',
                userImpact: 1,
                severity: 1,
                confidence: 0.5,
                effort: 1,
                strategicRelevance: 1,
                requiresFounderDecision: false,
                requiresLegalReview: false,
                relatedSignalIds: [],
              },
            ],
            updatedBacklogItems: [],
            selectedItemId: 'new:0',
            selectionRationale: 'Only candidate.',
            escalations: [],
          };
          return Promise.resolve({ raw: '', json: plan, durationMs: 1 });
        }
        // supervisor (and anything else downstream) never resolves.
        return new Promise(() => {});
      },
    };
  }

  it('6. a cycle that exceeds its timeout persists a distinct, accurate timeout state (not folded into "no_selection")', async () => {
    const outcome = await runCycle({ invoker: hangingInvoker(), cycleTimeoutMs: 300 });
    expect(outcome.cycle?.status).toBe('COMPLETED'); // the CYCLE itself still terminates cleanly...
    expect(outcome.cycle?.result).toBe('cycle_timeout'); // ...but its result says exactly what happened
    expect(outcome.cycle?.summary).toContain('timeout');

    const item = getBacklogItem(outcome.leadResult!.selected!.item.id);
    expect(item?.status).toBe('BLOCKED');
    expect(item?.status).not.toBe('DONE');
  });

  it('7. the cycle lock is released even after a timeout', async () => {
    await runCycle({ invoker: hangingInvoker(), cycleTimeoutMs: 300 });
    expect(getCycleLock().locked).toBe(false);
  });

  it("10. a real orphaned worker from a previous crashed run is cleaned up before this cycle's own work begins", async () => {
    const worker = spawn(HANG_GRACEFUL, [], { detached: true, stdio: 'ignore' });
    const startTicks = readProcStartTicks(worker.pid as number);
    recordWorkerSpawned({ pid: worker.pid as number, role: 'engineering', startTicks });
    getDb().prepare('UPDATE worker_processes SET owner_pid = ? WHERE pid = ?').run(spawnSync(process.execPath, ['-e', '0']).pid as number, worker.pid as number);

    expect(isPidDead(worker.pid as number)).toBe(false); // sanity: genuinely alive before the cycle runs

    // A cycle that immediately exhausts its own model-call budget still
    // has to run the startup cleanup step first — proves cleanup isn't
    // conditional on the cycle actually doing planning/execution work.
    await runCycle({ invoker: hangingInvoker(), maxModelCallsPerCycle: 0 });

    expect(isPidDead(worker.pid as number)).toBe(true);
    expect(listRunningWorkerRows().some((w) => w.pid === worker.pid)).toBe(false);
  });
});

describe('CycleTimeoutError', () => {
  it('is a distinguishable error type carrying its timeout and label', () => {
    const err = new CycleTimeoutError(1234, 'the execution phase');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CycleTimeoutError');
    expect(err.ms).toBe(1234);
    expect(err.message).toContain('1234');
  });
});
