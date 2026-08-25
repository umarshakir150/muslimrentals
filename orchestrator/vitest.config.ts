import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

const scratch = path.join(os.tmpdir(), 'muslimrentals-orchestrator-tests');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Real implementer/integration worktrees (created under .worktrees/ —
    // see src/paths.ts getWorktreesRoot()) are full checkouts of this repo,
    // including their own nested copy of orchestrator/tests/*.test.ts as of
    // whatever commit they branched from. Without this exclude, Vitest's
    // glob happily discovers and runs those nested, possibly-stale test
    // files too — and since a worktree shares the same underlying git repo
    // (refs/objects) as this checkout, two test runs creating worktrees with
    // the same generated branch names race and fail with "branch already
    // exists." Test worktrees already live outside the repo entirely (see
    // ORCHESTRATOR_WORKTREES_DIR below), so this only ever excludes real
    // task worktrees left on disk from actual --full runs.
    exclude: ['**/node_modules/**', '**/dist/**', '.worktrees/**'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Orchestration tests must never write into the real ai/tasks/ or create
    // real worktrees/branches in this repo — point both at a scratch dir
    // instead. See src/paths.ts getAiTasksDir()/getWorktreesRoot().
    env: {
      ORCHESTRATOR_TASKS_DIR: path.join(scratch, 'ai-tasks'),
      ORCHESTRATOR_WORKTREES_DIR: path.join(scratch, 'worktrees'),
    },
    globalSetup: ['tests/globalSetup.ts'],
  },
});
