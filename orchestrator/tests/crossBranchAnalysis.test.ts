/**
 * Pure unit tests for the deterministic cross-branch overlap/scope analysis
 * (src/supervisor/crossBranchAnalysis.ts) — no Claude calls, no git, no
 * worktrees. This is where the fast, precise scenario coverage for the
 * classification rules lives; tests/orchestrator.test.ts covers the same
 * scenarios end-to-end through the real orchestrator + real worktrees.
 */
import { describe, it, expect } from 'vitest';
import { analyzeCrossBranch, defaultScopeFor, defaultScopes } from '../src/supervisor/crossBranchAnalysis.js';
import type { ImplementationScope, WorkerChangeSet } from '../src/types/schemas.js';

function changeSet(agent: WorkerChangeSet['agent'], modified: string[]): WorkerChangeSet {
  return { agent, branch: `agents/test/${agent}`, added: [], modified, deleted: [], renamed: [] };
}

describe('crossBranchAnalysis — scenario 1: no overlap', () => {
  it('two workers touching entirely disjoint files produce no overlaps and no blocking issues', () => {
    const scopes = defaultScopes(['frontend', 'backend']);
    const changeSets = [
      changeSet('frontend', ['rentals/frontend/src/app/saved/page.tsx']),
      changeSet('backend', ['rentals/backend/src/routes/saved.ts']),
    ];

    const report = analyzeCrossBranch('t1', changeSets, scopes);

    expect(report.overlaps).toEqual([]);
    expect(report.outOfScope).toEqual([]);
    expect(report.hasBlockingIssues).toBe(false);
  });
});

describe('crossBranchAnalysis — scenario 2: same file changed by two workers', () => {
  it('is recorded as an overlap entry naming both agents', () => {
    const scopes = defaultScopes(['frontend', 'backend']);
    const changeSets = [
      changeSet('frontend', ['rentals/backend/src/routes/users.ts']),
      changeSet('backend', ['rentals/backend/src/routes/users.ts']),
    ];

    const report = analyzeCrossBranch('t2', changeSets, scopes);

    expect(report.overlaps).toHaveLength(1);
    expect(report.overlaps[0]!.path).toBe('rentals/backend/src/routes/users.ts');
    expect(report.overlaps[0]!.agents.sort()).toEqual(['backend', 'frontend']);
  });
});

describe('crossBranchAnalysis — scenario 3: out-of-scope modification', () => {
  it('flags a worker touching a file outside its own expected scope as OUT_OF_SCOPE_REVIEW_REQUIRED, without auto-failing the task', () => {
    // This is structurally the exact saved-listings incident: frontend's
    // default scope is rentals/frontend/**, so it touching a backend route
    // file must be flagged, not silently accepted.
    const scopes = defaultScopes(['frontend', 'backend']);
    const changeSets = [
      changeSet('frontend', ['rentals/frontend/src/app/saved/page.tsx', 'rentals/backend/src/routes/users.ts']),
      changeSet('backend', ['rentals/backend/src/routes/users.ts']),
    ];

    const report = analyzeCrossBranch('t3', changeSets, scopes);

    expect(report.outOfScope).toHaveLength(1);
    expect(report.outOfScope[0]).toMatchObject({
      agent: 'frontend',
      path: 'rentals/backend/src/routes/users.ts',
      classification: 'OUT_OF_SCOPE_REVIEW_REQUIRED',
    });
    // The overlapping path is also classified CONFLICTING (overlap + one
    // side out of scope), but classification alone never fails the task —
    // hasBlockingIssues only routes it to the Integrator/founder, it doesn't
    // abort anything on its own.
    const overlap = report.overlaps.find((o) => o.path === 'rentals/backend/src/routes/users.ts');
    expect(overlap?.classification).toBe('CONFLICTING');
    expect(report.hasBlockingIssues).toBe(true);
  });
});

describe('crossBranchAnalysis — scenario 4: allowed shared path', () => {
  it('a file both workers are explicitly allowed to share is EXPECTED_SHARED, not suspicious or blocking', () => {
    const scopes: ImplementationScope[] = [
      { agent: 'frontend', expectedPaths: ['rentals/frontend/**'], allowedSharedPaths: ['rentals/shared/types.ts'] },
      { agent: 'backend', expectedPaths: ['rentals/backend/**'], allowedSharedPaths: ['rentals/shared/types.ts'] },
    ];
    const changeSets = [
      changeSet('frontend', ['rentals/shared/types.ts']),
      changeSet('backend', ['rentals/shared/types.ts']),
    ];

    const report = analyzeCrossBranch('t4', changeSets, scopes);

    expect(report.overlaps).toHaveLength(1);
    expect(report.overlaps[0]!.classification).toBe('EXPECTED_SHARED');
    expect(report.outOfScope).toEqual([]);
    expect(report.hasBlockingIssues).toBe(false);
  });
});

describe('crossBranchAnalysis — scenario 6: semantic overlap without a git conflict', () => {
  it('flags an overlap purely from touching the same path — independent of whether the edits would textually conflict', () => {
    // analyzeCrossBranch only ever looks at path lists (WorkerChangeSet),
    // never at diff content or git mergeability. Two workers editing
    // different, non-conflicting line ranges of the same file still
    // produce the same overlap entry a textual conflict would — this is
    // the point: overlap detection must not depend on git being unable to
    // auto-merge, since two DIFFERENT, silently-incompatible implementations
    // of the same behavior (the real saved-listings case) can merge cleanly
    // at the text level while still being wrong together.
    const scopes = defaultScopes(['frontend', 'backend']);
    const changeSets = [
      changeSet('frontend', ['rentals/backend/src/routes/users.ts']),
      changeSet('backend', ['rentals/backend/src/routes/users.ts']),
    ];

    const report = analyzeCrossBranch('t6', changeSets, scopes);

    const overlap = report.overlaps.find((o) => o.path === 'rentals/backend/src/routes/users.ts');
    expect(overlap).toBeDefined();
    expect(report.hasBlockingIssues).toBe(true); // still routed to integration review
  });
});

describe('crossBranchAnalysis — defaultScopeFor/defaultScopes', () => {
  it('gives frontend and backend disjoint default scopes, and engineering the full app', () => {
    expect(defaultScopeFor('frontend').expectedPaths).toEqual(['rentals/frontend/**']);
    expect(defaultScopeFor('backend').expectedPaths).toEqual(['rentals/backend/**']);
    expect(defaultScopeFor('engineering').expectedPaths).toEqual(['rentals/**']);
    expect(defaultScopes(['frontend', 'backend']).map((s) => s.agent)).toEqual(['frontend', 'backend']);
  });
});
