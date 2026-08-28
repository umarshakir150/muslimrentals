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
 *
 * Process ownership: every worker this module spawns is run as the leader
 * of its own detached process group (`detached: true`), specifically so a
 * timeout or explicit cancellation can terminate not just the worker but
 * anything IT spawned (`process.kill(-pid, signal)` — see
 * src/process/liveness.ts) — a real gap until this was added: a cycle
 * timeout previously abandoned the in-flight Promise without touching the
 * underlying child process at all, which could leave a live worker (and
 * ongoing model spend) running well after the cycle that started it had
 * already been marked stopped. See CliClaudeInvoker.killAll() and
 * ClaudeInvokeOptions.timeoutMs below.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { terminateProcessGroup, readProcStartTicks } from '../process/liveness.js';

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
  /** Per-call worker timeout override. Falls back to the invoker's own
   * `defaultTimeoutMs` (constructor option) when omitted; no timeout is
   * enforced if neither is set (existing behavior for every call site that
   * doesn't opt in — this is purely additive). */
  timeoutMs?: number;
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
  /** Optional: terminate every worker process this invoker instance
   * currently has in flight. Implemented by CliClaudeInvoker (real OS
   * processes to reap); intentionally absent from ScriptedClaudeInvoker
   * (nothing real to kill) — callers must check for its existence
   * (`invoker.killAll?.(...)`) rather than assume every ClaudeInvoker
   * supports it, so adding this never breaks a fake/test implementation. */
  killAll?(reason: string): Promise<void>;
}

/** Thrown when a worker process is terminated for exceeding its configured
 * timeout — deliberately a distinct, identifiable error type (rather than
 * a plain Error with a matching message) so callers can tell "this failed
 * because it timed out and was killed" apart from any other failure mode
 * without string-matching, and can decide not to retry it (see
 * CliClaudeInvoker.invoke()'s retry loop below — retrying a call that just
 * proved it can hang is not obviously useful, and doubles the wait). */
export class WorkerTimeoutError extends Error {
  constructor(
    public readonly role: string,
    public readonly pid: number,
    public readonly timeoutMs: number,
    public readonly termination: string
  ) {
    super(`Worker for role "${role}" (pid ${pid}) exceeded its ${timeoutMs}ms timeout and was terminated (${termination}).`);
    this.name = 'WorkerTimeoutError';
  }
}

/** Optional hooks so a caller can durably record which OS processes this
 * invoker has spawned — needed only for surviving a *process* crash (the
 * in-memory `activeChildren` registry below is enough for same-process
 * cancellation, e.g. killAll() on a cycle timeout, but a crash of the
 * orchestrator itself loses in-memory state entirely). CliClaudeInvoker
 * calls these best-effort; a hook throwing never fails the underlying
 * Claude call. See src/autonomy/workerRegistry.ts for the real
 * SQLite-backed implementation the autonomy layer wires in for cycle/
 * scheduler-loop runs — deliberately not wired in by default (e.g. for the
 * ad-hoc single-task CLI), since cross-restart worker recovery only
 * matters for unattended/autonomous operation. */
export interface ProcessRegistryHooks {
  onSpawn(info: { pid: number; role: string; startTicks: string | undefined }): void;
  onExit(pid: number): void;
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

  // Positional prompt is a short, FIXED-size pointer, never the actual task
  // content — the real userPrompt is piped over stdin instead (see
  // runProcess()). This is what caused a real `spawn E2BIG` failure on the
  // Integrator role: it uniquely aggregates every implementer's full report
  // plus the deterministic overlap/scope analysis into one userPrompt, and
  // nothing in this codebase bounds how large that gets, while the OS caps
  // total argv/environ size well under what a large multi-implementer task
  // can produce. `claude -p` combining a positional prompt with piped stdin
  // content is a standard, documented CLI usage pattern (it's also why the
  // CLI briefly waits on stdin before proceeding — see the historical "3s
  // wait" note in runProcess()'s docstring), so this keeps argv permanently
  // tiny regardless of task size instead of just patching today's specific
  // oversized case.
  args.push(STDIN_PROMPT_POINTER);

  return args;
}

