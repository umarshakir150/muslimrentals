/**
 * Signal sources. Each one inspects LOCAL/DEVELOPMENT state only and
 * returns candidate evidence — never a decision to act. See
 * ai/autonomy-architecture.md "Deliberately deferred" for why external
 * sources (GitHub, Vercel, Sentry, analytics, ...) aren't implemented yet:
 * no adapter is wired up for a service that isn't configured in this
 * environment. Adding one later means implementing this same
 * `SignalSource` interface — see "Adding a signal source" in
 * orchestrator/README.md.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, getAiTasksDir } from '../paths.js';
import type { RecordSignalInput } from './signalStore.js';
import type { BacklogCategory } from './types.js';

const execFileAsync = promisify(execFile);

export interface SignalSource {
  name: string;
  collect(): Promise<RecordSignalInput[]>;
}

// ─── Repo scan: TODO/FIXME/placeholder comments ────────────────────────────
const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)$/;
const PLACEHOLDER_PATTERN = /\b(not\s+implemented|notimplemented|placeholder|stub(?:bed)?)\b/i;
const SCAN_ROOTS = ['rentals/backend/src', 'rentals/frontend/src'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.next', '.git']);

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
}

/** TODO/FIXME/placeholder comments — cheap, deterministic, zero API cost.
 * Reported at low severity/confidence on purpose: a TODO is evidence
 * something might matter, not proof it does (see agents/lead.md — "do not
 * treat every TODO as automatically important"). The Lead decides which
 * ones are worth a backlog item. */
export const repoScanSource: SignalSource = {
  name: 'repo_scan',
  async collect(): Promise<RecordSignalInput[]> {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root), files);

    const signals: RecordSignalInput[] = [];
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file);
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        const todoMatch = line.match(TODO_PATTERN);
        const placeholderMatch = PLACEHOLDER_PATTERN.test(line);
        if (!todoMatch && !placeholderMatch) return;
        const location = `${rel}:${idx + 1}`;
        const evidence = line.trim().slice(0, 300);
        signals.push({
          source: 'repo_scan',
          type: todoMatch ? `${(todoMatch[1] ?? 'TODO').toLowerCase()}_comment` : 'placeholder_code',
          category: 'TECH_DEBT',
          severity: 1,
          confidence: 0.5,
          evidence,
          location,
        });
      });
    }
    return signals;
  },
};

// ─── Build/typecheck signals ────────────────────────────────────────────────
interface PackageCheck {
  label: string;
  dir: string;
  command: string;
  args: string[];
}

const PACKAGE_CHECKS: PackageCheck[] = [
  { label: 'backend', dir: 'rentals/backend', command: 'npx', args: ['tsc', '--noEmit'] },
  { label: 'frontend', dir: 'rentals/frontend', command: 'npx', args: ['tsc', '--noEmit'] },
];

/** Parses `file(line,col): error TSxxxx: message` — both rentals/backend
 * and rentals/frontend's tsc invocations produce this format. */
function parseTscErrors(output: string): Array<{ location: string; message: string }> {
  const results: Array<{ location: string; message: string }> = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error.*)$/);
    if (m) results.push({ location: `${m[1]}:${m[2]}`, message: (m[4] ?? '').trim() });
  }
  return results;
}

/** Typecheck failures in whatever's already installed — does NOT run `npm
 * install` itself (that's a slow, occasionally-failing network operation;
 * forcing it on every signal-gathering pass would make every cycle slow
 * and network-dependent). If a package has no node_modules yet, this
 * reports that fact as a single low-severity TESTING signal instead of
 * silently skipping it — "no verification possible" is itself a real,
 * previously-identified gap (ai/current-state.md "Testing status"). */
