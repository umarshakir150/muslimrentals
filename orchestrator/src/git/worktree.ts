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

export async function createWorktree(taskId: string, role: string): Promise<WorktreeHandle> {
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

  await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], {
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
