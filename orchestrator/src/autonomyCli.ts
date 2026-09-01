/**
 * The autonomy-layer CLI — PART 20. Dispatched from src/cli.ts (see there
 * for why this is a dispatch add-on rather than a second CLI binary): the
 * existing `npm run agents:task -- "<objective>"` entrypoint keeps working
 * completely unchanged, and a small reserved set of leading words routes
 * here instead. Exact commands (see orchestrator/README.md "Autonomy" for
 * the full reference):
 *
 *   npm run agents:status                          -- overall system status
 *   npm run agents:backlog                          -- list backlog (top priority first)
 *   npm run agents:backlog -- show <id>             -- one backlog item in full
 *   npm run agents:cycle                            -- run ONE bounded cycle now (mode=full by default)
 *   npm run agents:cycle -- --worker-timeout-ms N   -- override the per-worker process timeout (default: DEFAULT_WORKER_TIMEOUT_MS)
 *   npm run agents:cycle -- --dry-run               -- run one cycle, plan/analyze only
 *   npm run agents:cycle -- status                  -- show the most recent cycle, don't launch one
 *   npm run agents:cycle -- history                 -- list past cycles
 *   npm run agents:autonomous -- start|pause|resume|stop|status [--cadence-minutes N]
 *   npm run agents:approvals                        -- list PENDING approval requests
 *   npm run agents:approvals -- show <id>
 *   npm run agents:approvals -- approve <id> [--note "..."]
 *   npm run agents:approvals -- reject <id> [--note "..."]
 *   npm run agents:events                           -- recent event log (--limit, --cycle, --type)
 *   npm run agents:task -- agents                   -- list known agent roles/permission profiles
 *   npm run agents:task -- tasks                    -- list ai/tasks/ execution history
 *   npm run agents:scheduler                        -- run the persistent scheduler loop (blocks)
 *   npm run agents:scheduler-tick                   -- one eligibility check + (if eligible) one cycle, then exit
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CliClaudeInvoker } from './claude/claudeAdapter.js';
import { getAiTasksDir } from './paths.js';
import { REGISTRY } from './agents/registry.js';
import type { AgentRole } from './types/schemas.js';
import { getStandingObjective, setStandingObjective } from './autonomy/objective.js';
import { listBacklogItems, listAllBacklogItems, getBacklogItem } from './autonomy/backlogStore.js';
import { getCycleLock, getLatestCycle, listCycles } from './autonomy/cycleStore.js';
import { runCycle, DEFAULT_WORKER_TIMEOUT_MS } from './autonomy/cycle.js';
import { getSchedulerState, pauseAutonomy, resumeAutonomy, runSchedulerLoop, runSchedulerTick, startAutonomy, stopAutonomy } from './autonomy/scheduler.js';
import { decideApprovalRequest, getApprovalRequest, listApprovalRequests } from './autonomy/approvalStore.js';
import { listAutonomyEvents } from './autonomy/eventLog.js';
import { createWorkerProcessRegistry } from './autonomy/workerRegistry.js';
import type { BacklogStatus, EventType } from './autonomy/types.js';

/** Every REAL autonomous run (a launched `cycle` or the scheduler loop —
 * never the ad-hoc single-task `agents:task` CLI, which a human is
 * presumably watching) gets an invoker that (a) enforces a worker-level
 * timeout on every Claude call it makes, including ones deep inside
 * runTask()'s specialists/implementers/reviewers, since this exact same
 * invoker instance is threaded all the way through, and (b) durably
 * records every worker process it spawns so a crash of THIS orchestrator
 * process can still be cleaned up by a later one (see
 * workerRegistry.cleanupOrphanedWorkers(), called at the top of every
 * runCycle()). This is the one place both of those get wired together. */
function newAutonomousInvoker(args: string[]): CliClaudeInvoker {
  const override = flag(args, 'worker-timeout-ms');
  return new CliClaudeInvoker('claude', {
    defaultTimeoutMs: override ? Number(override) : DEFAULT_WORKER_TIMEOUT_MS,
    registry: createWorkerProcessRegistry(),
  });
}

export const AUTONOMY_COMMANDS = ['status', 'backlog', 'cycle', 'autonomous', 'approvals', 'events', 'agents', 'tasks', 'objective', 'scheduler-loop', 'scheduler-tick'] as const;
export type AutonomyCommand = (typeof AUTONOMY_COMMANDS)[number];

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function printTable(rows: Array<Record<string, string>>): void {
  if (rows.length === 0) {
    console.log('(none)');
    return;
  }
  const cols = Object.keys(rows[0] as Record<string, string>);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => (r[c] ?? '').length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i] ?? 0)).join('  ');
  console.log(line(cols));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const r of rows) console.log(line(cols.map((c) => r[c] ?? '')));
}

