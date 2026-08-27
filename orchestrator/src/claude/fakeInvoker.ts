/**
 * A scripted, deterministic `ClaudeInvoker` for orchestration unit tests.
 * Never spawns the real `claude` binary — orchestration logic (scheduling,
 * dependency ordering, retry loops, approval gates) is deterministic and
 * should be tested as such, without spending real API calls. See
 * orchestrator/README.md "Testing".
 */
import type { ClaudeInvoker, ClaudeInvokeOptions, ClaudeInvokeResult } from './claudeAdapter.js';

export interface ScriptedCall {
  options: ClaudeInvokeOptions;
  startedAt: number;
  finishedAt: number;
}

export type ResponseFn = (options: ClaudeInvokeOptions, callIndexForRole: number) => unknown;

export class ScriptedClaudeInvoker implements ClaudeInvoker {
  readonly calls: ScriptedCall[] = [];
  private readonly callCountByRole = new Map<string, number>();

  constructor(
    /** role -> response payload, or a function of (options, nth call for that role) -> payload */
    private readonly responses: Record<string, unknown | ResponseFn>,
    /** Simulated latency in ms, so concurrency can be asserted on wall-clock overlap. */
    private readonly delayMs: (role: string) => number = () => 5
  ) {}

  async invoke(options: ClaudeInvokeOptions): Promise<ClaudeInvokeResult> {
    const startedAt = Date.now();
    const nth = this.callCountByRole.get(options.role) ?? 0;
    this.callCountByRole.set(options.role, nth + 1);

    const delay = this.delayMs(options.role);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    const entry = this.responses[options.role];
    if (entry === undefined) {
      throw new Error(`ScriptedClaudeInvoker: no scripted response for role "${options.role}"`);
    }
    const payload = typeof entry === 'function' ? (entry as ResponseFn)(options, nth) : entry;

    const finishedAt = Date.now();
    this.calls.push({ options, startedAt, finishedAt });

    return {
      raw: JSON.stringify(payload),
      json: payload,
      costUsd: 0,
      durationMs: finishedAt - startedAt,
    };
  }

  callsFor(role: string): ScriptedCall[] {
    return this.calls.filter((c) => c.options.role === role);
  }

  /** True if any two calls (by role) overlapped in wall-clock time — proves real concurrency. */
  static anyOverlap(a: ScriptedCall[], b: ScriptedCall[]): boolean {
    return a.some((x) => b.some((y) => x.startedAt < y.finishedAt && y.startedAt < x.finishedAt));
  }
}
