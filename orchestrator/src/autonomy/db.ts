/**
 * SQLite connection + schema for the autonomy layer. See
 * ai/autonomy-architecture.md "Persistence model" for why node:sqlite
 * (built into Node 22, zero new dependencies) was chosen over
 * better-sqlite3 or a markdown-file "database".
 *
 * One connection per process, opened lazily and reused (getDb()) — every
 * store module (backlogStore.ts, signalStore.ts, ...) shares it rather
 * than each owning its own connection, so a single process never has two
 * SQLite handles racing on the same file. Tests point ORCHESTRATOR_AUTONOMY_DB
 * at a scratch path (see vitest.config.ts) and call closeDb() between runs
 * that need a fresh connection (e.g. simulating a process restart) so no
 * test ever touches real autonomy state.
 *
 * Simple columns hold whatever the store needs to filter/sort/join by
 * (status, category, priority, fingerprint, ...); everything else is a
 * single JSON blob column, validated against its Zod schema by the store
 * on the way in and out. This is deliberately not a hand-rolled ORM — one
 * schema file, thin store modules, Zod as the only source of truth for
 * shape.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
// Type-only import — erased by tsc at compile time, so it never reaches
// Vite/Vitest's module resolver (only the runtime `require()` below does).
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { getAutonomyDbPath } from '../paths.js';

// node:sqlite is a real Node 22 built-in, but it's still experimental and
// isn't in Vite's hardcoded builtin-module list — a static `import ... from
// 'node:sqlite'` gets caught by Vitest's bundler-level import analysis and
// mis-resolved as an npm package named "sqlite" (see vitest.config.ts's
// comment for the externalization attempt that didn't fully fix it).
// Loading it through createRequire() instead is a plain function call, not
// an import Vite rewrites, so it reaches Node's own module loader
// untouched — which resolves "node:sqlite" as a builtin exactly the same
// way `import` would, just without going through Vite at all.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

let db: DatabaseSync | undefined;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS backlog_items (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  category TEXT NOT NULL,
  risk TEXT NOT NULL,
  priority REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backlog_status ON backlog_items(status);
CREATE INDEX IF NOT EXISTS idx_backlog_priority ON backlog_items(priority DESC);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_fingerprint ON signals(fingerprint);

CREATE TABLE IF NOT EXISTS memory_records (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  agent TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory_records(scope, status);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory_records(agent, status);

CREATE TABLE IF NOT EXISTS autonomous_cycles (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cycles_started ON autonomous_cycles(started_at DESC);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_requests(status);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  cycle_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_cycle ON events(cycle_id);

CREATE TABLE IF NOT EXISTS standing_objective (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Single-row mutex: exactly one cycle may run at a time (Part 9 / Part 20
-- "cycle lock prevents overlapping cycles"). locked_by/locked_at let a
-- restart tell an actually-abandoned lock apart from a live one.
CREATE TABLE IF NOT EXISTS cycle_lock (
  id TEXT PRIMARY KEY CHECK (id = 'lock'),
  locked INTEGER NOT NULL,
  cycle_id TEXT,
  locked_at TEXT
);

-- status: 'STOPPED' | 'RUNNING' | 'PAUSED' (see scheduler.ts). Distinct from
-- the cycle_lock above — this says whether the scheduler LOOP is allowed to
-- launch a cycle at all; cycle_lock says whether one happens to be running
-- right now.
CREATE TABLE IF NOT EXISTS scheduler_state (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  status TEXT NOT NULL,
  cadence_minutes INTEGER NOT NULL,
  next_eligible_at TEXT,
  updated_at TEXT NOT NULL
);
`;

export function getDb(): DatabaseSync {
  if (db) return db;
  const dbPath = getAutonomyDbPath();
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Closes the shared connection so a new getDb() call re-opens (and
 * re-migrates) it — tests use this between runs when they change
 * ORCHESTRATOR_AUTONOMY_DB, and it's also what a clean process exit should
 * call. Never called mid-cycle in production use. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}