async function cmdStatus(): Promise<void> {
  const scheduler = getSchedulerState();
  const lock = getCycleLock();
  const latest = getLatestCycle();
  const backlog = listAllBacklogItems();
  const pendingApprovals = listApprovalRequests('PENDING');
  const recentEvents = listAutonomyEvents({ limit: 5 });

  const byStatus = new Map<string, number>();
  for (const item of backlog) byStatus.set(item.status, (byStatus.get(item.status) ?? 0) + 1);

  console.log('=== Muslim Rentals autonomy — status ===\n');
  console.log(`Standing objective: ${truncate(getStandingObjective(), 140)}\n`);
  console.log(`Scheduler:   ${scheduler.status}  (cadence: every ${scheduler.cadenceMinutes} min, next eligible: ${scheduler.nextEligibleAt ?? 'n/a'})`);
  console.log(`Cycle lock:  ${lock.locked ? `HELD by ${lock.cycleId} since ${lock.lockedAt}` : 'free'}`);
  console.log(`Last cycle:  ${latest ? `${latest.id}  ${latest.status}  started ${latest.startedAt}${latest.completedAt ? ` completed ${latest.completedAt}` : ''}` : '(none run yet)'}`);
  if (latest?.summary) console.log(`             ${truncate(latest.summary, 160)}`);
  console.log(`\nBacklog (${backlog.length} total):`);
  for (const [status, count] of byStatus) console.log(`  ${status.padEnd(18)} ${count}`);
  console.log(`\nPending approvals: ${pendingApprovals.length}`);
  for (const a of pendingApprovals.slice(0, 5)) console.log(`  ${a.id}  [${a.type}]  ${truncate(a.title, 90)}`);
  console.log(`\nRecent events:`);
  for (const e of recentEvents) console.log(`  ${e.ts}  ${e.type.padEnd(24)} ${truncate(e.message, 100)}`);
}

async function cmdBacklog(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === 'show') {
    const id = args[1];
    if (!id) throw new Error('Usage: backlog show <id>');
    const item = getBacklogItem(id);
    if (!item) throw new Error(`No backlog item "${id}"`);
    console.log(JSON.stringify(item, null, 2));
    return;
  }
  const statusFilter = flag(args, 'status') as BacklogStatus | undefined;
  const limit = Number(flag(args, 'limit') ?? '25');
  const items = listBacklogItems({ status: statusFilter, limit });
  printTable(
    items.map((i) => ({
      id: i.id,
      priority: i.priority.toFixed(1),
      risk: i.risk,
      status: i.status,
      category: i.category,
      title: truncate(i.title, 60),
    }))
  );
}

async function cmdCycle(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === 'status') {
    const latest = getLatestCycle();
    console.log(latest ? JSON.stringify(latest, null, 2) : '(no cycles have run yet)');
    return;
  }
  if (sub === 'history') {
    const limit = Number(flag(args, 'limit') ?? '10');
    const cycles = listCycles({ limit });
    printTable(
      cycles.map((c) => ({
        id: c.id,
        status: c.status,
        started: c.startedAt,
        result: c.result ?? '',
        summary: truncate(c.summary ?? '', 70),
      }))
    );
    return;
  }

  // No subcommand: actually launch one bounded cycle.
  const mode = args.includes('--dry-run') ? 'dry_run' : 'full';
  const includeDeepSignals = args.includes('--deep-signals');
  const includeLiveSiteSignal = args.includes('--live-site-signal');
  // Real autonomous cycles push reviewed work by default
  // (ai/operating-directive.md "Autonomous commit + push authority") —
  // --no-auto-push opts back out for a manual/inspection run. Auto-merging
  // into production is the OPPOSITE default: the founder's 2026-08-27
  // standing exception for that was explicitly suspended on 2026-09-01 in
  // favor of the ordinary feature-branch -> PR -> Deploy Preview -> founder
  // approval -> merge workflow (see ai/decisions.md and
  // ai/operating-directive.md "Production deploy policy" for both dates) —
  // pass --auto-merge-production/--verify-live-deploy explicitly to opt
  // back into the old always-on behavior for a specific run.
  const autoPush = !args.includes('--no-auto-push');
  const autoMergeToProduction = args.includes('--auto-merge-production');
  const verifyLiveDeployAfterProductionMerge = args.includes('--verify-live-deploy');
  console.log(
    `\n[autonomy] launching one bounded cycle — mode=${mode} includeDeepSignals=${includeDeepSignals} includeLiveSiteSignal=${includeLiveSiteSignal} autoPush=${autoPush} autoMergeToProduction=${autoMergeToProduction} verifyLiveDeployAfterProductionMerge=${verifyLiveDeployAfterProductionMerge}\n`
  );
  const outcome = await runCycle({
    invoker: newAutonomousInvoker(args),
    mode,
    includeDeepSignals,
    includeLiveSiteSignal,
    autoPush,
    autoMergeToProduction,
    verifyLiveDeployAfterProductionMerge,
  });
  if (outcome.skippedReason) {
    console.log(`[autonomy] skipped: ${outcome.skippedReason}`);
    return;
  }
  console.log(`\n[autonomy] cycle ${outcome.cycle?.id} finished — status=${outcome.cycle?.status} result=${outcome.cycle?.result ?? ''}`);
  console.log(`[autonomy] ${outcome.cycle?.summary ?? ''}`);
  if (outcome.execution) console.log(`[autonomy] execution: taskId=${outcome.execution.taskId} finalState=${outcome.execution.finalState}`);
}

