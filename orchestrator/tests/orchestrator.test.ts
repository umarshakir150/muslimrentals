import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runTask } from '../src/supervisor/orchestrator.js';
import { ScriptedClaudeInvoker } from '../src/claude/fakeInvoker.js';
import { taskDir } from '../src/task/taskStore.js';
import { getWorktreesRoot } from '../src/paths.js';
import {
  scriptedPlan,
  scriptedAnalysis,
  scriptedImplementation,
  scriptedImplementationWithFiles,
  scriptedReview,
  scriptedIntegrationResolves,
  cleanupWorktree,
} from './testUtils.js';
import type { WorktreeHandle } from '../src/git/worktree.js';
import type { RunResult } from '../src/supervisor/orchestrator.js';
import type { ClaudeInvokeOptions } from '../src/claude/claudeAdapter.js';

const createdWorktrees: WorktreeHandle[] = [];
afterEach(async () => {
  while (createdWorktrees.length) await cleanupWorktree(createdWorktrees.pop());
});

/** Register every worktree a run created (implementer branches AND, if it
 * ran, the integration branch) for afterEach cleanup. */
function trackWorktrees(result: RunResult): void {
  createdWorktrees.push(...Object.values(result.worktrees));
  if (result.integrationWorktree) createdWorktrees.push(result.integrationWorktree);
}

