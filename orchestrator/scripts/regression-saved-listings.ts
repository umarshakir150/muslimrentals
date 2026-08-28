/**
 * Regression check (task: fix cross-branch conflict detection, item #29).
 *
 * Runs the real, deterministic analyzeCrossBranch()/diffNameStatus() logic
 * against the ACTUAL saved-listings feature branches from the first real
 * --full orchestrator run (see ai/tasks/20260825-053836-...), as static
 * input — no worktrees are created, nothing is merged, nothing on those
 * branches is modified. This proves the new detection logic would have
 * caught the real incident it was built to fix: Frontend and Backend each
 * independently modified rentals/backend/src/routes/users.ts in isolated
 * worktrees, and each branch passed QA/Security review in isolation because
 * nothing ever compared them.
 *
 * Usage: npx tsx scripts/regression-saved-listings.ts
 */
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from '../src/paths.js';
import { analyzeCrossBranch, defaultScopes } from '../src/supervisor/crossBranchAnalysis.js';
import type { WorkerChangeSet } from '../src/types/schemas.js';

const FRONTEND_BRANCH = 'agents/20260825-053836-build-the-missing-saved-page-so/frontend';
const BACKEND_BRANCH = 'agents/20260825-053836-build-the-missing-saved-page-so/backend';

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function nameStatus(baseRef: string, branch: string): { added: string[]; modified: string[]; deleted: string[]; renamed: { from: string; to: string }[] } {
  const out = git('diff', '--no-color', '--name-status', baseRef, branch);
  const result = { added: [] as string[], modified: [] as string[], deleted: [] as string[], renamed: [] as { from: string; to: string }[] };
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0] as string;
    if (status.startsWith('R') && parts.length >= 3) result.renamed.push({ from: parts[1] as string, to: parts[2] as string });
    else if (status.startsWith('A') && parts[1]) result.added.push(parts[1]);
    else if (status.startsWith('D') && parts[1]) result.deleted.push(parts[1]);
    else if (parts[1]) result.modified.push(parts[1]);
  }
  return result;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`OK: ${msg}`);
  }
}

function main(): void {
  for (const branch of [FRONTEND_BRANCH, BACKEND_BRANCH]) {
    git('rev-parse', '--verify', branch); // throws if missing — fail loudly, don't silently skip
  }
  const baseCommit = git('merge-base', FRONTEND_BRANCH, BACKEND_BRANCH).trim();
  console.log(`Base commit (merge-base of both branches): ${baseCommit}\n`);

  const changeSets: WorkerChangeSet[] = [
    { agent: 'frontend', branch: FRONTEND_BRANCH, ...nameStatus(baseCommit, FRONTEND_BRANCH) },
    { agent: 'backend', branch: BACKEND_BRANCH, ...nameStatus(baseCommit, BACKEND_BRANCH) },
  ];
  console.log('Real changed-file sets:');
  console.log(JSON.stringify(changeSets, null, 2));

  const scopes = defaultScopes(['frontend', 'backend']);
  const report = analyzeCrossBranch('regression-saved-listings', changeSets, scopes);
  console.log('\nOverlapReport produced by analyzeCrossBranch():');
  console.log(JSON.stringify(report, null, 2));

  console.log('\n--- Assertions ---');
  const usersOverlap = report.overlaps.find((o) => o.path === 'rentals/backend/src/routes/users.ts');
  assert(!!usersOverlap, 'rentals/backend/src/routes/users.ts is detected as an overlap between frontend and backend');
  assert(usersOverlap?.classification === 'CONFLICTING', 'the users.ts overlap is classified CONFLICTING (not silently EXPECTED_SHARED or SUSPICIOUS)');
  assert(
    (usersOverlap?.agents ?? []).slice().sort().join(',') === 'backend,frontend',
    'the overlap names both frontend and backend as the agents involved'
  );

  const frontendOutOfScope = report.outOfScope.find((o) => o.agent === 'frontend' && o.path === 'rentals/backend/src/routes/users.ts');
  assert(!!frontendOutOfScope, "frontend's modification of rentals/backend/src/routes/users.ts is flagged OUT_OF_SCOPE_REVIEW_REQUIRED");

  assert(report.hasBlockingIssues === true, 'hasBlockingIssues is true — this run would have been routed to the Integrator, not silently approved twice in isolation');

  if (process.exitCode === 1) {
    console.error('\nRegression check FAILED — the new detection logic does not catch the real saved-listings divergence.');
    process.exit(1);
  }
  console.log('\nRegression check PASSED — the new detection logic correctly catches the real saved-listings divergence.');
}

main();
