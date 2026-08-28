import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentRole } from '../src/types/schemas.js';
import { createWorktree, removeWorktree, type WorktreeHandle } from '../src/git/worktree.js';
import type { ClaudeInvokeOptions } from '../src/claude/claudeAdapter.js';

export function scriptedPlan(requiredAgents: AgentRole[], opts: { founderApprovalRequired?: boolean; reasons?: string[] } = {}) {
  return {
    requiredAgents,
    dependencies: {},
    parallelGroups: [requiredAgents],
    approvalRequirements: {
      founderApprovalRequired: opts.founderApprovalRequired ?? false,
      reasons: opts.reasons ?? [],
    },
    expectedArtifacts: [],
    riskNotes: [],
  };
}

export function scriptedAnalysis(role: string, summary = `${role} analysis`) {
  return {
    summary,
    findings: [],
    openQuestions: [],
    recommendation: `${role} recommends proceeding.`,
  };
}

export function scriptedImplementation(filesChanged: string[] = ['rentals/backend/src/routes/example.ts']) {
  return {
    filesChanged,
    summary: 'Implemented the requested change.',
    testPlan: 'Ran the relevant manual checks.',
    selfCheckNotes: [],
    noChangesNeeded: false,
  };
}

export function scriptedReview(verdict: 'PASS' | 'APPROVED' | 'CHANGES_REQUIRED', findings: unknown[] = []) {
  return { verdict, findings };
}

/** Best-effort cleanup of a worktree+branch a test created; ignores errors (may not exist). */
export async function cleanupWorktree(handle: WorktreeHandle | undefined): Promise<void> {
  if (!handle) return;
  try {
    await removeWorktree(handle, { deleteBranch: true });
  } catch {
    // already cleaned up or never fully created — fine for test teardown
  }
}

function writeFiles(cwd: string, files: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(cwd, relPath);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
}

/**
 * Simulates a real implementer that actually writes files, not just a self-
 * report. ScriptedClaudeInvoker never touches disk on its own, but the new
 * cross-branch-analysis / integration flow depends on real git state
 * (commitAll/diffNameStatus/mergeBranch all read the worktree on disk) — so
 * any test exercising that flow needs its "implementer" responses to leave
 * real files behind in `options.cwd` (the worktree the orchestrator created
 * for that role), not just report paths in the JSON payload.
 */
export function scriptedImplementationWithFiles(files: Record<string, string>) {
  return (options: ClaudeInvokeOptions) => {
    writeFiles(options.cwd, files);
    return scriptedImplementation(Object.keys(files));
  };
}

/**
 * Simulates a real Integrator agent that actually reconciles: writes the
 * given (already-resolved) file contents into the integration worktree,
 * stages everything, and commits — finishing whatever merge the orchestrator
 * left in progress. Returns an IntegrationResult payload with no unresolved
 * conflicts.
 */
export function scriptedIntegrationResolves(files: Record<string, string> = {}, decisions: unknown[] = [], summary = 'Reconciled overlapping changes.') {
  return (options: ClaudeInvokeOptions) => {
    writeFiles(options.cwd, files);
    execFileSync('git', ['add', '-A'], { cwd: options.cwd });
    try {
      execFileSync('git', ['commit', '-m', 'integrator: reconcile'], { cwd: options.cwd });
    } catch {
      // Nothing staged (e.g. everything was already committed by a prior
      // clean mechanical merge) — fine, not every reconciliation needs a new commit.
    }
    return { decisions, summary, filesChanged: [], unresolvedConflicts: [] };
  };
}

/**
 * Simulates a broken/dishonest Integrator: claims success in its structured
 * response but leaves the worktree with a real, unresolved git conflict (no
 * commit). Pins the "trust but verify" behavior in orchestrator.ts's
 * runIntegrator() — it re-checks the worktree itself via unresolvedConflicts()
 * rather than believing the model's self-report.
 */
export function scriptedIntegrationClaimsSuccessButLeavesConflict(summary = 'Resolved everything.') {
  return () => ({ decisions: [], summary, filesChanged: [], unresolvedConflicts: [] });
}

/**
 * Creates a real, already-committed branch with real file content — standing
 * in for an implementer branch left over from a PRIOR run, as
 * resumeIntegration() expects to attach to. Returns just the branch name;
 * the worktree used to create it is removed immediately (deleteBranch:
 * false) so the branch is free for resumeIntegration()'s own
 * addWorktreeForExistingBranch() to attach to — git disallows checking out
 * the same branch in two worktrees at once.
 */
export async function createPreexistingBranch(taskId: string, role: string, baseRef: string, files: Record<string, string>): Promise<string> {
  const wt = await createWorktree(`${taskId}-seed`, role, baseRef);
  writeFiles(wt.path, files);
  execFileSync('git', ['add', '-A'], { cwd: wt.path });
  execFileSync('git', ['commit', '-m', `${role}: preexisting implementation`], { cwd: wt.path });
  await removeWorktree(wt, { deleteBranch: false });
  return wt.branch;
}