function readLog(taskId: string): Record<string, unknown>[] {
  const raw = readFileSync(path.join(taskDir(taskId), 'log.jsonl'), 'utf8');
  return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

describe('orchestrator — dry run', () => {
  it('runs specialists concurrently, forces engineering read-only, never implements, never creates a worktree', async () => {
    const taskId = 'test-dryrun-basic';
    const invoker = new ScriptedClaudeInvoker(
      {
        supervisor: scriptedPlan(['designer', 'trust_safety', 'legal', 'engineering', 'qa', 'security']),
        designer: scriptedAnalysis('designer'),
        trust_safety: scriptedAnalysis('trust_safety'),
        legal: scriptedAnalysis('legal'),
        engineering: scriptedAnalysis('engineering'),
      },
      (role) => (['designer', 'trust_safety', 'legal'].includes(role) ? 40 : 5)
    );

    const result = await runTask({ objective: 'Add roommate profile reporting', mode: 'dry_run', invoker, taskId });

    expect(result.finalState).toBe('DRY_RUN_COMPLETE');
    expect(Object.keys(result.worktrees)).toHaveLength(0);
    expect(existsSync(getWorktreesRoot()) ? readdirSync(getWorktreesRoot()).filter((f) => f.startsWith(taskId)) : []).toHaveLength(0);

    // Independent specialists actually overlapped in wall-clock time.
    const designerCalls = invoker.callsFor('designer');
    const legalCalls = invoker.callsFor('legal');
    expect(ScriptedClaudeInvoker.anyOverlap(designerCalls, legalCalls)).toBe(true);

    // Engineering ran in forced-read-only analysis mode, not implementation.
    const engCalls = invoker.callsFor('engineering');
    expect(engCalls).toHaveLength(1);
    expect(engCalls[0]!.options.tools).not.toContain('Write');
    expect(engCalls[0]!.options.tools).not.toContain('Edit');

    // Reviewers never ran — nothing to review in a dry run.
    expect(invoker.callsFor('qa')).toHaveLength(0);
    expect(invoker.callsFor('security')).toHaveLength(0);

    // Artifacts: only what actually ran.
    const dir = taskDir(taskId);
    expect(existsSync(path.join(dir, 'request.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'plan.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'designer.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'trust-safety.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'legal.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'engineering-plan.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'final-report.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'qa.json'))).toBe(false);
    expect(existsSync(path.join(dir, 'security.json'))).toBe(false);
  });
});

describe('orchestrator — full run, clean pass', () => {
  it('waits for specialists before implementing, implements in a worktree, runs QA+Security concurrently, completes', async () => {
    const taskId = 'test-full-clean';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['designer', 'engineering', 'qa', 'security']),
      designer: scriptedAnalysis('designer'),
      engineering: scriptedImplementation(),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });

    const result = await runTask({ objective: 'Add a loading spinner to the listing filters panel', mode: 'full', invoker, taskId });
    createdWorktrees.push(...Object.values(result.worktrees));

    expect(result.finalState).toBe('COMPLETE');
    expect(result.finalReport.qaVerdict).toBe('PASS');
    expect(result.finalReport.securityVerdict).toBe('APPROVED');
    expect(result.finalReport.correctionCycles).toBe(0);
    expect(result.worktrees.engineering).toBeDefined();
    expect(result.worktrees.engineering!.branch).toContain(taskId);

    // Dependency ordering: engineering only started after designer finished.
    const designerCall = invoker.callsFor('designer')[0]!;
    const engineeringCall = invoker.callsFor('engineering')[0]!;
    expect(engineeringCall.startedAt).toBeGreaterThanOrEqual(designerCall.finishedAt);

    // QA and Security are independent reviewers of the same diff — ran concurrently.
    const qaCall = invoker.callsFor('qa')[0]!;
    const securityCall = invoker.callsFor('security')[0]!;
    expect(ScriptedClaudeInvoker.anyOverlap([qaCall], [securityCall])).toBe(true);
    // ...and both started only after engineering finished.
    expect(qaCall.startedAt).toBeGreaterThanOrEqual(engineeringCall.finishedAt);
    expect(securityCall.startedAt).toBeGreaterThanOrEqual(engineeringCall.finishedAt);

    // Reviewers never got Write/Edit — they inspected, never rewrote.
    expect(qaCall.options.tools).not.toContain('Write');
    expect(securityCall.options.tools).not.toContain('Write');

    const dir = taskDir(taskId);
    for (const f of ['request.md', 'plan.json', 'designer.md', 'engineering-plan.md', 'qa.json', 'security.json', 'final-report.md', 'log.jsonl']) {
      expect(existsSync(path.join(dir, f)), f).toBe(true);
    }
    const log = readLog(taskId);
    expect(log.some((e) => e.event === 'state_transition' && e.state === 'COMPLETE')).toBe(true);
    expect(log.some((e) => e.event === 'review_verdict' && e.role === 'qa')).toBe(true);
  });
});

describe('orchestrator — correction loop', () => {
  it('sends engineering back to fix when QA returns CHANGES_REQUIRED, then completes once QA passes', async () => {
    const taskId = 'test-qa-rejects-once';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementation(),
      qa: (_opts: unknown, n: number) => (n === 0 ? scriptedReview('CHANGES_REQUIRED', [{ severity: 'high', finding: 'Missing empty state.' }]) : scriptedReview('PASS')),
      security: scriptedReview('APPROVED'),
    });

    const result = await runTask({ objective: 'Fix the empty state on the messages inbox', mode: 'full', invoker, taskId });
    createdWorktrees.push(...Object.values(result.worktrees));

    expect(result.finalState).toBe('COMPLETE');
    expect(result.finalReport.correctionCycles).toBe(1);
    expect(invoker.callsFor('engineering')).toHaveLength(2);
    expect(invoker.callsFor('qa')).toHaveLength(2);
    // Security re-runs on RE_REVIEW too, per the required state flow.
    expect(invoker.callsFor('security')).toHaveLength(2);

    // The second engineering call received the QA feedback as correction context.
    const secondEngCall = invoker.callsFor('engineering')[1]!;
    expect(secondEngCall.options.userPrompt).toMatch(/CHANGES_REQUIRED/);
    expect(secondEngCall.options.userPrompt).toMatch(/Missing empty state/);
  });

  it('sends engineering back to fix when Security returns CHANGES_REQUIRED, then completes once Security approves', async () => {
    const taskId = 'test-security-rejects-once';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementation(),
      qa: scriptedReview('PASS'),
      security: (_opts: unknown, n: number) =>
        n === 0 ? scriptedReview('CHANGES_REQUIRED', [{ severity: 'critical', finding: 'IDOR on listing update.' }]) : scriptedReview('APPROVED'),
    });

    const result = await runTask({ objective: 'Let owners edit their listing details', mode: 'full', invoker, taskId });
    createdWorktrees.push(...Object.values(result.worktrees));

    expect(result.finalState).toBe('COMPLETE');
    expect(result.finalReport.correctionCycles).toBe(1);
    expect(invoker.callsFor('engineering')).toHaveLength(2);
    const secondEngCall = invoker.callsFor('engineering')[1]!;
    expect(secondEngCall.options.userPrompt).toMatch(/IDOR on listing update/);
  });

  it('never lets Engineering approve its own work — QA/Security always run after every implementation attempt', async () => {
    const taskId = 'test-no-self-approval';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementation(),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });
    const result = await runTask({ objective: 'Add a favicon', mode: 'full', invoker, taskId });
    createdWorktrees.push(...Object.values(result.worktrees));
    // Both independent reviewers ran at least once and neither is the engineering role itself.
    expect(invoker.callsFor('qa').length).toBeGreaterThan(0);
    expect(invoker.callsFor('security').length).toBeGreaterThan(0);
  });
});