async function cmdAutonomous(args: string[]): Promise<void> {
  const sub = args[0];
  const cadence = flag(args, 'cadence-minutes');
  switch (sub) {
    case 'start':
      console.log(JSON.stringify(startAutonomy(cadence ? Number(cadence) : undefined), null, 2));
      return;
    case 'pause':
      console.log(JSON.stringify(pauseAutonomy(), null, 2));
      return;
    case 'resume':
      console.log(JSON.stringify(resumeAutonomy(), null, 2));
      return;
    case 'stop':
      console.log(JSON.stringify(stopAutonomy(), null, 2));
      return;
    case 'status':
    case undefined:
      console.log(JSON.stringify(getSchedulerState(), null, 2));
      return;
    default:
      throw new Error(`Usage: autonomous <start|pause|resume|stop|status> [--cadence-minutes N]. Got "${sub}".`);
  }
}

async function cmdApprovals(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === 'show') {
    const id = args[1];
    if (!id) throw new Error('Usage: approvals show <id>');
    const req = getApprovalRequest(id);
    if (!req) throw new Error(`No approval request "${id}"`);
    console.log(JSON.stringify(req, null, 2));
    return;
  }
  if (sub === 'approve' || sub === 'reject') {
    const id = args[1];
    if (!id) throw new Error(`Usage: approvals ${sub} <id> [--note "..."]`);
    const note = flag(args, 'note');
    const updated = decideApprovalRequest(id, sub === 'approve' ? 'APPROVED' : 'REJECTED', note);
    console.log(JSON.stringify(updated, null, 2));
    return;
  }
  const requests = listApprovalRequests('PENDING');
  printTable(
    requests.map((r) => ({
      id: r.id,
      type: r.type,
      created: r.createdAt,
      title: truncate(r.title, 70),
    }))
  );
}

async function cmdEvents(args: string[]): Promise<void> {
  const limit = Number(flag(args, 'limit') ?? '30');
  const cycleId = flag(args, 'cycle');
  const type = flag(args, 'type') as EventType | undefined;
  const events = listAutonomyEvents({ limit, cycleId, type });
  printTable(events.map((e) => ({ ts: e.ts, type: e.type, cycleId: e.cycleId ?? '', message: truncate(e.message, 90) })));
}

async function cmdAgents(): Promise<void> {
  printTable(
    (Object.keys(REGISTRY) as AgentRole[]).map((role) => {
      const p = REGISTRY[role];
      return {
        role,
        roleFile: p.roleFile,
        canWriteCode: String(p.canWriteCode),
        needsWorktree: String(p.needsWorktree),
        maxBudgetUsd: String(p.maxBudgetUsd),
      };
    })
  );
}

async function cmdTasks(args: string[]): Promise<void> {
  const limit = Number(flag(args, 'limit') ?? '15');
  const dir = getAiTasksDir();
  if (!existsSync(dir)) {
    console.log('(no ai/tasks/ directory yet)');
    return;
  }
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse()
    .slice(0, limit);

  const rows = entries.map((id) => {
    const summaryPath = path.join(dir, id, 'final-report.summary.json');
    if (existsSync(summaryPath)) {
      const s = JSON.parse(readFileSync(summaryPath, 'utf8')) as { finalState?: string; qaVerdict?: string; securityVerdict?: string };
      return { id, finalState: s.finalState ?? '', qaVerdict: s.qaVerdict ?? '', securityVerdict: s.securityVerdict ?? '' };
    }
    return { id, finalState: '(in progress or no summary written)', qaVerdict: '', securityVerdict: '' };
  });
  printTable(rows);
}

async function cmdObjective(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log(getStandingObjective());
    return;
  }
  setStandingObjective(args.join(' '));
  console.log('Standing objective updated:\n');
  console.log(getStandingObjective());
}

