#!/usr/bin/env node
/**
 * `npm run agents:task -- "<objective>"` — dry run (default, safe).
 * `npm run agents:task -- "<objective>" --full` — authorizes implementation.
 *
 * Dry run is the default deliberately: it's easy to invoke the powerful
 * path (--full) by accident if it's the default, and this task explicitly
 * asks for dry-run-by-default. See orchestrator/README.md "Dry-run mode".
 */
import { runTask, DEFAULT_MAX_RETRY_CYCLES, DEFAULT_MAX_CONCURRENCY } from './supervisor/orchestrator.js';
import { DEFAULT_MAX_AGENTS_PER_TASK } from './supervisor/planner.js';
import { CliClaudeInvoker } from './claude/claudeAdapter.js';
import { taskDir } from './task/taskStore.js';
import { AUTONOMY_COMMANDS, runAutonomyCli } from './autonomyCli.js';

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let full = false;
  let maxAgents = DEFAULT_MAX_AGENTS_PER_TASK;
  let maxRetries = DEFAULT_MAX_RETRY_CYCLES;
  let maxConcurrency = DEFAULT_MAX_CONCURRENCY;
  const objectiveParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--full') full = true;
    else if (a === '--dry-run') full = false;
    else if (a === '--max-agents') maxAgents = Number(args[++i]);
    else if (a === '--max-retries') maxRetries = Number(args[++i]);
    else if (a === '--max-concurrency') maxConcurrency = Number(args[++i]);
    else objectiveParts.push(a as string);
  }

  return { objective: objectiveParts.join(' ').trim(), full, maxAgents, maxRetries, maxConcurrency };
}

async function main() {
  // A small reserved set of leading words routes to the autonomy-layer CLI
  // (src/autonomyCli.ts — status/backlog/cycle/autonomous/approvals/events/
  // agents/tasks/objective/scheduler-loop) instead of the single-task
  // runner below. Anything else — including a free-text objective that
  // happens to start with an ordinary word — falls through unchanged to
  // the original behavior, so `npm run agents:task -- "<objective>"` keeps
  // working exactly as it always has.
  const first = process.argv[2];
  if ((AUTONOMY_COMMANDS as readonly string[]).includes(first ?? '')) {
    await runAutonomyCli(process.argv.slice(2));
    return;
  }

  const { objective, full, maxAgents, maxRetries, maxConcurrency } = parseArgs(process.argv);

  if (!objective) {
    console.error(
      'Usage: npm run agents:task -- "<objective>"                 (dry run, default)\n' +
        '       npm run agents:task -- "<objective>" --full         (authorize implementation)\n' +
        '       npm run agents:task -- "<objective>" --max-agents 6 --max-retries 1 --max-concurrency 3\n\n' +
        'Autonomy layer: npm run agents:status | agents:backlog | agents:cycle | agents:autonomous -- <start|pause|resume|stop|status> | agents:approvals | agents:events | agents:scheduler\n' +
        '(full reference: orchestrator/README.md "Autonomy")'
    );
    process.exitCode = 1;
    return;
  }

  const mode = full ? 'full' : 'dry_run';
  console.log(`\n[orchestrator] mode=${mode} objective="${objective}"\n`);

  const result = await runTask({
    objective,
    mode,
    invoker: new CliClaudeInvoker(),
    maxAgentsPerTask: maxAgents,
    maxRetryCycles: maxRetries,
    maxConcurrency,
  });

  console.log(`\n[orchestrator] finished — taskId=${result.taskId} finalState=${result.finalState}`);
  console.log(`[orchestrator] task directory: ${taskDir(result.taskId)}`);
  if (result.finalState === 'FOUNDER_APPROVAL_REQUIRED') {
    console.log(`\nFOUNDER_APPROVAL_REQUIRED:`);
    for (const reason of result.finalReport.approvalGate.reasons) console.log(`  - ${reason}`);
  }
}

main().catch((err) => {
  console.error('[orchestrator] fatal error:', err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
