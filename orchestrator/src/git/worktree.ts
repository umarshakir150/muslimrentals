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

// A real `npm install`-then-commit inside a task worktree (observed for
// real: PART 23's autonomous-cycle demonstration verifying the Roommate
// Profiles branch) can make `git diff --cached --name-only` or `git status
// --porcelain` emit far more than Node's execFile default 1MB stdout
// buffer, throwing ERR_CHILD_PROCESS_STDIO_MAXBUFFER and crashing the
// whole task. Same fix, same reasoning, as claudeAdapter.ts's
// runClaudeProcess() already applies to Claude's own stdout for the
// identical class of problem — one shared generous buffer for every git
// call here rather than reasoning about it per call site.
const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd, maxBuffer: GIT_MAX_BUFFER_BYTES });
}

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
  const { stdout } = await git(['rev-parse', 'HEAD'], REPO_ROOT);
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

  await git(['worktree', 'add', '-b', branch, worktreePath, baseRef], REPO_ROOT);

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

  await git(['worktree', 'add', worktreePath, branch], REPO_ROOT);

  return { branch, path: worktreePath };
}

/** Common ancestor of two or more existing branches/refs — the correct base
 * commit to diff/merge against when resuming integration on branches that
 * were never all created from a single shared HEAD in the first place. */
export async function mergeBaseOf(refs: string[]): Promise<string> {
  if (refs.length < 2) throw new Error('mergeBaseOf() needs at least two refs.');
  const { stdout } = await git(['merge-base', ...refs], REPO_ROOT);
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

  await git(['worktree', 'add', '-b', branch, worktreePath, baseCommit], REPO_ROOT);

  return { branch, path: worktreePath };
}

export async function removeWorktree(handle: WorktreeHandle, opts: { deleteBranch?: boolean } = {}): Promise<void> {
  await git(['worktree', 'remove', handle.path, '--force'], REPO_ROOT);
  if (opts.deleteBranch) {
    await git(['branch', '-D', handle.branch], REPO_ROOT);
  }
}

/** Files changed on `branch` relative to the commit it was created from. */
export async function changedFiles(handle: WorktreeHandle): Promise<string[]> {
  const { stdout } = await git(['status', '--porcelain'], handle.path);
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
  await git(['add', '-A'], handle.path);
  const { stdout: staged } = await git(['diff', '--cached', '--name-only'], handle.path);
  if (!staged.trim()) return { committed: false };

  await git(['commit', '-m', message], handle.path);
  const { stdout: sha } = await git(['rev-parse', 'HEAD'], handle.path);
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
  const { stdout } = await git(['diff', '--no-color', '--name-status', baseRef], handle.path);
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
    await git(['merge', '--no-ff', '--no-commit', branchName], handle.path);
    return { clean: true, conflictedFiles: [] };
  } catch {
    const conflictedFiles = await unresolvedConflicts(handle);
    return { clean: false, conflictedFiles };
  }
}

/**
 * Finalizes a clean `mergeBranch()` result. Usually its changes are already
 * staged by git and this just commits them — but a branch with zero new
 * commits (a legitimate implementer `noChangesNeeded` outcome) merges as a
 * genuine no-op ("Already up to date.", nothing staged), and `git commit`
 * would fail with nothing to commit. Found for real during an autonomous
 * cycle where both implementers correctly made no changes: skip the commit
 * in that case (mirrors commitAll()'s same staged-diff check) rather than
 * crashing the task over having nothing to merge.
 */
export async function commitMerge(handle: WorktreeHandle, message: string): Promise<string> {
  const { stdout: staged } = await git(['diff', '--cached', '--name-only'], handle.path);
  if (staged.trim()) {
    await git(['commit', '-m', message], handle.path);
  }
  const { stdout } = await git(['rev-parse', 'HEAD'], handle.path);
  return stdout.trim();
}

export interface ProductionMergeResult {
  merged: boolean;
  pushed: boolean;
  productionSha?: string;
  conflictedFiles?: string[];
  reason?: string;
}

