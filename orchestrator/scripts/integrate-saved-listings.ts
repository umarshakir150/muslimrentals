/**
 * Real, production run of resumeIntegration() against the actual
 * saved-listings task — the exact case that originally exposed the need for
 * cross-branch analysis/integration. This spends real Claude API calls (the
 * Integrator, and integrated QA/Security) against the actual codebase, in
 * a real dedicated integration worktree.
 *
 * Does NOT re-invoke Supervisor/Frontend/Backend — those already ran for
 * this task; their branches are the input. Does NOT merge the integration
 * branch into the default branch, and does NOT deploy anything.
 *
 * Usage: npx tsx scripts/integrate-saved-listings.ts
 */
import { resumeIntegration } from '../src/supervisor/orchestrator.js';
import { CliClaudeInvoker } from '../src/claude/claudeAdapter.js';
import { taskDir } from '../src/task/taskStore.js';

const TASK_ID = '20260825-053836-build-the-missing-saved-page-so';
const FRONTEND_BRANCH = 'agents/20260825-053836-build-the-missing-saved-page-so/frontend';
const BACKEND_BRANCH = 'agents/20260825-053836-build-the-missing-saved-page-so/backend';

async function main(): Promise<void> {
  console.log(`\n[integrate] resuming task ${TASK_ID} into the integration pipeline`);
  console.log(`[integrate] frontend branch: ${FRONTEND_BRANCH}`);
  console.log(`[integrate] backend branch:  ${BACKEND_BRANCH}\n`);

  const result = await resumeIntegration({
    taskId: TASK_ID,
    invoker: new CliClaudeInvoker(),
    branches: { frontend: FRONTEND_BRANCH, backend: BACKEND_BRANCH },
  });

  console.log(`\n[integrate] finished — finalState=${result.finalState}`);
  console.log(`[integrate] task directory: ${taskDir(result.taskId)}`);
  console.log(`[integrate] integration worktree: ${result.integrationWorktree?.path ?? '(none)'}`);
  console.log(`[integrate] integration branch: ${result.integrationWorktree?.branch ?? '(none)'}`);
  console.log(`[integrate] QA verdict: ${result.finalReport.qaVerdict ?? 'N/A'}`);
  console.log(`[integrate] Security verdict: ${result.finalReport.securityVerdict ?? 'N/A'}`);
  console.log(`[integrate] correction cycles: ${result.finalReport.correctionCycles}`);
  if (result.finalState === 'FOUNDER_APPROVAL_REQUIRED') {
    console.log(`\nFOUNDER_APPROVAL_REQUIRED:`);
    for (const reason of result.finalReport.approvalGate.reasons) console.log(`  - ${reason}`);
  }
}

main().catch((err) => {
  console.error('[integrate] fatal error:', err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
