import type { AgentRole } from '../src/types/schemas.js';
import { removeWorktree, type WorktreeHandle } from '../src/git/worktree.js';

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