/** The only positional prompt content that ever reaches argv — everything
 * task-specific goes over stdin instead (see buildClaudeArgs()/runProcess()
 * comments above). Kept as an exported constant, not inlined, so a test can
 * assert against it without duplicating the literal string. */
export const STDIN_PROMPT_POINTER = 'Read your full task prompt from stdin (already provided) and follow it.';

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

const DEFAULT_GRACEFUL_TERMINATION_MS = 5000;

export interface CliClaudeInvokerOptions {
  /** Applied to every invoke() call that doesn't set its own
   * ClaudeInvokeOptions.timeoutMs. Undefined (the default) means no
   * worker-level timeout is enforced — existing ad-hoc/test usage of
   * `new CliClaudeInvoker()` is completely unaffected. */
  defaultTimeoutMs?: number;
  /** See ProcessRegistryHooks. */
  registry?: ProcessRegistryHooks;
  /** How long to wait after SIGTERM before escalating to SIGKILL. */
  gracefulTerminationMs?: number;
}

export class CliClaudeInvoker implements ClaudeInvoker {
  /** Every worker currently in flight FOR THIS INVOKER INSTANCE — explicit,
   * narrow ownership: killAll() only ever touches a PID this exact
   * instance spawned and is still tracking, never any other Claude
   * process, and never any unrelated developer process. Removed as soon
   * as the process exits (successfully, on error, or via termination), so
   * this is also always an accurate live picture, never a stale list. */
  private readonly activeChildren = new Map<number, ChildProcess>();
  private readonly defaultTimeoutMs?: number;
  private readonly registry?: ProcessRegistryHooks;
  private readonly gracefulTerminationMs: number;