export const buildTypecheckSource: SignalSource = {
  name: 'build_typecheck',
  async collect(): Promise<RecordSignalInput[]> {
    const signals: RecordSignalInput[] = [];
    for (const check of PACKAGE_CHECKS) {
      const dir = path.join(REPO_ROOT, check.dir);
      if (!existsSync(path.join(dir, 'node_modules'))) {
        signals.push({
          source: 'build_typecheck',
          type: 'verification_unavailable',
          category: 'TESTING',
          severity: 1,
          confidence: 1,
          evidence: `${check.dir} has no node_modules installed — typecheck signal skipped this cycle (run \`npm install\` in ${check.dir} to enable it).`,
          location: check.dir,
        });
        continue;
      }
      try {
        await execFileAsync(check.command, check.args, { cwd: dir, maxBuffer: 10 * 1024 * 1024 });
        // Clean typecheck — nothing to report for this package.
      } catch (err) {
        const output = err && typeof err === 'object' && 'stdout' in err ? String((err as { stdout?: unknown }).stdout ?? '') : String(err);
        const errors = parseTscErrors(output);
        for (const e of errors.slice(0, 50)) {
          signals.push({
            source: 'build_typecheck',
            type: 'type_error',
            category: 'TECH_DEBT',
            severity: 2,
            confidence: 0.95,
            evidence: e.message,
            location: e.location,
            metadata: { package: check.label },
          });
        }
        if (errors.length === 0) {
          // tsc failed but output didn't parse as the expected format —
          // still worth surfacing rather than silently dropping.
          signals.push({
            source: 'build_typecheck',
            type: 'type_error',
            category: 'TECH_DEBT',
            severity: 2,
            confidence: 0.6,
            evidence: output.slice(0, 500) || `tsc exited non-zero in ${check.dir} with no parseable output.`,
            location: check.dir,
            metadata: { package: check.label },
          });
        }
      }
    }
    return signals;
  },
};

// ─── Project-state signals: unresolved findings from past real tasks ──────
interface ReviewFinding {
  severity?: string;
  finding?: string;
  recommendedAction?: string;
}

function categoryForFindingText(text: string): BacklogCategory {
  const t = text.toLowerCase();
  if (/(idor|auth|inject|xss|csrf|vulnerab)/.test(t)) return 'SECURITY';
  if (/(privacy|pii|personal data|expos)/.test(t)) return 'PRIVACY';
  if (/(harass|abuse|report|moderat)/.test(t)) return 'TRUST_SAFETY';
  if (/(test|coverage|verif)/.test(t)) return 'TESTING';
  if (/(a11y|accessib|aria|screen reader)/.test(t)) return 'ACCESSIBILITY';
  return 'TECH_DEBT';
}

/** Reads every ai/tasks/<id>/qa.json + security.json this repo has ever
 * produced and surfaces their non-blocking (info/low/medium) findings as
 * signals — exactly PART 14's "QA: Roommate authorization has no
 * integration tests" example. A finding severe enough to have actually
 * blocked (CHANGES_REQUIRED) is already resolved by definition (the task
 * only reaches COMPLETE once every blocking finding is fixed), so this
 * only looks at the *non-blocking* residue reviewers chose to note anyway. */
export const projectStateSource: SignalSource = {
  name: 'project_state',
  async collect(): Promise<RecordSignalInput[]> {
    const tasksDir = getAiTasksDir();
    if (!existsSync(tasksDir)) return [];
    const signals: RecordSignalInput[] = [];

    for (const taskId of readdirSync(tasksDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
      for (const [file, role] of [['qa.json', 'qa'], ['security.json', 'security']] as const) {
        const full = path.join(tasksDir, taskId, file);
        if (!existsSync(full)) continue;
        let parsed: { findings?: ReviewFinding[] };
        try {
          parsed = JSON.parse(readFileSync(full, 'utf8'));
        } catch {
          continue;
        }
        for (const f of parsed.findings ?? []) {
          const severity = (f.severity ?? 'info').toLowerCase();
          if (severity === 'critical' || severity === 'high') continue; // would have blocked; already resolved by definition
          const text = f.finding ?? '';
          if (!text) continue;
          signals.push({
            source: 'project_state',
            type: `unresolved_${role}_finding`,
            category: categoryForFindingText(text + ' ' + (f.recommendedAction ?? '')),
            severity: severity === 'medium' ? 2 : 1,
            confidence: 0.7,
            evidence: f.recommendedAction ? `${text} — ${f.recommendedAction}` : text,
            location: `ai/tasks/${taskId}/${file}`,
            metadata: { taskId, role },
          });
        }
      }
    }
    return signals;
  },
};

/** All local signal sources, safe to run every cycle by default. */
export const DEFAULT_SIGNAL_SOURCES: SignalSource[] = [repoScanSource, buildTypecheckSource, projectStateSource];
