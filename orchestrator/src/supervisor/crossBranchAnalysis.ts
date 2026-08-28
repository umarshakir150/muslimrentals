/**
 * Deterministic cross-branch conflict detection — no Claude call involved.
 * This is the fix for a real failure mode observed on the first --full run
 * against a real feature: Frontend and Backend each independently modified
 * `rentals/backend/src/routes/users.ts` in their own isolated worktrees,
 * each branch passed QA/Security review in isolation, and nothing caught
 * that the two branches were incompatible.
 *
 * Scheduling in this orchestrator is already deterministic-by-design (see
 * planner.ts's canonicalGrouping) rather than left to model judgment. This
 * module applies the same philosophy to scope/overlap: whether two
 * implementers' changes overlap, and whether either strayed outside its
 * assigned area, is a factual question answerable from git — so it's
 * answered by code, once, reliably, not asked of a model per task.
 */
import type { AgentRole, ImplementationScope, OverlapEntry, OutOfScopeEntry, OverlapReport, WorkerChangeSet } from '../types/schemas.js';

// Default per-role scope, used unless a task's plan overrides it. Kept
// narrow and conservative — this is exactly what would have caught the
// saved-listings divergence: Frontend's default scope never includes
// rentals/backend/**, so Frontend editing users.ts is flagged immediately,
// with zero task-specific configuration required.
const DEFAULT_SCOPE_PATHS: Partial<Record<AgentRole, string[]>> = {
  frontend: ['rentals/frontend/**'],
  backend: ['rentals/backend/**'],
  // The unified "engineering" role is intentionally allowed to touch both
  // sides — it's the role used specifically when work does NOT cleanly
  // split into Frontend/Backend, so a narrower scope would be actively wrong.
  engineering: ['rentals/**'],
};

export function defaultScopeFor(agent: AgentRole): ImplementationScope {
  return { agent, expectedPaths: DEFAULT_SCOPE_PATHS[agent] ?? ['rentals/**'], allowedSharedPaths: [] };
}

export function defaultScopes(agents: AgentRole[]): ImplementationScope[] {
  return agents.map(defaultScopeFor);
}

/**
 * Minimal glob support — exact match, or a "prefix/**" / "prefix**" style
 * suffix wildcard. That's the entire pattern vocabulary this orchestrator's
 * scopes need (directory-scoped ownership); not a general-purpose glob
 * engine, and deliberately not a new dependency for one.
 */
export function matchesGlob(filePath: string, pattern: string): boolean {
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return filePath === prefix || filePath.startsWith(prefix + '/');
  }
  if (pattern.endsWith('**')) {
    return filePath.startsWith(pattern.slice(0, -2));
  }
  return filePath === pattern;
}

function matchesAny(filePath: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesGlob(filePath, p));
}

export function isExpected(filePath: string, scope: ImplementationScope): boolean {
  return matchesAny(filePath, scope.expectedPaths);
}

export function isAllowedShared(filePath: string, scope: ImplementationScope): boolean {
  return matchesAny(filePath, scope.allowedSharedPaths);
}

export function isInScope(filePath: string, scope: ImplementationScope): boolean {
  return isExpected(filePath, scope) || isAllowedShared(filePath, scope);
}

/** Accepts anything with the four path-list fields — a full WorkerChangeSet,
 * or a bare NameStatusDiff (src/git/worktree.ts) before it's been tagged
 * with an agent/branch. */
export function allChangedPaths(cs: Pick<WorkerChangeSet, 'added' | 'modified' | 'deleted' | 'renamed'>): string[] {
  return [...cs.added, ...cs.modified, ...cs.deleted, ...cs.renamed.map((r) => r.to)];
}

/**
 * The core analysis. Two independent passes over the same change sets:
 *   1. Overlap — does more than one agent touch the same path at all?
 *   2. Scope — did any single agent touch a path outside its own scope?
 * A path can appear in both (that's exactly the saved-listings case: an
 * overlap where one side was also out of scope) — the two passes are
 * reported separately because they're different questions with different
 * remedies (reconcile two implementations vs. reconsider a scope decision).
 */
export function analyzeCrossBranch(
  taskId: string,
  changeSets: WorkerChangeSet[],
  scopes: ImplementationScope[]
): OverlapReport {
  const scopeByAgent = new Map(scopes.map((s) => [s.agent, s]));

  const touchedBy = new Map<string, AgentRole[]>();
  for (const cs of changeSets) {
    for (const p of allChangedPaths(cs)) {
      touchedBy.set(p, [...(touchedBy.get(p) ?? []), cs.agent]);
    }
  }

  const overlaps: OverlapEntry[] = [];
  for (const [filePath, agents] of touchedBy) {
    if (agents.length < 2) continue;

    const allDeclaredShared = agents.every((a) => {
      const scope = scopeByAgent.get(a);
      return scope ? isAllowedShared(filePath, scope) : false;
    });
    if (allDeclaredShared) {
      overlaps.push({
        path: filePath,
        agents,
        classification: 'EXPECTED_SHARED',
        reason: `Declared as an allowed shared path for every agent that touched it (${agents.join(', ')}).`,
      });
      continue;
    }

    const anyOutOfScope = agents.some((a) => {
      const scope = scopeByAgent.get(a);
      return scope ? !isInScope(filePath, scope) : false;
    });
    if (anyOutOfScope) {
      overlaps.push({
        path: filePath,
        agents,
        classification: 'CONFLICTING',
        reason: `${agents.length} workers (${agents.join(', ')}) independently modified the same file, and it was not within every one of their expected scopes — undeclared cross-cutting change, not a coordinated shared edit.`,
      });
      continue;
    }

    overlaps.push({
      path: filePath,
      agents,
      classification: 'SUSPICIOUS',
      reason: `${agents.length} workers (${agents.join(', ')}) both modified a file within their own expected scope, but it was not declared as an intentionally shared path — worth confirming the two changes are actually compatible.`,
    });
  }

  const outOfScope: OutOfScopeEntry[] = [];
  for (const cs of changeSets) {
    const scope = scopeByAgent.get(cs.agent);
    if (!scope) continue;
    for (const filePath of allChangedPaths(cs)) {
      if (!isInScope(filePath, scope)) {
        outOfScope.push({
          agent: cs.agent,
          path: filePath,
          classification: 'OUT_OF_SCOPE_REVIEW_REQUIRED',
          reason: `"${cs.agent}" modified "${filePath}", which is outside its expected scope (${scope.expectedPaths.join(', ')}).`,
        });
      }
    }
  }

  const hasBlockingIssues = overlaps.some((o) => o.classification === 'CONFLICTING') || outOfScope.length > 0;

  return { taskId, overlaps, outOfScope, hasBlockingIssues };
}