/**
 * Merges `sourceBranch` (a reviewed, COMPLETE task's branch) into the real
 * production branch (`main` — see ai/operating-directive.md "Production
 * deploy policy") and pushes it, non-force, so the live Netlify deploy
 * actually picks it up. Never touches the caller's own checkout — always
 * works in a dedicated, disposable, detached worktree freshly checked out
 * from `origin/<productionBranch>` (fetched first), so it's never stale
 * and never interferes with whatever branch the orchestrator/founder has
 * checked out in REPO_ROOT.
 *
 * A real merge conflict is reported, never resolved automatically — this
 * is production, not an isolated integration worktree, so an unsupervised
 * agent resolving a production conflict is a materially different risk
 * than the Integrator reconciling two feature branches; it needs a human.
 * A push that isn't a fast-forward (someone else moved the production
 * branch in the meantime) is likewise just reported — `git push` without
 * `--force` refuses it on its own, which is the actual guarantee here,
 * not just a convention this function follows.
 */
export async function mergeToProductionBranch(sourceBranch: string, productionBranch: string): Promise<ProductionMergeResult> {
  const worktreesRoot = getWorktreesRoot();
  if (!existsSync(worktreesRoot)) mkdirSync(worktreesRoot, { recursive: true });
  const worktreePath = path.join(worktreesRoot, `__production_merge_${sanitize(productionBranch)}__`);

  if (existsSync(worktreePath)) {
    await git(['worktree', 'remove', worktreePath, '--force'], REPO_ROOT).catch(() => undefined);
  }

  try {
    await git(['fetch', 'origin', productionBranch], REPO_ROOT);
  } catch (err) {
    return { merged: false, pushed: false, reason: `Could not fetch origin/${productionBranch}: ${err instanceof Error ? err.message : String(err)}` };
  }

  await git(['worktree', 'add', '--detach', worktreePath, `origin/${productionBranch}`], REPO_ROOT);

  try {
    try {
      await git(['merge', '--no-ff', sourceBranch], worktreePath);
    } catch {
      const conflictedFiles = await unresolvedConflicts({ branch: productionBranch, path: worktreePath });
      await git(['merge', '--abort'], worktreePath).catch(() => undefined);
      return { merged: false, pushed: false, conflictedFiles, reason: 'Real merge conflict against production — not auto-resolved, needs founder/human attention.' };
    }

    try {
      await git(['push', 'origin', `HEAD:${productionBranch}`], worktreePath);
    } catch (err) {
      return { merged: true, pushed: false, reason: `Push to origin/${productionBranch} was rejected (not a fast-forward, or another failure) — never force-pushed: ${err instanceof Error ? err.message : String(err)}` };
    }

    const { stdout } = await git(['rev-parse', 'HEAD'], worktreePath);
    return { merged: true, pushed: true, productionSha: stdout.trim() };
  } finally {
    await git(['worktree', 'remove', worktreePath, '--force'], REPO_ROOT).catch(() => undefined);
  }
}

export interface PushResult {
  pushed: boolean;
  branch: string;
  reason?: string;
}

/**
 * Pushes `handle`'s branch to `origin`, creating/updating a remote branch of
 * the same name (never main/master — every branch this system creates is
 * under the `agents/<taskId>/...` namespace, see createWorktree() and
 * createIntegrationWorktree()). Never force-pushed: a genuine rejection
 * (e.g. someone else pushed to the same branch name) is reported back
 * rather than overwritten, per ai/operating-directive.md's push-authority
 * constraints ("no overwriting unrelated branches, no silently discarding
 * conflicts"). This never touches main/master/any shared default branch —
 * callers only ever pass a task-scoped worktree handle.
 */
export async function pushBranch(handle: WorktreeHandle): Promise<PushResult> {
  try {
    await git(['push', '-u', 'origin', `${handle.branch}:${handle.branch}`], handle.path);
    return { pushed: true, branch: handle.branch };
  } catch (err) {
    return { pushed: false, branch: handle.branch, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Paths still marked unmerged (conflict markers) in `handle` right now — the
 * ground-truth check after an Integrator agent claims to have resolved
 * everything. Never trust "I fixed it" without verifying. */
export async function unresolvedConflicts(handle: WorktreeHandle): Promise<string[]> {
  const { stdout } = await git(['diff', '--name-only', '--diff-filter=U'], handle.path).catch(() => ({
    stdout: '',
  }));
  return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}