async function cmdSchedulerLoop(args: string[]): Promise<void> {
  const tickIntervalMs = Number(flag(args, 'tick-interval-ms') ?? '60000');
  const includeDeepSignals = args.includes('--deep-signals');
  const includeLiveSiteSignal = args.includes('--live-site-signal');
  const autoPush = !args.includes('--no-auto-push');
  const autoMergeToProduction = args.includes('--auto-merge-production');
  const verifyLiveDeployAfterProductionMerge = args.includes('--verify-live-deploy');
  console.log(
    `[scheduler] starting persistent loop — tick every ${tickIntervalMs}ms. includeDeepSignals=${includeDeepSignals} includeLiveSiteSignal=${includeLiveSiteSignal} autoPush=${autoPush} autoMergeToProduction=${autoMergeToProduction} verifyLiveDeployAfterProductionMerge=${verifyLiveDeployAfterProductionMerge}. Ctrl+C (or kill this process) to stop. See orchestrator/README.md "Running autonomy persistently".`
  );
  await runSchedulerLoop({
    invoker: newAutonomousInvoker(args),
    tickIntervalMs,
    includeDeepSignals,
    includeLiveSiteSignal,
    autoPush,
    autoMergeToProduction,
    verifyLiveDeployAfterProductionMerge,
    onTick: (outcome) => {
      const ts = new Date().toISOString();
      if (outcome.result === 'launched') {
        console.log(`[scheduler] ${ts} launched cycle ${outcome.cycleOutcome?.cycle?.id} -> ${outcome.cycleOutcome?.cycle?.status}`);
      } else {
        console.log(`[scheduler] ${ts} tick: ${outcome.result}`);
      }
    },
  });
}

/** ONE eligibility check + (if eligible) ONE bounded cycle, then exit —
 * unlike `scheduler-loop`, which blocks forever polling on an interval.
 * Exists so an *external* scheduler (a cron job, a CCR/Claude Code Remote
 * Routine, systemd timer, etc.) can drive the same real cadence/pause/
 * lock bookkeeping `runSchedulerTick()` already implements (scheduler.ts)
 * without needing a long-lived Node process to survive in this container
 * — the documented failure mode in README.md's "Running autonomy
 * persistently" (a `nohup`'d scheduler-loop gets killed when the
 * container is reclaimed on idle). The persisted `scheduler_state` row
 * (start/pause/resume/stop, cadence, nextEligibleAt) is exactly the same
 * one `scheduler-loop` reads — an external trigger calling this
 * repeatedly is functionally equivalent to that loop's own tick, just
 * without requiring the process to stay resident between ticks. */
async function cmdSchedulerTick(args: string[]): Promise<void> {
  const includeDeepSignals = args.includes('--deep-signals');
  const includeLiveSiteSignal = args.includes('--live-site-signal');
  const autoPush = !args.includes('--no-auto-push');
  const autoMergeToProduction = args.includes('--auto-merge-production');
  const verifyLiveDeployAfterProductionMerge = args.includes('--verify-live-deploy');
  const outcome = await runSchedulerTick({
    invoker: newAutonomousInvoker(args),
    includeDeepSignals,
    includeLiveSiteSignal,
    autoPush,
    autoMergeToProduction,
    verifyLiveDeployAfterProductionMerge,
  });
  if (outcome.result !== 'launched') {
    console.log(`[scheduler-tick] ${outcome.result}`);
    return;
  }
  const c = outcome.cycleOutcome;
  console.log(`[scheduler-tick] launched cycle ${c?.cycle?.id} -> ${c?.cycle?.status} result=${c?.cycle?.result ?? ''}`);
  console.log(`[scheduler-tick] ${c?.cycle?.summary ?? ''}`);
  if (c?.execution) console.log(`[scheduler-tick] execution: taskId=${c.execution.taskId} finalState=${c.execution.finalState}`);
}

export async function runAutonomyCli(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command as AutonomyCommand) {
    case 'status':
      return cmdStatus();
    case 'backlog':
      return cmdBacklog(rest);
    case 'cycle':
      return cmdCycle(rest);
    case 'autonomous':
      return cmdAutonomous(rest);
    case 'approvals':
      return cmdApprovals(rest);
    case 'events':
      return cmdEvents(rest);
    case 'agents':
      return cmdAgents();
    case 'tasks':
      return cmdTasks(rest);
    case 'objective':
      return cmdObjective(rest);
    case 'scheduler-loop':
      return cmdSchedulerLoop(rest);
    case 'scheduler-tick':
      return cmdSchedulerTick(rest);
    default:
      throw new Error(`Unknown autonomy command "${command}". Known commands: ${AUTONOMY_COMMANDS.join(', ')}`);
  }
}
