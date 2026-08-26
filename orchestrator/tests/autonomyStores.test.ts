/**
 * Deterministic, mocked-Claude-free tests for the autonomy layer's
 * persistence primitives (PART 22). Every test gets a fresh SQLite file
 * (beforeEach below) so counts/ordering assertions never depend on test
 * execution order. "Survives restart" tests explicitly call closeDb() and
 * let the next store call re-open the connection, which is the real
 * process-restart code path (src/autonomy/db.ts getDb()), not a stand-in.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/autonomy/db.js';
import { getAutonomyDbPath } from '../src/paths.js';

// Vitest runs test files in parallel worker processes/threads by default.
// node:sqlite is a single shared FILE, unlike ai/tasks/ or .worktrees/
// (independent per-taskId directories) — so every autonomy test file needs
// its own DB path, or two files racing a delete-and-recreate against the
// same file corrupt each other's connection ("disk I/O error", observed
// for real before this fix). vitest.config.ts's env only sets a default;
// override it here to a path unique to this file.
process.env.ORCHESTRATOR_AUTONOMY_DB = path.join(path.dirname(getAutonomyDbPath()), 'autonomy-stores.db');
import { createBacklogItem, findSimilarBacklogItems, getBacklogItem, listBacklogItems, mergeDuplicate, updateBacklogItem } from '../src/autonomy/backlogStore.js';
import { recordSignal, getSignal, listSignals, linkSignalToBacklogItem, fingerprintFor } from '../src/autonomy/signalStore.js';
import { recordMemory, getRelevantMemory, listMemory } from '../src/autonomy/memoryStore.js';
import { getStandingObjective, setStandingObjective } from '../src/autonomy/objective.js';
import { DEFAULT_STANDING_OBJECTIVE } from '../src/autonomy/types.js';
import { classifyRisk } from '../src/autonomy/riskClassification.js';
import { createApprovalRequest, decideApprovalRequest, getApprovalRequest, listApprovalRequests } from '../src/autonomy/approvalStore.js';
import { logAutonomyEvent, listAutonomyEvents } from '../src/autonomy/eventLog.js';
import { acquireCycleLock, createCycle, getCycle, getCycleLock, getInterruptedCycle, isLockStale, releaseCycleLock, updateCycle } from '../src/autonomy/cycleStore.js';
import { getSchedulerState, pauseAutonomy, resumeAutonomy, runSchedulerTick, setCadenceMinutes, startAutonomy, stopAutonomy } from '../src/autonomy/scheduler.js';
import type { ClaudeInvoker } from '../src/claude/claudeAdapter.js';

function freshDb(): void {
  closeDb();
  const dbPath = getAutonomyDbPath();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
}

beforeEach(() => {
  freshDb();
});

function baseItemInput(overrides: Partial<Parameters<typeof createBacklogItem>[0]> = {}) {
  return {
    title: 'Fix broken saved-listings empty state',
    description: 'The saved-listings page shows a blank screen instead of an empty-state message.',
    source: 'test',
    category: 'BUG' as const,
    userImpact: 3,
    severity: 2,
    confidence: 0.8,
    effort: 1,
    strategicRelevance: 2,
    rationale: 'Confirmed via manual inspection of the saved-listings page.',
    ...overrides,
  };
}

describe('backlogStore', () => {
  it('persists a created item and survives a simulated process restart', () => {
    const item = createBacklogItem(baseItemInput());
    closeDb(); // simulate the process ending — next call must re-open from disk
    const reloaded = getBacklogItem(item.id);
    expect(reloaded).toBeDefined();
    expect(reloaded?.title).toBe(item.title);
    expect(reloaded?.status).toBe('CANDIDATE');
  });

  it('always recomputes priority from scoring inputs rather than trusting a stored number', () => {
    const low = createBacklogItem(baseItemInput({ category: 'DOCUMENTATION', userImpact: 0, severity: 0, strategicRelevance: 0 }));
    const high = createBacklogItem(baseItemInput({ title: 'Fix IDOR on roommate profile edit', category: 'SECURITY', userImpact: 5, severity: 5, strategicRelevance: 4, confidence: 0.9 }));
    expect(high.priority).toBeGreaterThan(low.priority);
    expect(high.priorityRationale.length).toBeGreaterThan(0);
  });

  it('re-explains priority on every update via changeReason, always showing the new score components', () => {
    const item = createBacklogItem(baseItemInput());
    const updated = updateBacklogItem(item.id, { severity: 5, changeReason: 'New evidence: this blocks the core browse flow, not just an edge case.' });
    expect(updated.priority).not.toBe(item.priority);
    expect(updated.priorityRationale).toContain('severity=5');
    expect(updated.priorityRationale).toContain('New evidence: this blocks the core browse flow');
  });

  it('lists items priority-descending', () => {
    createBacklogItem(baseItemInput({ title: 'Low priority docs gap', category: 'DOCUMENTATION', userImpact: 0, severity: 0, strategicRelevance: 0 }));
    createBacklogItem(baseItemInput({ title: 'Critical security bug', category: 'SECURITY', userImpact: 5, severity: 5, strategicRelevance: 5, confidence: 1 }));
    const items = listBacklogItems();
    expect(items[0]?.title).toBe('Critical security bug');
    expect(items[items.length - 1]?.title).toBe('Low priority docs gap');
  });

  it('finds a near-duplicate by title/category token overlap, but not an unrelated item', () => {
    createBacklogItem(baseItemInput({ title: 'Saved listings page shows a blank empty state' }));
    const similar = findSimilarBacklogItems('Saved listings empty state is blank', 'BUG');
    expect(similar.length).toBeGreaterThan(0);

    const unrelated = findSimilarBacklogItems('Roommate profile photo upload is broken', 'BUG');
    expect(unrelated.length).toBe(0);
  });

  it('mergeDuplicate folds evidence into the survivor and marks the loser DUPLICATE, never silently discarding either', () => {
    const survivor = createBacklogItem(baseItemInput({ evidence: ['file:a.ts'] }));
    const dup = createBacklogItem(baseItemInput({ title: 'Saved listings empty state blank (dup)', evidence: ['file:b.ts'] }));
    const merged = mergeDuplicate(dup.id, survivor.id, 'Same underlying bug, different repro path.');
    expect(merged.status).toBe('DUPLICATE');
    const survivorAfter = getBacklogItem(survivor.id);
    expect(survivorAfter?.evidence).toEqual(expect.arrayContaining(['file:a.ts', 'file:b.ts']));
  });

  it('a status-only update never clobbers untouched scoring fields with undefined (regression — crashed a real autonomous cycle: a Lead status-only update nulled out userImpact/severity/confidence/effort/strategicRelevance via {...existing, ...patch} treating an omitted field the same as an explicit undefined)', () => {
    const item = createBacklogItem(baseItemInput({ userImpact: 4, severity: 3, confidence: 0.7, effort: 2, strategicRelevance: 3 }));
    const updated = updateBacklogItem(item.id, { status: 'READY', changeReason: 'Unblocking — root cause fixed.' });
    expect(updated.userImpact).toBe(4);
    expect(updated.severity).toBe(3);
    expect(updated.confidence).toBe(0.7);
    expect(updated.effort).toBe(2);
    expect(updated.strategicRelevance).toBe(3);
    expect(Number.isNaN(updated.priority)).toBe(false);
  });
});

describe('signalStore', () => {
  it('persists a new signal and survives a simulated restart', () => {
    const { signal, isNew } = recordSignal({ source: 'repo_scan', type: 'todo_comment', category: 'TECH_DEBT', severity: 1, confidence: 0.5, evidence: 'TODO: clean this up', location: 'foo.ts:12' });
    expect(isNew).toBe(true);
    closeDb();
    expect(getSignal(signal.id)?.evidence).toBe('TODO: clean this up');
  });

  it('deduplicates by fingerprint — re-observing the same signal refreshes observedAt instead of creating a second row', () => {
    const first = recordSignal({ source: 'repo_scan', type: 'todo_comment', category: 'TECH_DEBT', severity: 1, confidence: 0.5, evidence: 'TODO: x', location: 'foo.ts:1' });
    const second = recordSignal({ source: 'repo_scan', type: 'todo_comment', category: 'TECH_DEBT', severity: 1, confidence: 0.5, evidence: 'TODO: x', location: 'foo.ts:1' });
    expect(second.isNew).toBe(false);
    expect(second.signal.id).toBe(first.signal.id);
    expect(listSignals().length).toBe(1);
  });

  it('a genuinely different signal (different location) is a separate row', () => {
    recordSignal({ source: 'repo_scan', type: 'todo_comment', category: 'TECH_DEBT', severity: 1, confidence: 0.5, evidence: 'TODO: x', location: 'foo.ts:1' });
    recordSignal({ source: 'repo_scan', type: 'todo_comment', category: 'TECH_DEBT', severity: 1, confidence: 0.5, evidence: 'TODO: x', location: 'foo.ts:2' });
    expect(listSignals().length).toBe(2);
    expect(fingerprintFor({ source: 'a', type: 'b', evidence: 'c' })).toHaveLength(24);
  });

  it('links a signal to the backlog item it became evidence for', () => {
    const { signal } = recordSignal({ source: 'repo_scan', type: 'todo_comment', category: 'TECH_DEBT', severity: 1, confidence: 0.5, evidence: 'TODO: x' });
    const item = createBacklogItem(baseItemInput({ relatedSignals: [signal.id] }));
    const linked = linkSignalToBacklogItem(signal.id, item.id);
    expect(linked?.relatedBacklogItems).toContain(item.id);
  });
});

describe('memoryStore', () => {
  it('persists a memory record and survives a simulated restart', () => {
    const rec = recordMemory({ scope: 'product', type: 'constraint', content: 'Listings are never hard-deleted, only status-flagged.', source: 'test' });
    closeDb();
    expect(listMemory().find((r) => r.id === rec.id)?.content).toContain('never hard-deleted');
  });

  it('getRelevantMemory ranks by confidence then recency and respects the limit', () => {
    recordMemory({ scope: 'product', type: 'lesson', content: 'low confidence lesson', source: 'test', confidence: 0.2 });
    recordMemory({ scope: 'product', type: 'lesson', content: 'high confidence lesson', source: 'test', confidence: 0.95 });
    const results = getRelevantMemory({ limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe('high confidence lesson');
  });

  it('agent-scoped memory is only returned for the matching agent; product/decision/known_issue memory is always visible', () => {
    recordMemory({ scope: 'agent', agent: 'security', type: 'pattern', content: 'security-only note', source: 'test' });
    recordMemory({ scope: 'product', type: 'fact', content: 'product-wide fact', source: 'test' });

    const forFrontend = getRelevantMemory({ agent: 'frontend' });
    expect(forFrontend.some((r) => r.content === 'security-only note')).toBe(false);
    expect(forFrontend.some((r) => r.content === 'product-wide fact')).toBe(true);

    const forSecurity = getRelevantMemory({ agent: 'security' });
    expect(forSecurity.some((r) => r.content === 'security-only note')).toBe(true);
  });

  it('supersedes marks the prior record ARCHIVED/SUPERSEDED so getRelevantMemory does not return stale duplicates', () => {
    const original = recordMemory({ scope: 'decision', type: 'decision', content: 'Old decision', source: 'test' });
    recordMemory({ scope: 'decision', type: 'decision', content: 'New decision supersedes the old one', source: 'test', supersedes: original.id });
    const active = getRelevantMemory({ scopes: ['decision'] });
    expect(active.some((r) => r.id === original.id)).toBe(false);
    expect(active.some((r) => r.content.includes('New decision'))).toBe(true);
  });
});

describe('standing objective', () => {
  it('defaults to DEFAULT_STANDING_OBJECTIVE, then persists a founder-set override across a simulated restart', () => {
    expect(getStandingObjective()).toBe(DEFAULT_STANDING_OBJECTIVE);
    setStandingObjective('Focus only on messaging safety this quarter.');
    closeDb();
    expect(getStandingObjective()).toBe('Focus only on messaging safety this quarter.');
  });

  it('rejects an empty objective rather than silently persisting nothing', () => {
    expect(() => setStandingObjective('   ')).toThrow();
  });
});

describe('riskClassification', () => {
  it('classifies a CLAUDE.md founder-authority match as HIGH regardless of the item\'s own stored risk/category', () => {
    const result = classifyRisk({
      title: 'Deploy the new listings page to production',
      description: 'Ship the change live.',
      rationale: 'Users are waiting.',
      category: 'FEATURE_GAP',
      severity: 1,
      effort: 1,
      requiresFounderDecision: false,
      requiresLegalReview: false,
    });
    expect(result.risk).toBe('HIGH');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('classifies a small, low-severity bug fix as LOW — eligible for autonomous selection', () => {
    const result = classifyRisk({
      title: 'Saved listings page shows a blank empty state',
      description: 'Add an empty-state message.',
      rationale: 'Minor UX papercut.',
      category: 'BUG',
      severity: 1,
      effort: 1,
      requiresFounderDecision: false,
      requiresLegalReview: false,
    });
    expect(result.risk).toBe('LOW');
  });

  it('classifies an ordinary additive feature as MEDIUM — implementable on an isolated branch, not auto-deployed', () => {
    const result = classifyRisk({
      title: 'Add filtering to the roommate browse page',
      description: 'Let users filter roommate profiles by city.',
      rationale: 'Improves discovery.',
      category: 'FEATURE_GAP',
      severity: 3,
      effort: 3,
      requiresFounderDecision: false,
      requiresLegalReview: false,
    });
    expect(result.risk).toBe('MEDIUM');
  });

  it('LEGAL_FLAG category is always HIGH even with no other trigger', () => {
    const result = classifyRisk({
      title: 'Review discrimination risk in roommate filters',
      description: 'Legal issue-spotting only.',
      rationale: 'Flagged by Legal.',
      category: 'LEGAL_FLAG',
      severity: 1,
      effort: 1,
      requiresFounderDecision: false,
      requiresLegalReview: false,
    });
    expect(result.risk).toBe('HIGH');
  });
});

describe('approvalStore', () => {
  it('persists a PENDING approval request', () => {
    const req = createApprovalRequest({ type: 'FOUNDER_DECISION_REQUIRED', title: 'Test approval', description: 'desc' });
    expect(listApprovalRequests('PENDING').map((r) => r.id)).toContain(req.id);
    expect(getApprovalRequest(req.id)?.status).toBe('PENDING');
  });

  it('approving persists the decision and resuming (re-reading) reflects it', () => {
    const req = createApprovalRequest({ type: 'FOUNDER_DECISION_REQUIRED', title: 'Test approval', description: 'desc' });
    decideApprovalRequest(req.id, 'APPROVED', 'Looks safe.');
    closeDb();
    const reloaded = getApprovalRequest(req.id);
    expect(reloaded?.status).toBe('APPROVED');
    expect(reloaded?.decisionNote).toBe('Looks safe.');
  });

  it('rejecting persists REJECTED and a second decision on the same request throws instead of silently overwriting', () => {
    const req = createApprovalRequest({ type: 'FOUNDER_DECISION_REQUIRED', title: 'Test approval', description: 'desc' });
    decideApprovalRequest(req.id, 'REJECTED');
    expect(getApprovalRequest(req.id)?.status).toBe('REJECTED');
    expect(() => decideApprovalRequest(req.id, 'APPROVED')).toThrow();
  });
});

describe('eventLog', () => {
  it('persists events and lists them newest-first', async () => {
    logAutonomyEvent({ type: 'CYCLE_STARTED', message: 'first' });
    await new Promise((r) => setTimeout(r, 2));
    logAutonomyEvent({ type: 'CYCLE_COMPLETED', message: 'second' });
    const events = listAutonomyEvents();
    expect(events[0]?.message).toBe('second');
    expect(events[1]?.message).toBe('first');
  });

  it('filters by cycleId and type', () => {
    logAutonomyEvent({ type: 'CYCLE_STARTED', cycleId: 'cyc_a', message: 'a' });
    logAutonomyEvent({ type: 'CYCLE_STARTED', cycleId: 'cyc_b', message: 'b' });
    expect(listAutonomyEvents({ cycleId: 'cyc_a' })).toHaveLength(1);
    expect(listAutonomyEvents({ type: 'CYCLE_STARTED' }).length).toBeGreaterThanOrEqual(2);
  });

  it('redacts secret-shaped values before persisting, never logging a raw credential', () => {
    logAutonomyEvent({ type: 'CYCLE_FAILED', message: 'failed', data: { apiKey: 'sk-super-secret-value', note: 'fine' } });
    const [event] = listAutonomyEvents({ limit: 1 });
    expect(JSON.stringify(event?.data)).not.toContain('sk-super-secret-value');
  });
});

describe('cycleStore — persistence, lock, and crash recovery', () => {
  it('persists a cycle and survives a simulated restart', () => {
    const cycle = createCycle();
    closeDb();
    expect(getCycle(cycle.id)?.status).toBe('STARTING');
  });

  it('a status-only update never resets untouched counters to their Zod default (same class of bug as the backlogStore regression above — signalsCollected/modelCalls have z.number().default(0), so an explicit undefined in the patch silently resets them instead of failing loudly)', () => {
    const cycle = createCycle();
    updateCycle(cycle.id, { signalsCollected: 7, modelCalls: 2 });
    const updated = updateCycle(cycle.id, { status: 'EXECUTING' });
    expect(updated.signalsCollected).toBe(7);
    expect(updated.modelCalls).toBe(2);
  });

  it('the cycle lock prevents a second concurrent acquire, and release frees it for the next one', () => {
    const cycle = createCycle();
    expect(acquireCycleLock(cycle.id)).toBe(true);
    expect(getCycleLock().locked).toBe(true);
    expect(acquireCycleLock('some-other-cycle')).toBe(false); // still held
    releaseCycleLock();
    expect(getCycleLock().locked).toBe(false);
    expect(acquireCycleLock('some-other-cycle')).toBe(true);
  });

  it('detects an interrupted (non-terminal) cycle left by a crashed process', () => {
    const cycle = createCycle();
    updateCycle(cycle.id, { status: 'EXECUTING' });
    closeDb(); // simulate the process dying mid-cycle, no COMPLETED/FAILED ever written
    const interrupted = getInterruptedCycle();
    expect(interrupted?.id).toBe(cycle.id);
  });

  it('does not flag a cleanly COMPLETED cycle as interrupted', () => {
    const cycle = createCycle();
    updateCycle(cycle.id, { status: 'COMPLETED', completedAt: new Date().toISOString() });
    expect(getInterruptedCycle()).toBeUndefined();
  });

  it('a lock pointing at a terminal (or missing) cycle is detected as stale', () => {
    const cycle = createCycle();
    acquireCycleLock(cycle.id);
    updateCycle(cycle.id, { status: 'FAILED', completedAt: new Date().toISOString() });
    expect(isLockStale()).toBe(true);
  });

  it('a lock pointing at a still-executing cycle is NOT stale', () => {
    const cycle = createCycle();
    acquireCycleLock(cycle.id);
    updateCycle(cycle.id, { status: 'EXECUTING' });
    expect(isLockStale()).toBe(false);
  });
});

describe('scheduler', () => {
  it('starts STOPPED by default', () => {
    expect(getSchedulerState().status).toBe('STOPPED');
  });

  it('start -> pause -> resume -> stop transitions persist and are readable after a simulated restart', () => {
    startAutonomy(30);
    closeDb();
    expect(getSchedulerState().status).toBe('RUNNING');
    expect(getSchedulerState().cadenceMinutes).toBe(30);

    pauseAutonomy();
    expect(getSchedulerState().status).toBe('PAUSED');

    resumeAutonomy();
    expect(getSchedulerState().status).toBe('RUNNING');

    stopAutonomy();
    expect(getSchedulerState().status).toBe('STOPPED');
  });

  it('setCadenceMinutes changes cadence without changing status', () => {
    startAutonomy(60);
    setCadenceMinutes(15);
    const state = getSchedulerState();
    expect(state.status).toBe('RUNNING');
    expect(state.cadenceMinutes).toBe(15);
  });

  const noopInvoker: ClaudeInvoker = { invoke: () => Promise.reject(new Error('should never be called — tick should short-circuit before invoking Claude')) };

  it('a tick when STOPPED does nothing and never calls Claude', async () => {
    const outcome = await runSchedulerTick({ invoker: noopInvoker });
    expect(outcome.result).toBe('disabled');
  });

  it('a tick when PAUSED does nothing', async () => {
    startAutonomy(60);
    pauseAutonomy();
    const outcome = await runSchedulerTick({ invoker: noopInvoker });
    expect(outcome.result).toBe('disabled');
  });

  it('a tick refuses to launch when the cycle lock is already held (no-overlap guarantee)', async () => {
    startAutonomy(60);
    const cycle = createCycle();
    acquireCycleLock(cycle.id);
    const outcome = await runSchedulerTick({ invoker: noopInvoker });
    expect(outcome.result).toBe('cycle_already_running');
    releaseCycleLock();
  });

  it('a tick before the cadence has elapsed reports not_eligible without touching Claude again', async () => {
    startAutonomy(60);
    const rejectingInvoker: ClaudeInvoker = { invoke: () => Promise.reject(new Error('Lead call failed (expected in this test) — proves a cycle was actually attempted.')) };
    const first = await runSchedulerTick({ invoker: rejectingInvoker });
    // The cycle itself fails (empty backlog + a Claude call that always rejects), but the
    // tick's job is only to decide whether to launch — it did, so 'launched' is correct here.
    expect(first.result).toBe('launched');
    expect(first.cycleOutcome?.cycle?.status).toBe('FAILED');

    // Cadence was just advanced by the first tick — an immediate second tick must not fire again.
    const second = await runSchedulerTick({ invoker: noopInvoker });
    expect(second.result).toBe('not_eligible');
  });
});
