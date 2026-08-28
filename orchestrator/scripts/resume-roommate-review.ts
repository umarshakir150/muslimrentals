/**
 * Real, production run of resumeIntegratedReview() against the actual
 * Roommate Profiles MVP task — resumes review against the already-built,
 * already-reconciled integration worktree from the run that hit the
 * npm-install/tsc Bash-permission gap (since fixed).
 *
 * Usage: npx tsx scripts/resume-roommate-review.ts
 */
import { resumeIntegratedReview } from '../src/supervisor/orchestrator.js';
import { CliClaudeInvoker } from '../src/claude/claudeAdapter.js';
import { taskDir } from '../src/task/taskStore.js';

const TASK_ID = '20260826-093438-design-and-build-the-first-production-ready';

async function main(): Promise<void> {
  console.log(`\n[resume-review] resuming task ${TASK_ID} into INTEGRATED_QA_REVIEW\n`);

  const result = await resumeIntegratedReview({
    taskId: TASK_ID,
    invoker: new CliClaudeInvoker(),
  });

  console.log(`\n[resume-review] finished — finalState=${result.finalState}`);
  console.log(`[resume-review] task directory: ${taskDir(result.taskId)}`);
  console.log(`[resume-review] integration worktree: ${result.integrationWorktree?.path ?? '(none)'}`);
  console.log(`[resume-review] QA verdict: ${result.finalReport.qaVerdict ?? 'N/A'}`);
  console.log(`[resume-review] Security verdict: ${result.finalReport.securityVerdict ?? 'N/A'}`);
  console.log(`[resume-review] correction cycles: ${result.finalReport.correctionCycles}`);
  if (result.finalState === 'FOUNDER_APPROVAL_REQUIRED') {
    console.log(`\nFOUNDER_APPROVAL_REQUIRED:`);
    for (const reason of result.finalReport.approvalGate.reasons) console.log(`  - ${reason}`);
  }
}

main().catch((err) => {
  console.error('[resume-review] fatal error:', err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
