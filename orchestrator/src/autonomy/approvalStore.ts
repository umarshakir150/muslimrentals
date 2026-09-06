/**
 * Approval request persistence — PART 11. A HIGH-risk backlog item, a
 * retry-limit exhaustion, or a recovery-required state all become a
 * persisted ApprovalRequest instead of either blocking silently or
 * proceeding unsafely. The rest of the system (other backlog items, other
 * cycles) is never frozen by one pending approval — see cycle.ts, which
 * moves on to the next eligible item rather than stopping the whole cycle.
 */
import { getDb } from './db.js';
import { newId, nowIso } from './ids.js';
import { ApprovalRequest, type ApprovalStatus, type EscalationType } from './types.js';

interface Row {
  id: string;
  status: string;
  created_at: string;
  data: string;
}

function rowToRequest(row: Row): ApprovalRequest {
  return ApprovalRequest.parse(JSON.parse(row.data));
}

function persist(request: ApprovalRequest): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO approval_requests (id, status, created_at, data) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data`
  ).run(request.id, request.status, request.createdAt, JSON.stringify(request));
}

export interface CreateApprovalInput {
  type: EscalationType;
  title: string;
  description: string;
  backlogItemId?: string;
  cycleId?: string;
  taskId?: string;
  options?: string[];
  recommendation?: string;
  tradeoffs?: string;
}

/** Returns the existing PENDING approval for this backlog item, if any.
 * Only PENDING matters here: once a request is APPROVED/REJECTED/SUPERSEDED
 * the founder has already decided something about that item, and a
 * genuinely new future ask for the same item must be free to create a fresh
 * PENDING row rather than being silently swallowed by an old, resolved one. */
function findPendingApprovalForBacklogItem(backlogItemId: string): ApprovalRequest | undefined {
  return listApprovalRequests('PENDING').find((r) => r.backlogItemId === backlogItemId);
}

/** Get-or-create: every call site (the Lead's escalations, the Lead's
 * HIGH-risk-selection block, cycle.ts's execution-time escalations) used to
 * call this as a bare "always insert," so the same backlog item could pick
 * up a fresh, differently-worded PENDING approval every cycle it was
 * reconsidered — observed for real (2026-09-06 dedup cleanup: 17 PENDING
 * rows covering only 4 distinct decisions). Guarding here, once, protects
 * every caller uniformly instead of requiring each call site to remember to
 * check first. Only guards when a `backlogItemId` is given — a freeform
 * escalation with none is rarer and always allowed through as before. */
export function createApprovalRequest(input: CreateApprovalInput): ApprovalRequest {
  if (input.backlogItemId) {
    const existing = findPendingApprovalForBacklogItem(input.backlogItemId);
    if (existing) return existing;
  }
  const request: ApprovalRequest = ApprovalRequest.parse({
    id: newId('appr'),
    ...input,
    createdAt: nowIso(),
    status: 'PENDING',
  });
  persist(request);
  return request;
}

export function getApprovalRequest(id: string): ApprovalRequest | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id) as Row | undefined;
  return row ? rowToRequest(row) : undefined;
}

export function listApprovalRequests(status?: ApprovalStatus): ApprovalRequest[] {
  const db = getDb();
  const rows = status
    ? (db.prepare('SELECT * FROM approval_requests WHERE status = ? ORDER BY created_at DESC').all(status) as unknown as Row[])
    : (db.prepare('SELECT * FROM approval_requests ORDER BY created_at DESC').all() as unknown as Row[]);
  return rows.map(rowToRequest);
}

export function decideApprovalRequest(id: string, status: 'APPROVED' | 'REJECTED' | 'SUPERSEDED', decisionNote?: string): ApprovalRequest {
  const existing = getApprovalRequest(id);
  if (!existing) throw new Error(`decideApprovalRequest: no approval request "${id}"`);
  if (existing.status !== 'PENDING') throw new Error(`decideApprovalRequest: "${id}" is already ${existing.status}, not PENDING.`);
  const updated: ApprovalRequest = { ...existing, status, decidedAt: nowIso(), decisionNote };
  persist(updated);
  return updated;
}
