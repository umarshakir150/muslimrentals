/**
 * Process ownership/liveness primitives shared by both layers that need
 * them: the execution engine's worker-process management
 * (src/claude/claudeAdapter.ts) and the autonomy layer's cycle-lock/
 * worker-registry crash recovery (src/autonomy/cycleStore.ts,
 * src/autonomy/workerRegistry.ts). Lives outside src/autonomy/ on purpose
 * — the execution engine must never depend on the autonomy layer (see
 * ai/autonomy-architecture.md "do not conflate these layers"), so a
 * neutral, dependency-free home is required for logic both need.
 *
 * This whole system is single-machine by design (see orchestrator/
 * README.md "Running autonomy persistently") — every PID recorded here
 * was spawned by, and is only ever inspected by, processes on this same
 * machine, which is what makes a direct liveness/identity probe (rather
 * than a time-based heuristic) both available and reliable.
 */
import { readFileSync } from 'node:fs';

/** True if `pid` is not (or no longer) a live OS process. Uses the
 * zero-signal form of kill() — it never actually signals the process, it
 * only probes whether the OS still recognizes the PID. ESRCH = genuinely
 * gone; any other outcome (including EPERM, which means it exists but is
 * owned by someone else) counts as alive. */
export function isPidDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/**
 * Linux-specific: reads /proc/<pid>/stat's `starttime` field (field 22 —
 * see `man 5 proc`) — the number of clock ticks since boot at which this
 * PID started. Combined with the PID itself, this is a kernel-authoritative
 * (pid, starttime) composite identity that survives PID reuse: after a
 * process exits, the OS may eventually recycle its PID number for a
 * completely unrelated process, but that new process will almost certainly
 * have a different starttime, so comparing both together (see
 * isSameProcess()) is what actually protects against "kill a process
 * merely because its PID resembles an old one."
 *
 * Returns undefined if /proc isn't available (non-Linux) or the process is
 * already gone — callers must treat "can't verify" as "do not act", never
 * as "assume it's fine."
 *
 * comm (field 2) is parenthesized and may itself contain spaces or
 * parentheses, so this splits after the LAST ')' rather than naively on
 * whitespace, exactly as `man proc` prescribes for parsing this file.
 */
export function readProcStartTicks(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
    const fields = afterComm.trim().split(/\s+/);
    // fields[0] is state (field 3 overall); starttime is field 22 overall,
    // i.e. index 22 - 3 = 19 in this zero-based array starting at field 3.
    return fields[19];
  } catch {
    return undefined;
  }
}

/**
 * True only if `pid` is both alive AND — when `expectedStartTicks` was
 * recorded at spawn time — still the exact same process that was spawned,
 * not a different process that has since reused the same PID number.
 *
 * If `expectedStartTicks` is undefined (e.g. /proc was unavailable when
 * this worker was originally spawned), this falls back to pure PID
 * liveness — weaker protection against reuse, but still real protection
 * against acting on a fully-dead PID, and it's the best available signal
 * in that situation.
 */
export function isSameProcess(pid: number, expectedStartTicks: string | undefined): boolean {
  if (expectedStartTicks === undefined) return !isPidDead(pid);
  const current = readProcStartTicks(pid);
  if (current === undefined) return false; // can't verify -> never claim a match
  return current === expectedStartTicks;
}

export type TerminationOutcome = 'already_dead' | 'terminated_gracefully' | 'force_terminated' | 'could_not_confirm';

/**
 * Terminates `pid` and everything in its process group — requires `pid` to
 * be a process-group leader (i.e. spawned with `detached: true`; see
 * claudeAdapter.ts), since `process.kill(-pid, signal)` (a negative pid)
 * signals every member of that group, which is how "terminate any child
 * process tree it spawned" is satisfied on this platform: a worker's own
 * subprocesses inherit its process group unless they explicitly detach
 * themselves.
 *
 * Sequence: SIGTERM the group, poll for actual death for up to
 * `gracefulMs`, escalate to SIGKILL if still alive, poll again briefly,
 * then report what actually happened — never assumed. A caller that needs
 * certainty should still check `isPidDead(pid)` itself afterward; this
 * function's return value is a best-effort summary, not a guarantee (a
 * process in uninterruptible I/O sleep can theoretically outlive even
 * SIGKILL's delivery, however briefly).
 */
export async function terminateProcessGroup(pid: number, opts: { gracefulMs: number; pollIntervalMs?: number }): Promise<TerminationOutcome> {
  const pollIntervalMs = opts.pollIntervalMs ?? 100;

  if (isPidDead(pid)) return 'already_dead';

  try {
    process.kill(-pid, 'SIGTERM');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return 'already_dead';
    throw err;
  }

  const gracefulDeadline = Date.now() + opts.gracefulMs;
  while (Date.now() < gracefulDeadline) {
    if (isPidDead(pid)) return 'terminated_gracefully';
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  if (isPidDead(pid)) return 'terminated_gracefully';

  try {
    process.kill(-pid, 'SIGKILL');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return 'terminated_gracefully';
    throw err;
  }

  // SIGKILL is not interceptible, but delivery+reaping still takes the
  // kernel a moment — poll rather than assuming instant death. This
  // matters more than it might look: a process reparented to PID 1 after
  // its immediate parent was killed (e.g. a worker's own subprocess) sits
  // as a zombie until PID 1 reaps it, and that isn't always prompt — a
  // real, containerized PID 1 in this exact deployment environment was
  // observed taking ~1.2-1.4s to reap a killed, reparented grandchild
  // (tests/processLifecycle.test.ts scenario 2), well past what a
  // "typical Linux init reaps almost instantly" assumption would predict.
  // 5s stays trivially small next to the minutes-scale worker/cycle
  // timeouts this is nested inside, so being generous here costs nothing
  // real while avoiding a false 'could_not_confirm' on a process that is
  // in fact already dead, just not yet reaped.
  const forceDeadline = Date.now() + Math.max(5000, opts.gracefulMs / 4);
  while (Date.now() < forceDeadline) {
    if (isPidDead(pid)) return 'force_terminated';
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return isPidDead(pid) ? 'force_terminated' : 'could_not_confirm';
}
