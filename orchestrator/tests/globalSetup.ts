import { rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SCRATCH_ROOT = path.join(os.tmpdir(), 'muslimrentals-orchestrator-tests');

export function setup(): void {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
  mkdirSync(SCRATCH_ROOT, { recursive: true });
}

export function teardown(): void {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
}
