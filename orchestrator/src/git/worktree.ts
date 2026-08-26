/**
 * Git worktree isolation for implementer roles (engineering/frontend/backend).
 *
 * Why worktrees rather than just branches: two concurrent implementer
 * workers sharing one checkout would race on the same files on disk (one
 * agent's in-progress edit could be read/overwritten by another mid-write).
 * `git worktree add` gives each implementer role its own working directory
 * AND its own branch, backed by the same repo's object store — concurrent
 * Frontend/Backend workers literally cannot corrupt each other's changes
 * because they're never touching the same files on disk.
 *
 * Review roles (QA/Security/Designer/Legal/Trust & Safety) never get a
 * worktree — they inspect via Read/Grep/Glob against whichever worktree
 * path the orchestrator hands them (read-only), and never write into it.
 * This is what "reviewers should not silently rewrite what they review"
 * means in practice: they are architecturally incapable of writing there
 * (see src/agents/registry.ts — no Write/Edit in their tool list).
 *
 * The orchestrator does NOT auto-remove or auto-merge worktrees after a
 * task finishes — that's a deliberate choice (see orchestrator/README.md).
 * Branches and worktree paths are recorded in the task's final report for
 * the founder/Engineering Lead to review and merge manually.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, getWorktreesRoot } from '../paths.js';

const execFileAsync = promisify(execFile);

export interface WorktreeHandle {
  branch: string;
  path: string;
}

function sanitize(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Reconstructs a WorktreeHandle for a worktree that should already exist on
 * disk from an earlier createWorktree()/createIntegrationWorktree() call in
 * THIS SAME task run — pure path/branch-name math by convention, no git
 * command, no filesystem check. Use when resuming a partially-finished task
 * whose worktrees were never removed (e.g. resumeIntegratedReview()) —
 * different from addWorktreeForExistingBranch()/createIntegrationWorktree(),
 * which create something new. Throws if the path isn't actually there,
 * since silently proceeding against a missing worktree would be worse than
 * failing loudly.
 */
export function existingWorktreeHandle(taskId: string, role: string): WorktreeHandle {
  const safeTaskId = sanitize(taskId);
  const safeRole = sanitize(role);
  const worktreePath = path.join(getWorktreesRoot(), `${safeTaskId}-${safeRole}`);
  const branch = role === 'integration' ? `agents/${safeTaskId}/integration` : `agents/${safeTaskId}/${safeRole}`;
  if (!existsSync(worktreePath)) {
    throw new Error(`existingWorktreeHandle: expected worktree at ${worktreePath} (role "${role}", task "${taskId}") but it doesn't exist.`);
  }
  return { branch, path: worktreePath };
}

/** Resolves the current HEAD to an explicit SHA — call this ONCE per task and
 * pass the result to every createWorktree()/createIntegrationWorktree() call
 * for that task, so every worker (and the integration worktree) is
 * guaranteed to share an identical base commit even if something else
 * advances the branch mid-task. */
export async function resolveHead(): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT });
  return stdout.trim();
}

export async function createWorktree(taskId: string, role: string, baseRef: string = 'HEAD'): Promise<WorktreeHandle> {
  const worktreesRoot = getWorktreesRoot();
  if (!existsSync(worktreesRoot)) mkdirSync(worktreesRoot, { recursive: true });

  const safeTaskId = sanitize(taskId);
  const safeRole = sanitize(role);
  const branch = `agents/${safeTaskId}/${safeRole}`;
  const worktreePath = path.join(worktreesRoot, `${safeTaskId}-${safeRole}`);

  if (existsSync(worktreePath)) {
    throw new Error(
      `Worktree path already exists: ${worktreePath}. Remove it (or the stale branch "${branch}") before re-running this task.`
    );
  }

  await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath, baseRef], {
    cwd: REPO_ROOT,
  });

  return { branch, path: worktreePath };
}

/**
 * Checks out an EXISTING branch into a new worktree — the counterpart to
 * createWorktree() for resuming work already done on a branch from a prior
 * run, rather than starting an implementer fresh. No `-b`: this must never
 * silently create a new branch when the caller's whole point is to attach
 * to one that already has real history.
 */
