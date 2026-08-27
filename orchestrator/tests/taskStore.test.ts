import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { taskDir, writeArtifact, writeJsonArtifact, readArtifact, appendTaskLog } from '../src/task/taskStore.js';

describe('taskStore', () => {
  it('writes and reads markdown artifacts under ai/tasks/<task-id>/', () => {
    const taskId = 'test-taskstore-md';
    writeArtifact(taskId, 'request.md', '# hello');
    expect(readArtifact(taskId, 'request.md')).toBe('# hello');
    expect(existsSync(path.join(taskDir(taskId), 'request.md'))).toBe(true);
  });

  it('writes JSON artifacts as pretty-printed, parseable JSON', () => {
    const taskId = 'test-taskstore-json';
    writeJsonArtifact(taskId, 'plan.json', { a: 1, b: [1, 2, 3] });
    const raw = readArtifact(taskId, 'plan.json')!;
    expect(JSON.parse(raw)).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it('returns undefined for an artifact that was never written', () => {
    expect(readArtifact('test-taskstore-missing', 'nope.md')).toBeUndefined();
  });

  it('appends structured, newline-delimited log entries', () => {
    const taskId = 'test-taskstore-log';
    appendTaskLog(taskId, { event: 'state_transition', state: 'PLANNING' });
    appendTaskLog(taskId, { event: 'state_transition', state: 'SPECIALIST_REVIEW' });
    const raw = readFileSync(path.join(taskDir(taskId), 'log.jsonl'), 'utf8');
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].event).toBe('state_transition');
    expect(lines[0].taskId).toBe(taskId);
    expect(typeof lines[0].ts).toBe('string');
  });

  it('redacts nothing itself — appendTaskLog is a raw writer; redaction is logger.ts responsibility', () => {
    // Documented behavior check: taskStore does not redact, so callers must
    // route through src/logger.ts's logEvent() rather than calling
    // appendTaskLog directly with unredacted data.
    const taskId = 'test-taskstore-no-redact';
    appendTaskLog(taskId, { event: 'x', note: 'plain text is stored as-is here' });
    const raw = readFileSync(path.join(taskDir(taskId), 'log.jsonl'), 'utf8');
    expect(raw).toContain('plain text is stored as-is here');
  });
});
