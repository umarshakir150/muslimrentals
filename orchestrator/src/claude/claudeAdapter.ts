/**
 * The single module responsible for invoking Claude. Nothing else in the
 * orchestrator talks to the `claude` binary directly — everything else
 * depends on the `ClaudeInvoker` interface, so the CLI's exact flags can
 * change (or this could be swapped for the Claude Agent SDK later) without
 * touching the Supervisor/state-machine logic. See orchestrator/README.md
 * "Claude execution" for why this repo's `claude` CLI headless mode
 * (`-p`/`--print`) was chosen over adding an SDK dependency.
 *
 * Permission model implemented here (see also src/agents/registry.ts):
 *   --tools                 the hard boundary — a tool not listed here does
 *                            not exist for this worker, full stop.
 *   --allowedTools/-disallowedTools
 *                            fine-grained Bash command scoping *within* a
 *                            granted tool (QA/Security/Engineering only).
 *   --permission-mode dontAsk
 *                            headless workers have no TTY to prompt against,
 *                            so we can't use an interactive mode. "dontAsk"
 *                            is used (rather than "bypassPermissions") so the
 *                            allow/disallow lists above still apply instead
 *                            of being skipped outright — see README
 *                            Troubleshooting for how to verify this empirically
 *                            against the installed CLI version before trusting
 *                            it unattended.
 *   --strict-mcp-config      workers get zero MCP servers (no --mcp-config
 *                            passed), so they can't reach anything the outer
 *                            session happens to have configured.
 *   --setting-sources user   skip project-level .claude/settings.json hooks
 *                            for nested worker sessions (e.g. this repo's own
 *                            stop hook), while still loading user-level auth.
 *   --no-session-persistence worker sessions are throwaway; don't clutter
 *                            `claude --resume` history with dozens of them.
 */
import { spawn } from 'node:child_process';

export interface ClaudeInvokeOptions {
  role: string;
  /** Reference material appended to Claude Code's default system prompt. */
  systemPromptAddition: string;
  /** The task-specific instruction — objective, prerequisites, output format. */
  userPrompt: string;
  /** Working directory for the child process (repo root, or a worktree). */
  cwd: string;
  /** JSON Schema the structured output must conform to. */
  jsonSchema: Record<string, unknown>;
  /** Hard tool allowlist. */
  tools: string[];
  allowedToolPatterns: string[];
  disallowedToolPatterns: string[];
  maxBudgetUsd: number;
  model?: string;
}

export interface ClaudeInvokeResult {
  /** Raw stdout from the CLI (the full --output-format json envelope). */
  raw: string;
  /** The structured payload extracted from that envelope, still unvalidated. */
  json: unknown;
  costUsd?: number;
  durationMs: number;
}

export interface ClaudeInvoker {
  invoke(options: ClaudeInvokeOptions): Promise<ClaudeInvokeResult>;
}

/** Pure function so argv construction is unit-testable without spawning a process. */
export function buildClaudeArgs(options: ClaudeInvokeOptions): string[] {
  const args: string[] = ['-p', '--output-format', 'json'];

  args.push('--append-system-prompt', options.systemPromptAddition);
  args.push('--json-schema', JSON.stringify(options.jsonSchema));

  if (options.tools.length > 0) {
    args.push('--tools', ...options.tools);
  } else {
    // Explicitly grant nothing rather than falling back to CLI defaults.
    args.push('--tools', '');
  }
  if (options.allowedToolPatterns.length > 0) {
    args.push('--allowedTools', ...options.allowedToolPatterns);
  }
  if (options.disallowedToolPatterns.length > 0) {
    args.push('--disallowedTools', ...options.disallowedToolPatterns);
  }

  args.push('--permission-mode', 'dontAsk');
  args.push('--strict-mcp-config');
  args.push('--setting-sources', 'user');
  args.push('--no-session-persistence');
  args.push('--max-budget-usd', String(options.maxBudgetUsd));

  if (options.model) args.push('--model', options.model);

  // Positional prompt goes last.
  args.push(options.userPrompt);

  return args;
}

/**
 * Extracts the structured payload from `claude -p --output-format json`'s
 * stdout. Verified empirically against the installed CLI (2.1.243) — when
 * `--json-schema` is passed, the envelope includes a dedicated
 * `structured_output` field holding the already-parsed object (preferred:
 * no double-JSON-parsing, and it's the field the structured-output feature
 * itself populates), plus a `result` field holding the same content
 * serialized as a string (kept as a fallback). If a future CLI version
 * changes this envelope, this is the one place that needs updating — see
 * orchestrator/README.md "Troubleshooting".
 */
export function extractStructuredPayload(stdout: string): { json: unknown; costUsd?: number } {
  const outer: unknown = JSON.parse(stdout);
  if (typeof outer !== 'object' || outer === null) {
    throw new Error('claude -p --output-format json did not return a JSON object.');
  }
  const obj = outer as Record<string, unknown>;
  const costUsd =
    typeof obj.total_cost_usd === 'number'
      ? obj.total_cost_usd
      : typeof obj.cost_usd === 'number'
        ? obj.cost_usd
        : undefined;

  // Preferred: the dedicated structured_output field (already an object).
  if (obj.structured_output && typeof obj.structured_output === 'object') {
    return { json: obj.structured_output, costUsd };
  }

  // Fallback A: `result` is a JSON string.
  if (typeof obj.result === 'string') {
    try {
      return { json: JSON.parse(obj.result), costUsd };
    } catch {
      // fall through to other strategies
    }
  }

  // Fallback B: `result` is itself already an object.
  if (obj.result && typeof obj.result === 'object') {
    return { json: obj.result, costUsd };
  }

  // Fallback C: the envelope has no `result`/`structured_output` wrapper at
  // all — assume it already *is* the structured payload.
  if ('result' in obj === false) {
    return { json: obj, costUsd };
  }

  throw new Error(
    `Could not locate a structured JSON payload in claude's output. Raw stdout: ${stdout.slice(0, 2000)}`
  );
}

/**
 * Runs the CLI via `spawn` (not `execFile`) specifically so stdin can be
 * closed immediately (`stdio: ['ignore', ...]`). Without this, the CLI
 * waits ~3s per invocation for stdin data that will never arrive (we pass
 * the prompt as a positional argument, not via stdin) — across a handful
 * of concurrent/sequential worker calls that adds up fast. Verified against
 * the installed CLI (2.1.243): closing stdin up front removes the wait
 * entirely with no change in behavior.
 */
function runClaudeProcess(
  binary: string,
  args: string[],
  cwd: string,
  maxBufferBytes: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxBufferBytes) stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`claude exited with code ${code}. stderr: ${stderr || '(none)'}`));
    });
  });
}

export class CliClaudeInvoker implements ClaudeInvoker {
  constructor(private readonly binary: string = 'claude') {}

  async invoke(options: ClaudeInvokeOptions): Promise<ClaudeInvokeResult> {
    const args = buildClaudeArgs(options);
    const start = Date.now();
    let stdout: string;
    try {
      // Context bundles + tool output can be sizable; default buffers are too small.
      const result = await runClaudeProcess(this.binary, args, options.cwd, 64 * 1024 * 1024);
      stdout = result.stdout;
    } catch (err) {
      throw new Error(`claude CLI invocation failed for role "${options.role}": ${err instanceof Error ? err.message : String(err)}`);
    }
    const durationMs = Date.now() - start;
    const { json, costUsd } = extractStructuredPayload(stdout);
    return { raw: stdout, json, costUsd, durationMs };
  }
}