export async function addWorktreeForExistingBranch(taskId: string, role: string, branch: string): Promise<WorktreeHandle> {
  const worktreesRoot = getWorktreesRoot();
  if (!existsSync(worktreesRoot)) mkdirSync(worktreesRoot, { recursive: true });

  const safeTaskId = sanitize(taskId);
  const safeRole = sanitize(role);
  const worktreePath = path.join(worktreesRoot, `${safeTaskId}-${safeRole}`);

  if (existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}. Remove it before re-running this task.`);
  }

  await execFileAsync('git', ['worktree', 'add', worktreePath, branch], { cwd: REPO_ROOT });

  return { branch, path: worktreePath };
}

/** Common ancestor of two or more existing branches/refs — the correct base
 * commit to diff/merge against when resuming integration on branches that
 * were never all created from a single shared HEAD in the first place. */
export async function mergeBaseOf(refs: string[]): Promise<string> {
  if (refs.length < 2) throw new Error('mergeBaseOf() needs at least two refs.');
  const { stdout } = await execFileAsync('git', ['merge-base', ...refs], { cwd: REPO_ROOT });
  return stdout.trim();
}

/** One dedicated worktree for reconciling multiple implementer branches. Same
 * mechanics as createWorktree, distinct branch-naming convention so it's
 * never confused with a per-role implementer worktree. */
export async function createIntegrationWorktree(taskId: string, baseCommit: string): Promise<WorktreeHandle> {
  const worktreesRoot = getWorktreesRoot();
  if (!existsSync(worktreesRoot)) mkdirSync(worktreesRoot, { recursive: true });

  const safeTaskId = sanitize(taskId);
  const branch = `agents/${safeTaskId}/integration`;
  const worktreePath = path.join(worktreesRoot, `${safeTaskId}-integration`);

  if (existsSync(worktreePath)) {
    throw new Error(`Integration worktree path already exists: ${worktreePath}.`);
  }

  await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath, baseCommit], {
    cwd: REPO_ROOT,
  });

  return { branch, path: worktreePath };
}

export async function removeWorktree(handle: WorktreeHandle, opts: { deleteBranch?: boolean } = {}): Promise<void> {
  await execFileAsync('git', ['worktree', 'remove', handle.path, '--force'], { cwd: REPO_ROOT });
  if (opts.deleteBranch) {
    await execFileAsync('git', ['branch', '-D', handle.branch], { cwd: REPO_ROOT });
  }
}

/** Files changed on `branch` relative to the commit it was created from. */
export async function changedFiles(handle: WorktreeHandle): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: handle.path });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[AMDR?U ]+\s+/, ''));
}

/**
 * Commits whatever is currently staged/unstaged in the worktree, if
 * anything. The orchestrator calls this itself right after an implementer
 * finishes — never relies on the model remembering to `git commit` — so
 * every worker branch is guaranteed to have real, diffable, mergeable
 * history by the time cross-branch analysis / integration needs it.
 */
export async function commitAll(handle: WorktreeHandle, message: string): Promise<{ committed: boolean; sha?: string }> {
  await execFileAsync('git', ['add', '-A'], { cwd: handle.path });
  const { stdout: staged } = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd: handle.path });
  if (!staged.trim()) return { committed: false };

  await execFileAsync('git', ['commit', '-m', message], { cwd: handle.path });
  const { stdout: sha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: handle.path });
  return { committed: true, sha: sha.trim() };
}

export interface NameStatusDiff {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
}

/**
 * Categorized diff of `handle`'s current state (working tree + any commits)
 * against `baseRef` — the ground-truth input to cross-branch overlap
 * detection. Deliberately a single-ref diff (working tree vs. baseRef, not
 * baseRef..HEAD) so it still reflects reality even if something isn't
 * committed yet, though in normal operation commitAll() means it always is.
 */
export async function diffNameStatus(handle: WorktreeHandle, baseRef: string): Promise<NameStatusDiff> {
  const { stdout } = await execFileAsync('git', ['diff', '--no-color', '--name-status', baseRef], { cwd: handle.path });
  const result: NameStatusDiff = { added: [], modified: [], deleted: [], renamed: [] };
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0] as string;
    if (status.startsWith('R') && parts.length >= 3) {
      result.renamed.push({ from: parts[1] as string, to: parts[2] as string });
    } else if (status.startsWith('A') && parts[1]) {
      result.added.push(parts[1]);
    } else if (status.startsWith('D') && parts[1]) {
      result.deleted.push(parts[1]);
    } else if (parts[1]) {
      // M (modified), and anything else (T, C copy, etc.) treated as modified.
      result.modified.push(parts[1]);
    }
  }
  return result;
}

export interface MergeAttempt {
  clean: boolean;
  conflictedFiles: string[];
}

/**
 * Merges `branchName` into whatever is currently checked out in
 * `handle` (the integration worktree), without committing. Caller decides
 * whether to commit (clean merge) or hand off to the Integrator agent
 * (conflict) — this function only reports what happened.
 */
export async function mergeBranch(handle: WorktreeHandle, branchName: string): Promise<MergeAttempt> {
  try {
    await execFileAsync('git', ['merge', '--no-ff', '--no-commit', branchName], { cwd: handle.path });
    return { clean: true, conflictedFiles: [] };
  } catch {
    const conflictedFiles = await unresolvedConflicts(handle);
    return { clean: false, conflictedFiles };
  }
}

/** Finalizes a clean `mergeBranch()` result (its changes are already staged by git). */
export async function commitMerge(handle: WorktreeHandle, message: string): Promise<string> {
  await execFileAsync('git', ['commit', '-m', message], { cwd: handle.path });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: handle.path });
  return stdout.trim();
}

/** Paths still marked unmerged (conflict markers) in `handle` right now — the
 * ground-truth check after an Integrator agent claims to have resolved
 * everything. Never trust "I fixed it" without verifying. */
export async function unresolvedConflicts(handle: WorktreeHandle): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: handle.path }).catch(() => ({
    stdout: '',
  }));
  return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}