describe('orchestrator — retry limit', () => {
  it('stops looping after maxRetryCycles and escalates to the founder instead of looping forever', async () => {
    const taskId = 'test-retry-limit';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
      engineering: scriptedImplementation(),
      qa: () => scriptedReview('CHANGES_REQUIRED', [{ severity: 'medium', finding: 'Still broken.' }]),
      security: scriptedReview('APPROVED'),
    });

    const result = await runTask({ objective: 'Fix flaky listing pagination', mode: 'full', invoker, taskId, maxRetryCycles: 1 });
    createdWorktrees.push(...Object.values(result.worktrees));

    expect(result.finalState).toBe('FOUNDER_APPROVAL_REQUIRED');
    expect(result.finalReport.approvalGate.reasons.join(' ')).toMatch(/retry limit/i);
    // initial attempt + exactly 1 retry = 2, never unbounded.
    expect(invoker.callsFor('engineering')).toHaveLength(2);
    expect(invoker.callsFor('qa')).toHaveLength(2);
  });
});

describe('orchestrator — founder approval gate', () => {
  it('stops before implementation and never invokes engineering/qa/security when the objective needs founder approval', async () => {
    const taskId = 'test-founder-gate';
    const invoker = new ScriptedClaudeInvoker({
      // Deliberately have the (fake) Supervisor claim no approval is needed —
      // the deterministic CLAUDE.md-driven gate must still catch it.
      supervisor: scriptedPlan(['engineering', 'qa', 'security'], { founderApprovalRequired: false }),
      engineering: scriptedImplementation(),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });

    const result = await runTask({ objective: 'Deploy the new listings service to production', mode: 'full', invoker, taskId });

    expect(result.finalState).toBe('FOUNDER_APPROVAL_REQUIRED');
    expect(result.finalReport.approvalGate.required).toBe(true);
    expect(result.finalReport.approvalGate.reasons.length).toBeGreaterThan(0);
    expect(invoker.callsFor('engineering')).toHaveLength(0);
    expect(invoker.callsFor('qa')).toHaveLength(0);
    expect(invoker.callsFor('security')).toHaveLength(0);
    expect(Object.keys(result.worktrees)).toHaveLength(0);
    expect(existsSync(getWorktreesRoot()) ? readdirSync(getWorktreesRoot()).filter((f) => f.startsWith(taskId)) : []).toHaveLength(0);
  });

  it('a dry run never trips the founder gate into blocking (there is nothing to authorize)', async () => {
    const taskId = 'test-founder-gate-dryrun';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['engineering'], { founderApprovalRequired: false }),
      engineering: scriptedAnalysis('engineering'),
    });
    const result = await runTask({ objective: 'Deploy the new listings service to production', mode: 'dry_run', invoker, taskId });
    // Even though the founder gate is flagged true (visible in the plan/report),
    // dry run still completes as an analysis — it never implements regardless.
    expect(result.finalState).toBe('DRY_RUN_COMPLETE');
    expect(result.finalReport.approvalGate.required).toBe(true);
  });
});

