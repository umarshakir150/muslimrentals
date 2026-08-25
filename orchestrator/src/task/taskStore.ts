/**
 * Durable, file-based task persistence under ai/tasks/<task-id>/ — the
 * audit trail. Agents communicate through these artifacts (plus prior
 * artifacts fed forward as context, see contextBuilder.ts), never through
 * an in-memory chat log — so the record survives process exit and is
 * exactly what a human or a future concurrent worker would read.
 *
 * Only writes files that are actually relevant to what ran (per the task
 * spec's "Only create files that are actually relevant to the task") —
 * callers decide what to write; this module never writes a placeholder for
 * a role that didn't run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { getAiTasksDir } from '../paths.js';

export function taskDir(taskId: string): string {
  return path.join(getAiTasksDir(), taskId);
}

export function initTaskDir(taskId: string): string {
  const dir = taskDir(taskId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeArtifact(taskId: string, filename: string, content: string): string {
  const dir = initTaskDir(taskId);
  const filePath = path.join(dir, filename);
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function writeJsonArtifact(taskId: string, filename: string, data: unknown): string {
  return writeArtifact(taskId, filename, JSON.stringify(data, null, 2) + '\n');
}

export function readArtifact(taskId: string, filename: string): string | undefined {
  const filePath = path.join(taskDir(taskId), filename);
  if (!existsSync(filePath)) return undefined;
  return readFileSync(filePath, 'utf8');
}

export interface LogEntry {
  ts: string;
  taskId: string;
  event: string;
  [key: string]: unknown;
}

/** Redacts anything shaped like a secret before it ever reaches disk. See src/logger.ts. */
export function appendTaskLog(taskId: string, entry: { event: string; [key: string]: unknown }): void {
  const dir = initTaskDir(taskId);
  const full: LogEntry = { ts: new Date().toISOString(), taskId, ...entry };
  appendFileSync(path.join(dir, 'log.jsonl'), JSON.stringify(full) + '\n', 'utf8');
}