  constructor(
    private readonly binary: string = 'claude',
    opts: CliClaudeInvokerOptions = {}
  ) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs;
    this.registry = opts.registry;
    this.gracefulTerminationMs = opts.gracefulTerminationMs ?? DEFAULT_GRACEFUL_TERMINATION_MS;
  }

  /**
   * Runs the CLI via `spawn` (not `execFile`) and feeds the prompt to the
   * child over stdin rather than as a positional CLI argument — see
   * buildClaudeArgs()'s comment for why (a real `spawn E2BIG` on the
   * Integrator role: an oversized aggregated userPrompt hit the OS's argv
   * size limit). Writing to a pipe has no equivalent size ceiling.
   *
   * Earlier versions of this code closed stdin immediately (`stdio:
   * ['ignore', ...]`) to dodge a ~3s wait the CLI does for stdin data that
   * never arrives when nothing is piped in. Now that real content is always
   * written and the stream is ended right after, that wait never triggers
   * (EOF arrives essentially immediately) — verified against the installed
   * CLI (2.1.243).
   *
   * `detached: true` makes this child the leader of its own new process
   * group (see module docstring) — required for terminateProcessGroup() to
   * be able to reach anything this worker itself spawns, not just the
   * worker's own PID.
   */
  private runProcess(
    args: string[],
    stdinContent: string,
    cwd: string,
    role: string,
    maxBufferBytes: number,
    timeoutMs: number | undefined
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env, detached: true });
      const pid = child.pid;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let settled = false;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const startTicks = pid !== undefined ? readProcStartTicks(pid) : undefined;
      if (pid !== undefined) {
        this.activeChildren.set(pid, child);
        this.registry?.onSpawn({ pid, role, startTicks });
      }

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (pid !== undefined) {
          this.activeChildren.delete(pid);
          this.registry?.onExit(pid);
        }
      };

      if (timeoutMs !== undefined && pid !== undefined) {
        timer = setTimeout(() => {
          timedOut = true;
          // Requirement: "stop accepting new work for that run" at the
          // worker level — once we've decided to time this out, a late
          // stdout/close event must never be allowed to resolve
          // successfully (see the `close` handler below, which checks
          // `timedOut` before resolving).
          void terminateProcessGroup(pid, { gracefulMs: this.gracefulTerminationMs }).then((outcome) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new WorkerTimeoutError(role, pid, timeoutMs, outcome));
          });
        }, timeoutMs);
      }

      // If the child exits (or was never able to start) before it's read all
      // of stdin, writing/ending the stream can raise EPIPE/ECONNRESET here.
      // That's informational, not the real failure — the real failure is
      // always surfaced separately via the child's own 'error' or 'close'
      // handler below, so this must never reject/crash on its own (an
      // unhandled 'error' on a stream is otherwise an uncaught exception).
      child.stdin?.on('error', () => {});
      child.stdin?.end(stdinContent, 'utf8');

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes <= maxBufferBytes) stdoutChunks.push(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      child.on('error', (err) => {
        if (settled || timedOut) return; // already handled by the timeout path
        settled = true;
        cleanup();
        reject(err);
      });
      child.on('close', (code, signal) => {
        if (settled || timedOut) return; // a timeout already won; ignore any late settlement
        settled = true;
        cleanup();
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        if (code === 0) resolve({ stdout, stderr });
        else {
          // A bare nonzero exit with empty stderr has been observed for real
          // (see orchestrator/README.md Troubleshooting) with nothing to go
          // on afterward. Always include enough to diagnose it without
          // re-running: exit code/signal, how much stdout arrived before the
          // process died, and the argv size (rules out — or confirms — a
          // still-oversized argv despite the prompt no longer living there).
          const argvBytes = args.reduce((sum, a) => sum + Buffer.byteLength(a, 'utf8'), 0);
          reject(
            new Error(
              `claude exited with code ${code}${signal ? ` (signal ${signal})` : ''}. ` +
                `stderr: ${stderr || '(none)'}. stdout bytes received: ${stdoutBytes}. argv bytes: ${argvBytes}.`
            )
          );
        }
      });
    });
  }

  async invoke(options: ClaudeInvokeOptions): Promise<ClaudeInvokeResult> {
    const args = buildClaudeArgs(options);
    const start = Date.now();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    // One bounded retry for a raw process-level failure (nonzero exit,
    // transient network/rate-limit hiccup) — NOT for a schema-validation
    // failure, which is a model-output problem the caller already handles
    // via a fallback object, not something retrying fixes. Observed for
    // real on the first --full run: a QA call failed with a bare nonzero
    // exit and no stderr mid-run, which crashed the entire orchestrator
    // process instead of being absorbed. One retry with a short backoff is
    // cheap insurance against exactly that; if it fails twice, it's
    // probably not transient and should still surface as a real error.
    //
    // A WorkerTimeoutError is NOT retried: the call already proved it can
    // hang for the full timeout window, so an immediate retry would just
    // risk hanging for the full window again with no reason to expect a
    // different outcome — this is also what keeps a timeout from ever
    // turning into an unbounded retry loop (see cycle.ts/README "Bounds").
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 5000));
      try {
        // Context bundles + tool output can be sizable; default buffers are too small.
        const result = await this.runProcess(args, options.userPrompt, options.cwd, options.role, 64 * 1024 * 1024, timeoutMs);
        const durationMs = Date.now() - start;
        const { json, costUsd } = extractStructuredPayload(result.stdout);
        return { raw: result.stdout, json, costUsd, durationMs };
      } catch (err) {
        if (err instanceof WorkerTimeoutError) throw err;
        lastErr = err;
      }
    }
    throw new Error(
      `claude CLI invocation failed for role "${options.role}" after retry: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
    );
  }

  /**
   * Terminates every worker THIS INSTANCE currently has in flight — the
   * mechanism cycle.ts calls (unconditionally, in a `finally`) whenever a
   * cycle ends for any reason, so no worker process a cycle started can
   * ever outlive the cycle itself, whether it ended in success, an
   * ordinary failure, or a timeout. Bounded and safe to call when nothing
   * is running (resolves immediately). Never touches a PID this instance
   * didn't itself record spawning.
   */
  // `reason` isn't used internally — it exists so a call site reads
  // naturally (`killAll('cycle timeout exceeded')`) and so a caller that
  // wants to log the termination has a ready-made string to attach to its
  // own event, without this module needing to know about cycle.ts's
  // logging conventions.
  async killAll(_reason: string): Promise<void> {
    const pids = [...this.activeChildren.keys()];
    await Promise.all(pids.map((pid) => terminateProcessGroup(pid, { gracefulMs: this.gracefulTerminationMs }).then(() => undefined)));
  }
}