// ─── Integration flow (2+ implementers) ───────────────────────────────────
// Regression context: the first real --full run had Frontend and Backend
// each independently modify rentals/backend/src/routes/users.ts in their
// own isolated worktrees; each branch passed QA/Security review in
// isolation, and nothing ever compared the two branches against each other.
// These tests exercise the fix: CROSS_BRANCH_ANALYSIS -> INTEGRATION ->
// INTEGRATED_QA_REVIEW -> INTEGRATED_SECURITY_REVIEW, with final approval
// coming only from review of the single integrated worktree.
//
// ScriptedClaudeInvoker never touches disk on its own, so any test here
// that needs the real git state cross-branch analysis/integration depends
// on (commitAll/diffNameStatus/mergeBranch) uses scriptedImplementationWithFiles
// / scriptedIntegrationResolves (tests/testUtils.ts) to actually write real
// files into the worktree the orchestrator hands each call.
describe('orchestrator — integration (2+ implementers, no overlap)', () => {
  it('merges cleanly with no Integrator agent call, and integrated QA/Security review the INTEGRATED worktree exactly once each — not the individual implementer worktrees', async () => {
    const taskId = 'test-integration-no-overlap';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['frontend', 'backend', 'qa', 'security']),
      frontend: scriptedImplementationWithFiles({ 'rentals/frontend/src/app/scratch-a.tsx': 'export default function A() { return null; }\n' }),
      backend: scriptedImplementationWithFiles({ 'rentals/backend/src/routes/scratch-a.ts': 'export const scratchA = true;\n' }),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });

    const result = await runTask({ objective: 'Add a saved listings page', mode: 'full', invoker, taskId });
    trackWorktrees(result);

    expect(result.finalState).toBe('COMPLETE');
    expect(result.integrationWorktree).toBeDefined();

    // No overlap/out-of-scope issues and a clean mechanical merge -> the
    // Integrator agent is never invoked at all (scenario: "no overlap").
    expect(invoker.callsFor('integrator')).toHaveLength(0);

    // Final approval comes from exactly ONE integrated review, never a sum
    // of per-worker approvals — one QA/Security call each, both against the
    // integration worktree, never frontend's or backend's own worktree.
    expect(invoker.callsFor('qa')).toHaveLength(1);
    expect(invoker.callsFor('security')).toHaveLength(1);
    expect(invoker.callsFor('qa')[0]!.options.cwd).toBe(result.integrationWorktree!.path);
    expect(invoker.callsFor('security')[0]!.options.cwd).toBe(result.integrationWorktree!.path);
    expect(invoker.callsFor('qa')[0]!.options.cwd).not.toBe(result.worktrees.frontend!.path);
    expect(invoker.callsFor('qa')[0]!.options.cwd).not.toBe(result.worktrees.backend!.path);

    const dir = taskDir(taskId);
    const overlapReport = JSON.parse(readFileSync(path.join(dir, 'overlap-report.json'), 'utf8'));
    expect(overlapReport.overlaps).toEqual([]);
    expect(overlapReport.outOfScope).toEqual([]);
    expect(overlapReport.hasBlockingIssues).toBe(false);
    expect(existsSync(path.join(dir, 'changed-files.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'implementation-scopes.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'integration-report.md'))).toBe(true);
  });
});

