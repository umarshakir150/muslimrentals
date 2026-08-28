import { fileURLToPath } from 'node:url';
import path from 'node:path';

// This file lives at orchestrator/src/paths.ts, so the repo root is two
// directories up (src -> orchestrator -> repo root).
const here = path.dirname(fileURLToPath(import.meta.url));

export const ORCHESTRATOR_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(here, '..', '..');
export const AGENTS_DIR = path.join(REPO_ROOT, 'agents');
export const COMPANY_DIR = path.join(REPO_ROOT, 'company');
export const AI_DIR = path.join(REPO_ROOT, 'ai');
export const CLAUDE_MD = path.join(REPO_ROOT, 'CLAUDE.md');

// Overridable so tests (and anything else that shouldn't touch the real
// project state) can point these at a scratch directory. Read at call time,
// not module-load time, so a test can set the env var right before running.
export function getAiTasksDir(): string {
  return process.env.ORCHESTRATOR_TASKS_DIR ?? path.join(REPO_ROOT, 'ai', 'tasks');
}

export function getWorktreesRoot(): string {
  return process.env.ORCHESTRATOR_WORKTREES_DIR ?? path.join(ORCHESTRATOR_ROOT, '.worktrees');
}

/** SQLite file backing the autonomy layer (backlog/signals/memory/cycles/
 * approvals/events) — see ai/autonomy-architecture.md "Persistence model".
 * Gitignored, same treatment as .worktrees/: durable across process
 * restarts, not committed. Overridable so tests never touch real state. */
export function getAutonomyDbPath(): string {
  return process.env.ORCHESTRATOR_AUTONOMY_DB ?? path.join(ORCHESTRATOR_ROOT, '.autonomy', 'state.db');
}
