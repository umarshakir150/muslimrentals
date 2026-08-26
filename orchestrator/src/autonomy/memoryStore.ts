/**
 * Cross-cycle organizational memory — structured facts/decisions/lessons,
 * not raw transcripts (PART 3: "Do not store unlimited raw Claude
 * transcripts as memory"). Four scopes: shared product memory, per-agent
 * memory, decisions, and known issues — all the same underlying record
 * shape (MemoryRecord), distinguished by `scope`/`agent`/`type`.
 *
 * Retrieval is deliberately simple and deterministic (PART 3: "Keep it
 * simple and deterministic initially"): filter by scope/agent/productArea,
 * then rank by confidence and recency, then cap at a small limit. No
 * embeddings, no vector search — a handful of curated facts beats a large
 * pile of half-relevant ones for what this system actually needs right now.
 */
import { getDb } from './db.js';
import { newId, nowIso } from './ids.js';
import { MemoryRecord, type MemoryScope } from './types.js';
import type { AgentRole } from '../types/schemas.js';

interface Row {
  id: string;
  scope: string;
  agent: string | null;
  status: string;
  updated_at: string;
  data: string;
}

function rowToRecord(row: Row): MemoryRecord {
  return MemoryRecord.parse(JSON.parse(row.data));
}

function persist(record: MemoryRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO memory_records (id, scope, agent, status, updated_at, data)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, data=excluded.data`
  ).run(record.id, record.scope, record.agent ?? null, record.status, record.updatedAt, JSON.stringify(record));
}

export interface RecordMemoryInput {
  scope: MemoryScope;
  agent?: AgentRole;
  type: string;
  content: string;
  source: string;
  confidence?: number;
  productArea?: string;
  /** id of an existing MemoryRecord this one replaces — marks that one SUPERSEDED. */
  supersedes?: string;
}

export function recordMemory(input: RecordMemoryInput): MemoryRecord {
  const now = nowIso();
  const record: MemoryRecord = MemoryRecord.parse({
    id: newId('mem'),
    scope: input.scope,
    agent: input.agent,
    type: input.type,
    content: input.content,
    source: input.source,
    createdAt: now,
    updatedAt: now,
    confidence: input.confidence ?? 0.8,
    supersedes: input.supersedes,
    status: 'ACTIVE',
    productArea: input.productArea,
  });
  persist(record);

  if (input.supersedes) {
    const prior = getMemory(input.supersedes);
    if (prior) persist({ ...prior, status: 'SUPERSEDED', updatedAt: now });
  }
  return record;
}

export function getMemory(id: string): MemoryRecord | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM memory_records WHERE id = ?').get(id) as Row | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function archiveMemory(id: string): MemoryRecord | undefined {
  const existing = getMemory(id);
  if (!existing) return undefined;
  const updated: MemoryRecord = { ...existing, status: 'ARCHIVED', updatedAt: nowIso() };
  persist(updated);
  return updated;
}

export interface RelevantMemoryQuery {
  scopes?: MemoryScope[];
  agent?: AgentRole;
  productArea?: string;
  limit?: number;
}

/** The retrieval a Lead/specialist context should actually use — never the
 * full table. Filters to ACTIVE records in the requested scope(s), then
 * ranks by confidence desc, recency desc, and caps at `limit` (default 15).
 * Product-scoped and decision-scoped memory is always eligible regardless
 * of `agent`/`productArea` (they're cross-cutting by definition); agent
 * memory is only included when it matches the requested role;
 * product-area filtering (when given) narrows further rather than
 * excluding un-tagged records outright, since not every record is tagged. */
export function getRelevantMemory(query: RelevantMemoryQuery = {}): MemoryRecord[] {
  const db = getDb();
  const scopes = query.scopes ?? ['product', 'agent', 'decision', 'known_issue'];
  const placeholders = scopes.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM memory_records WHERE status = 'ACTIVE' AND scope IN (${placeholders})`).all(...scopes) as unknown as Row[];
  let records = rows.map(rowToRecord);

  records = records.filter((r) => {
    if (r.scope !== 'agent') return true;
    return query.agent ? r.agent === query.agent : true;
  });
  if (query.productArea) {
    records = records.filter((r) => !r.productArea || r.productArea === query.productArea);
  }

  records.sort((a, b) => b.confidence - a.confidence || (a.updatedAt < b.updatedAt ? 1 : -1));
  return records.slice(0, query.limit ?? 15);
}

export interface ListMemoryFilter {
  scope?: MemoryScope;
  status?: MemoryRecord['status'];
  limit?: number;
}

export function listMemory(filter: ListMemoryFilter = {}): MemoryRecord[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.scope) {
    clauses.push('scope = ?');
    params.push(filter.scope);
  }
  if (filter.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter.limit ? `LIMIT ${Math.max(0, Math.floor(filter.limit))}` : '';
  const rows = db.prepare(`SELECT * FROM memory_records ${where} ORDER BY updated_at DESC ${limit}`).all(...params) as unknown as Row[];
  return rows.map(rowToRecord);
}