describe('orchestrator — integration (2+ implementers, conflicting overlap)', () => {
  it('flags frontend touching a backend file as both an overlap and out-of-scope, and invokes the Integrator even though the two edits merge cleanly at the text level', async () => {
    // This is structurally the real saved-listings incident: frontend
    // touches rentals/backend/src/routes/users.ts, which is outside its
    // default scope. Frontend edits the top of the file, backend edits the
    // bottom — git can auto-merge that with no textual conflict — but the
    // scope/overlap classification must still flag it and route it to the
    // Integrator, proving detection doesn't depend on git mergeability.
    const taskId = 'test-integration-conflicting-overlap';
    const sharedPath = 'rentals/backend/src/routes/users.ts';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['frontend', 'backend', 'qa', 'security']),
      frontend: (options: ClaudeInvokeOptions) => {
        const abs = path.join(options.cwd, sharedPath);
        writeFileSync(abs, `// frontend note\n${readFileSync(abs, 'utf8')}`, 'utf8');
        return scriptedImplementation([sharedPath]);
      },
      backend: (options: ClaudeInvokeOptions) => {
        const abs = path.join(options.cwd, sharedPath);
        writeFileSync(abs, `${readFileSync(abs, 'utf8')}\n// backend note\n`, 'utf8');
        return scriptedImplementation([sharedPath]);
      },
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
      integrator: scriptedIntegrationResolves(),
    });

    const result = await runTask({ objective: 'Add a saved listings page', mode: 'full', invoker, taskId });
    trackWorktrees(result);

    const dir = taskDir(taskId);
    const overlapReport = JSON.parse(readFileSync(path.join(dir, 'overlap-report.json'), 'utf8'));
    const overlap = overlapReport.overlaps.find((o: { path: string }) => o.path === sharedPath);
    expect(overlap).toBeDefined();
    expect(overlap.classification).toBe('CONFLICTING');
    expect(overlapReport.outOfScope).toHaveLength(1);
    expect(overlapReport.outOfScope[0]).toMatchObject({ agent: 'frontend', path: sharedPath, classification: 'OUT_OF_SCOPE_REVIEW_REQUIRED' });
    expect(overlapReport.hasBlockingIssues).toBe(true);

    // The Integrator agent WAS invoked despite a clean mechanical merge —
    // and its prompt did NOT need to ask it to merge anything itself, since
    // performMechanicalMerges already finished that part cleanly.
    expect(invoker.callsFor('integrator')).toHaveLength(1);
    expect(invoker.callsFor('integrator')[0]!.options.userPrompt).not.toMatch(/still need to be merged/);
    expect(invoker.callsFor('integrator')[0]!.options.cwd).toBe(result.integrationWorktree!.path);

    expect(result.finalState).toBe('COMPLETE');
  });
});

describe('orchestrator — integration (real git merge conflict)', () => {
  it('does not trust the Integrator\'s self-reported success — a real leftover conflict forces a second attempt, verified against git itself', async () => {
    const taskId = 'test-integration-real-conflict';
    const conflictPath = 'rentals/backend/src/routes/scratch-conflict.ts';
    let integratorCallCount = 0;
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['frontend', 'backend', 'qa', 'security']),
      // Both implementers ADD the same new path with different content —
      // a guaranteed add/add git conflict during the mechanical merge step.
      frontend: scriptedImplementationWithFiles({ [conflictPath]: 'export const scratchConflict = "frontend";\n' }),
      backend: scriptedImplementationWithFiles({ [conflictPath]: 'export const scratchConflict = "backend";\n' }),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
      integrator: (options: ClaudeInvokeOptions) => {
        integratorCallCount += 1;
        if (integratorCallCount === 1) {
          // Claims success but never touches the worktree — the real
          // conflict markers git left behind are still there.
          return { decisions: [], summary: 'Resolved everything.', filesChanged: [], unresolvedConflicts: [] };
        }
        // Second attempt: actually resolves it for real.
        return scriptedIntegrationResolves({ [conflictPath]: 'export const scratchConflict = "reconciled";\n' })(options);
      },
    });

    const result = await runTask({ objective: 'Add a saved listings page', mode: 'full', invoker, taskId });
    trackWorktrees(result);

    expect(result.finalState).toBe('COMPLETE');
    expect(result.finalReport.correctionCycles).toBe(1);
    expect(invoker.callsFor('integrator')).toHaveLength(2);

    // First attempt: the mechanical merge itself hit the conflict, so the
    // Integrator is told which branch still needs manual merging.
    const firstIntegratorCall = invoker.callsFor('integrator')[0]!;
    expect(firstIntegratorCall.options.userPrompt).toMatch(/still need to be merged/);

    // Second attempt happens because the orchestrator's own post-hoc git
    // check (not the model's "Resolved everything." self-report) caught
    // the leftover conflict and looped back with correction feedback.
    const secondIntegratorCall = invoker.callsFor('integrator')[1]!;
    expect(secondIntegratorCall.options.userPrompt).toMatch(/A previous integrated review found issues/i);
    expect(secondIntegratorCall.options.userPrompt).not.toMatch(/still need to be merged/);

    // Only QA/Security's final (passing) verdict counts.
    expect(result.finalReport.qaVerdict).toBe('PASS');
    expect(result.finalReport.securityVerdict).toBe('APPROVED');
  });
});

