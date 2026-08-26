/**
 * Backlog persistence — the durable record of things Muslim Rentals could
 * or should improve, separate from `ai/tasks/` (which only records work
 * that's already been decided on and started). See
 * ai/autonomy-architecture.md "Persistence model".
 */
import { getDb } from './db.js';
import { definedOnly, newId, nowIso } from './ids.js';
import { computePriority } from './prioritization.js';
import { BacklogItem, type BacklogCategory, type BacklogStatus, type RiskLevel } from './types.js';

interface Row {
  id: string;
  status: string;
  category: string;
  risk: string;
  priority: number;
  created_at: string;
  updated_at: string;
  data: string;
}

function rowToItem(row: Row): BacklogItem {
  return BacklogItem.parse(JSON.parse(row.data));
}

function persist(item: BacklogItem): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO backlog_items (id, status, category, risk, priority, created_at, updated_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, category=excluded.category, risk=excluded.risk,
       priority=excluded.priority, updated_at=excluded.updated_at, data=excluded.data`
  ).run(item.id, item.status, item.category, item.risk, item.priority, item.createdAt, item.updatedAt, JSON.stringify(item));
}

export interface CreateBacklogItemInput {
  title: string;
  description: string;
  source: string;
  category: BacklogCategory;
  risk?: RiskLevel;
  userImpact: number;
  severity: number;
  confidence: number;
  effort: number;
  strategicRelevance: number;
  evidence?: string[];
  rationale: string;
  dependencies?: string[];
  relatedSignals?: string[];
  requiresFounderDecision?: boolean;
  requiresLegalReview?: boolean;
  status?: BacklogStatus;
}

export function createBacklogItem(input: CreateBacklogItemInput): BacklogItem {
  const { score, rationale: priorityRationale } = computePriority(input);
  const now = nowIso();
  const item: BacklogItem = BacklogItem.parse({
    id: newId('bl'),
    title: input.title,
    description: input.description,
    source: input.source,
    category: input.category,
    status: input.status ?? 'CANDIDATE',
    priority: score,
    priorityRationale,
    risk: input.risk ?? 'LOW',
    userImpact: input.userImpact,
    severity: input.severity,
    confidence: input.confidence,
    effort: input.effort,
    strategicRelevance: input.strategicRelevance,
    evidence: input.evidence ?? [],
    rationale: input.rationale,
    dependencies: input.dependencies ?? [],
    createdAt: now,
    updatedAt: now,
    lastEvaluatedAt: now,
    relatedTasks: [],
    relatedSignals: input.relatedSignals ?? [],
    requiresFounderDecision: input.requiresFounderDecision ?? false,
    requiresLegalReview: input.requiresLegalReview ?? false,
  });
  persist(item);
  return item;
}

export function getBacklogItem(id: string): BacklogItem | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM backlog_items WHERE id = ?').get(id) as Row | undefined;
  return row ? rowToItem(row) : undefined;
}

export interface ListBacklogFilter {
  status?: BacklogStatus | BacklogStatus[];
  category?: BacklogCategory;
  limit?: number;
}

/** Always priority-descending — the whole point of a scored backlog. */
export function listBacklogItems(filter: ListBacklogFilter = {}): BacklogItem[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  if (filter.category) {
    clauses.push('category = ?');
    params.push(filter.category);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter.limit ? `LIMIT ${Math.max(0, Math.floor(filter.limit))}` : '';
  const rows = db.prepare(`SELECT * FROM backlog_items ${where} ORDER BY priority DESC, created_at ASC ${limit}`).all(...params) as unknown as Row[];
  return rows.map(rowToItem);
}

export function listAllBacklogItems(): BacklogItem[] {
  return listBacklogItems();
}

/** Fields a caller may change; priority is always recomputed from the
 * scoring inputs rather than accepted directly, so "priority" can never
 * drift out of sync with its own stated rationale. */
export interface UpdateBacklogItemInput {
  status?: BacklogStatus;
  category?: BacklogCategory;
  risk?: RiskLevel;
  userImpact?: number;
  severity?: number;
  confidence?: number;
  effort?: number;
  strategicRelevance?: number;
  evidence?: string[];
  rationale?: string;
  dependencies?: string[];
  relatedTasks?: string[];
  relatedSignals?: string[];
  requiresFounderDecision?: boolean;
  requiresLegalReview?: boolean;
  resolution?: string;
  /** Free-text note on *why* this update happened — required so priority/
   * status changes are always explainable (PART 20's "explain priority
   * changes"), appended to priorityRationale rather than replacing it. */
  changeReason?: string;
}

export function updateBacklogItem(id: string, patch: UpdateBacklogItemInput): BacklogItem {
  const existing = getBacklogItem(id);
  if (!existing) throw new Error(`updateBacklogItem: no backlog item "${id}"`);

  const merged = { ...existing, ...definedOnly(patch) };
  const { score, rationale: priorityRationale } = computePriority(merged);
  const changedScoring =
    patch.userImpact !== undefined ||
    patch.severity !== undefined ||
    patch.confidence !== undefined ||
    patch.effort !== undefined ||
    patch.strategicRelevance !== undefined ||
    patch.category !== undefined;

  const now = nowIso();
  const updated: BacklogItem = BacklogItem.parse({
    ...merged,
    priority: score,
    priorityRationale: changedScoring && patch.changeReason ? `${priorityRationale} Reason for change: ${patch.changeReason}` : priorityRationale,
    updatedAt: now,
    lastEvaluatedAt: now,
  });
  persist(updated);
  return updated;
}

/** Marks `id` a duplicate of `mergeIntoId` — folds its evidence/signals
 * into the surviving item rather than silently discarding them. */
export function mergeDuplicate(id: string, mergeIntoId: string, reason: string): BacklogItem {
  const dup = getBacklogItem(id);
  const survivor = getBacklogItem(mergeIntoId);
  if (!dup) throw new Error(`mergeDuplicate: no backlog item "${id}"`);
  if (!survivor) throw new Error(`mergeDuplicate: no backlog item "${mergeIntoId}"`);

  updateBacklogItem(mergeIntoId, {
    evidence: Array.from(new Set([...survivor.evidence, ...dup.evidence])),
    relatedSignals: Array.from(new Set([...survivor.relatedSignals, ...dup.relatedSignals])),
    changeReason: `Absorbed duplicate ${id}: ${reason}`,
  });
  return updateBacklogItem(id, { status: 'DUPLICATE', resolution: `Duplicate of ${mergeIntoId}: ${reason}`, changeReason: reason });
}

export function linkBacklogItemToTask(id: string, taskId: string): BacklogItem {
  const item = getBacklogItem(id);
  if (!item) throw new Error(`linkBacklogItemToTask: no backlog item "${id}"`);
  return updateBacklogItem(id, { relatedTasks: Array.from(new Set([...item.relatedTasks, taskId])) });
}

/** Cheap token-overlap similarity (Jaccard over lowercase word sets) — good
 * enough to surface "you probably already have this" candidates to the
 * Lead as context, not a claim of semantic understanding. Only compares
 * against non-terminal items (a DONE/REJECTED/DUPLICATE item shouldn't
 * silently suppress a genuinely new candidate with a similar title). */
export function findSimilarBacklogItems(title: string, category: BacklogCategory, threshold = 0.5): BacklogItem[] {
  const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const target = words(title);
  if (target.size === 0) return [];

  const candidates = listBacklogItems({ category, status: ['CANDIDATE', 'TRIAGED', 'READY', 'SELECTED', 'IN_PROGRESS', 'BLOCKED', 'APPROVAL_REQUIRED'] });
  const scored = candidates
    .map((item) => {
      const itemWords = words(item.title);
      const intersection = [...target].filter((w) => itemWords.has(w)).length;
      const union = new Set([...target, ...itemWords]).size;
      return { item, similarity: union === 0 ? 0 : intersection / union };
    })
    .filter((s) => s.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);
  return scored.map((s) => s.item);
}
