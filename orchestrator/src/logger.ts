/**
 * Structured logging with redaction. Every phase transition, agent launch,
 * review verdict, retry, and approval gate goes through here — both to the
 * console (for a human watching the run) and to the task's own
 * ai/tasks/<id>/log.jsonl (the durable audit trail).
 *
 * Redaction runs on every event before it's written anywhere. This is a
 * best-effort pattern-based scrubber, not a guarantee — never log a real
 * secret/token/credential deliberately and rely on this to catch it.
 */
import { appendTaskLog } from './task/taskStore.js';

const SENSITIVE_KEY = /(secret|password|passwd|token|api[_-]?key|access[_-]?key|credential|refreshtoken|cookie)/i;

// Shapes that look like a real credential even outside a suspiciously-named
// key: AWS access key IDs, long hex/base64 blobs, JWTs, bearer headers.
const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT-shaped
  /\b[A-Fa-f0-9]{40,}\b/g, // long hex secrets
];

function redactString(value: string): string {
  let out = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

export function redact(value: unknown, keyHint?: string): unknown {
  if (keyHint && SENSITIVE_KEY.test(keyHint)) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v, k);
    }
    return out;
  }
  return value;
}

export interface OrchestratorEvent {
  taskId: string;
  event: string;
  [key: string]: unknown;
}

export function logEvent(evt: OrchestratorEvent): void {
  const { taskId, event, ...rest } = evt;
  const safeRest = redact(rest) as Record<string, unknown>;
  const line = { ts: new Date().toISOString(), taskId, event, ...safeRest };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
  appendTaskLog(taskId, { event, ...safeRest });
}