describe('orchestrator — integrated review correction loop', () => {
  it('routes a failed integrated QA verdict back through the Integrator — not the original implementers — then completes once QA passes', async () => {
    const taskId = 'test-integrated-qa-rejects-once';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['frontend', 'backend', 'qa', 'security']),
      frontend: scriptedImplementationWithFiles({ 'rentals/frontend/src/app/scratch-b.tsx': 'export default function B() { return null; }\n' }),
      backend: scriptedImplementationWithFiles({ 'rentals/backend/src/routes/scratch-b.ts': 'export const scratchB = true;\n' }),
      qa: (_opts: unknown, n: number) => (n === 0 ? scriptedReview('CHANGES_REQUIRED', [{ severity: 'high', finding: 'Missing empty state.' }]) : scriptedReview('PASS')),
      security: scriptedReview('APPROVED'),
      integrator: scriptedIntegrationResolves(),
    });

    const result = await runTask({ objective: 'Add a saved listings page', mode: 'full', invoker, taskId });
    trackWorktrees(result);

    expect(result.finalState).toBe('COMPLETE');
    expect(result.finalReport.correctionCycles).toBe(1);
    // The first integration pass merges cleanly with no scope issues, so it
    // needs no Integrator call — the ONLY Integrator call happens as
    // RE_INTEGRATION, after QA's rejection.
    expect(invoker.callsFor('integrator')).toHaveLength(1);
    // Frontend/backend are never re-invoked — correction after integrated
    // review goes through the Integrator, not back to the original implementers.
    expect(invoker.callsFor('frontend')).toHaveLength(1);
    expect(invoker.callsFor('backend')).toHaveLength(1);
    expect(invoker.callsFor('qa')).toHaveLength(2);
    expect(invoker.callsFor('security')).toHaveLength(2);

    expect(invoker.callsFor('integrator')[0]!.options.userPrompt).toMatch(/Missing empty state/);
  });

  it('routes a failed integrated Security verdict back through the Integrator, then completes once Security approves', async () => {
    const taskId = 'test-integrated-security-rejects-once';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['frontend', 'backend', 'qa', 'security']),
      frontend: scriptedImplementationWithFiles({ 'rentals/frontend/src/app/scratch-d.tsx': 'export default function D() { return null; }\n' }),
      backend: scriptedImplementationWithFiles({ 'rentals/backend/src/routes/scratch-d.ts': 'export const scratchD = true;\n' }),
      qa: scriptedReview('PASS'),
      security: (_opts: unknown, n: number) =>
        n === 0 ? scriptedReview('CHANGES_REQUIRED', [{ severity: 'critical', finding: 'IDOR on the integrated saved-listings route.' }]) : scriptedReview('APPROVED'),
      integrator: scriptedIntegrationResolves(),
    });

    const result = await runTask({ objective: 'Add a saved listings page', mode: 'full', invoker, taskId });
    trackWorktrees(result);

    expect(result.finalState).toBe('COMPLETE');
    expect(result.finalReport.correctionCycles).toBe(1);
    expect(invoker.callsFor('integrator')).toHaveLength(1);
    expect(invoker.callsFor('frontend')).toHaveLength(1);
    expect(invoker.callsFor('backend')).toHaveLength(1);
    expect(invoker.callsFor('integrator')[0]!.options.userPrompt).toMatch(/IDOR on the integrated saved-listings route/);
  });
});

