/**
 * Structured, timestamped, append-only event log — PART 18. Never logs
 * secrets/tokens/passwords/unnecessary personal data (same redaction
 * discipline as src/logger.ts, reused here rather than reinvented).
 */
import { getDb } from './db.js';
import { newId, nowIso } from './ids.js';
import { redact } from '../logger.js';
import { EventRecord, type EventType } from './types.js';

interface Row {
  id: string;
  ts: string;
  type: string;
  cycle_id: string | null;
  data: string;
}

function rowToEvent(row: Row): EventRecord {
  return EventRecord.parse(JSON.parse(row.data));
}

export interface LogEventInput {
  type: EventType;
  message: string;
  cycleId?: string;
  taskId?: string;
  backlogItemId?: string;
  data?: Record<string, unknown>;
}

export function logAutonomyEvent(input: LogEventInput): EventRecord {
  const event: EventRecord = EventRecord.parse({
    id: newId('evt'),
    ts: nowIso(),
    type: input.type,
    cycleId: input.cycleId,
    taskId: input.taskId,
    backlogItemId: input.backlogItemId,
    message: input.message,
    data: (redact(input.data ?? {}) as Record<string, unknown>) ?? {},
  });
  const db = getDb();
  db.prepare('INSERT INTO events (id, ts, type, cycle_id, data) VALUES (?, ?, ?, ?, ?)').run(event.id, event.ts, event.type, event.cycleId ?? null, JSON.stringify(event));
  return event;
}

export interface ListEventsFilter {
  cycleId?: string;
  type?: EventType;
  limit?: number;
}

export function listAutonomyEvents(filter: ListEventsFilter = {}): EventRecord[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.cycleId) {
    clauses.push('cycle_id = ?');
    params.push(filter.cycleId);
  }
  if (filter.type) {
    clauses.push('type = ?');
    params.push(filter.type);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter.limit ? `LIMIT ${Math.max(0, Math.floor(filter.limit))}` : '';
  const rows = db.prepare(`SELECT * FROM events ${where} ORDER BY ts DESC ${limit}`).all(...params) as unknown as Row[];
  return rows.map(rowToEvent);
}
