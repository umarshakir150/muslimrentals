import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

const scratch = path.join(os.tmpdir(), 'muslimrentals-orchestrator-tests');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
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