describe('orchestrator — integrated review retry limit', () => {
  it('stops looping after maxRetryCycles when integrated QA keeps failing, and escalates to the founder instead of looping forever', async () => {
    const taskId = 'test-integrated-retry-limit';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['frontend', 'backend', 'qa', 'security']),
      frontend: scriptedImplementationWithFiles({ 'rentals/frontend/src/app/scratch-c.tsx': 'export default function C() { return null; }\n' }),
      backend: scriptedImplementationWithFiles({ 'rentals/backend/src/routes/scratch-c.ts': 'export const scratchC = true;\n' }),
      qa: () => scriptedReview('CHANGES_REQUIRED', [{ severity: 'medium', finding: 'Still broken.' }]),
      security: scriptedReview('APPROVED'),
      integrator: scriptedIntegrationResolves(),
    });

    const result = await runTask({ objective: 'Add a saved listings page', mode: 'full', invoker, taskId, maxRetryCycles: 1 });
    trackWorktrees(result);

    expect(result.finalState).toBe('FOUNDER_APPROVAL_REQUIRED');
    expect(result.finalReport.approvalGate.reasons.join(' ')).toMatch(/retry limit/i);
    // First pass needs no Integrator call (clean, no overlap); exactly one
    // RE_INTEGRATION retry is allowed before escalating — never unbounded.
    expect(invoker.callsFor('integrator')).toHaveLength(1);
    expect(invoker.callsFor('qa')).toHaveLength(2);
    expect(invoker.callsFor('security')).toHaveLength(2);
  });
});

describe('orchestrator — worktrees stay isolated and distinct across the integration flow', () => {
  it('gives frontend, backend, and the integration step three distinct real worktree paths, all still present afterward', async () => {
    const taskId = 'test-multi-worktree-both-reviewed';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['frontend', 'backend', 'qa', 'security']),
      frontend: scriptedImplementationWithFiles({ 'rentals/frontend/src/app/scratch-e.tsx': 'export default function E() { return null; }\n' }),
      backend: scriptedImplementationWithFiles({ 'rentals/backend/src/routes/scratch-e.ts': 'export const scratchE = true;\n' }),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });

    const result = await runTask({ objective: 'Add a saved listings page', mode: 'full', invoker, taskId });
    trackWorktrees(result);

    expect(result.finalState).toBe('COMPLETE');
    expect(result.worktrees.frontend).toBeDefined();
    expect(result.worktrees.backend).toBeDefined();
    expect(result.integrationWorktree).toBeDefined();
    const paths = [result.worktrees.frontend!.path, result.worktrees.backend!.path, result.integrationWorktree!.path];
    expect(new Set(paths).size).toBe(3);
    for (const p of paths) expect(existsSync(p)).toBe(true);
  });
});

describe('orchestrator — read-only roles cannot reach implementation', () => {
  it('QA and Security are never given a worktree even when they are the only roles requested', async () => {
    const taskId = 'test-readonly-no-worktree';
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['qa', 'security']),
      qa: scriptedReview('PASS'),
      security: scriptedReview('APPROVED'),
    });
    const result = await runTask({ objective: 'Review recent listing reports for patterns', mode: 'full', invoker, taskId });
    // No implementer roles were requested, so this is treated as analysis-only and completes.
    expect(result.finalState).toBe('COMPLETE');
    expect(Object.keys(result.worktrees)).toHaveLength(0);
    // qa/security were never invoked either, since there is no implementation to review yet
    // in this simplified flow (reviewers only run after an implementer produces a diff).
    expect(invoker.callsFor('qa')).toHaveLength(0);
    expect(invoker.callsFor('security')).toHaveLength(0);
  });
});
