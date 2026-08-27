#!/usr/bin/env node
// Test fixture standing in for a real `claude` binary that itself spawns a
// subprocess (e.g. a tool call shelling out) — no real Claude call
// involved. Spawns a plain (non-detached) grandchild, which by default
// POSIX process-group inheritance stays in THIS process's group (the one
// CliClaudeInvoker tracks, since it spawned this fixture with
// `detached: true`), then writes the grandchild's pid to the file path
// given via stdin (CliClaudeInvoker pipes `userPrompt` over stdin, not
// argv — this test (ab)uses that channel to pass the pidfile path) so the
// test can verify the grandchild died too, not just this top-level
// process. Both this process and its grandchild ignore SIGTERM, so only a
// real process-GROUP SIGKILL (not a parent-exit cascade) can account for
// the grandchild dying alongside its parent.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pidFile = readFileSync(0, 'utf8').trim();
const ignoreSigtermScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hangIgnoreSigterm.mjs');

const child = spawn(process.execPath, [ignoreSigtermScript], { stdio: 'ignore' });
if (child.pid !== undefined) writeFileSync(pidFile, String(child.pid));

process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
