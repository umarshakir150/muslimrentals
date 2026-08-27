import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { redact, logEvent } from '../src/logger.js';
import { taskDir } from '../src/task/taskStore.js';

describe('logger redaction', () => {
  it('redacts values under suspiciously-named keys regardless of content', () => {
    const out = redact({ password: 'hunter2', apiKey: 'abc', note: 'fine' }) as Record<string, unknown>;
    expect(out.password).toBe('[REDACTED]');
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.note).toBe('fine');
  });

  it('redacts AWS-shaped access key IDs found in ordinary strings', () => {
    const out = redact({ note: 'key is AKIAABCDEFGHIJKLMNOP end' }) as Record<string, unknown>;
    expect(out.note).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(out.note).toContain('[REDACTED]');
  });

  it('redacts JWT-shaped strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const out = redact({ note: `token=${jwt}` }) as Record<string, unknown>;
    expect(out.note).not.toContain(jwt);
  });

  it('recurses into nested objects and arrays', () => {
    const out = redact({ a: { b: [{ secret: 'x' }, { note: 'y' }] } }) as any;
    expect(out.a.b[0].secret).toBe('[REDACTED]');
    expect(out.a.b[1].note).toBe('y');
  });

  it('logEvent writes a redacted line to the task log file', () => {
    const taskId = 'test-logger-event';
    logEvent({ taskId, event: 'agent_launch', role: 'engineering', password: 'should-not-appear' });
    const raw = readFileSync(path.join(taskDir(taskId), 'log.jsonl'), 'utf8');
    expect(raw).not.toContain('should-not-appear');
    expect(raw).toContain('[REDACTED]');
    const parsed = JSON.parse(raw.trim().split('\n')[0] as string);
    expect(parsed.event).toBe('agent_launch');
    expect(parsed.role).toBe('engineering');
  });
});
