import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { runTask } from '../src/supervisor/orchestrator.js';
import { ScriptedClaudeInvoker } from '../src/claude/fakeInvoker.js';
import { taskDir } from '../src/task/taskStore.js';
import { getWorktreesRoot } from '../src/paths.js';
import { scriptedPlan, scriptedAnalysis, scriptedImplementation, scriptedReview, cleanupWorktree } from './testUtils.js';
import type { WorktreeHandle } from '../src/git/worktree.js';

const createdWorktrees: WorktreeHandle[] = [];
afterEach(async () => {
  while (createdWorktrees.length) await cleanupWorktree(createdWorktrees.pop());
});

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
