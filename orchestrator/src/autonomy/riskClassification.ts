/**
 * Pre-execution risk classification — a gate that runs BEFORE a task is
 * even created, on top of (never instead of) the execution engine's own
 * founder-approval gate (src/approval/founderGate.ts), which still fires
 * mid-execution on the objective text exactly as before. This module never
 * trusts a backlog item's own stored `risk` field, the Lead's own
 * judgment, or anything the model claims — it recomputes deterministically
 * from the item's category and explicit flags every time, the same
 * "code decides" posture already used for scheduling and scope. See
 * ai/autonomy-architecture.md "Safety model" and PART 6 of the task this
 * was built for.
 */
import { evaluateFounderGate } from '../approval/founderGate.js';
import type { BacklogItem, RiskLevel } from './types.js';

export interface RiskClassification {
  risk: RiskLevel;
  reasons: string[];
}

// Additional autonomy-specific HIGH triggers beyond CLAUDE.md's own founder-
// authority categories (already covered via evaluateFounderGate below) —
// PART 6's HIGH examples not already implied by that gate.
const AUTONOMY_HIGH_RISK_PATTERNS: RegExp[] = [
  /\bsecret\b[^.]{0,40}\b(rotat|chang|regenerat)/i,
  /\b(rotat|regenerat)[^.]{0,40}\bsecret\b/i,
  /\bapi\s*key\b[^.]{0,40}\b(rotat|chang|regenerat|revok)/i,
  /\bmoderation\s+polic(y|ies)\b/i,
  /\bpermanent(ly)?\b[^.]{0,40}\bpolic(y|ies)\b/i,
];

const LOW_ELIGIBLE_CATEGORIES = new Set(['TESTING', 'DOCUMENTATION', 'ACCESSIBILITY']);

/** Categories that are treated the same as an explicit "requires legal
 * review" flag — LEGAL_FLAG work always needs founder/counsel involvement
 * before autonomous action starts on it, never just the Lead's own read. */
const ALWAYS_HIGH_CATEGORIES = new Set(['LEGAL_FLAG']);

export function classifyRisk(item: Pick<BacklogItem, 'title' | 'description' | 'rationale' | 'category' | 'severity' | 'effort' | 'requiresFounderDecision' | 'requiresLegalReview'>): RiskClassification {
  const reasons: string[] = [];
  const text = `${item.title}\n${item.description}\n${item.rationale}`;

  const founderGate = evaluateFounderGate(text);
  if (founderGate.required) {
    return { risk: 'HIGH', reasons: [...founderGate.reasons, 'Matches a CLAUDE.md founder-authority category — the same gate the execution engine itself enforces mid-task, applied here before any task is even created.'] };
  }

  if (item.requiresFounderDecision) reasons.push('Backlog item is explicitly flagged requiresFounderDecision.');
  if (item.requiresLegalReview) reasons.push('Backlog item is explicitly flagged requiresLegalReview.');
  if (ALWAYS_HIGH_CATEGORIES.has(item.category)) reasons.push(`Category ${item.category} always requires founder/counsel involvement before autonomous action.`);

  for (const pattern of AUTONOMY_HIGH_RISK_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push(`Text matches autonomy-specific high-risk pattern: ${pattern.source}`);
    }
  }

  if (reasons.length > 0) {
    return { risk: 'HIGH', reasons };
  }

  if (LOW_ELIGIBLE_CATEGORIES.has(item.category)) {
    return { risk: 'LOW', reasons: [`Category ${item.category} is in the low-risk set (tests, docs, accessibility) — safe to select and execute autonomously.`] };
  }
  if (item.category === 'BUG' && item.severity <= 2) {
    return { risk: 'LOW', reasons: ['Small (severity <= 2) bug fix — low-risk category per PART 6 examples.'] };
  }
  if ((item.category === 'UX' || item.category === 'TECH_DEBT') && item.effort <= 2) {
    return { risk: 'LOW', reasons: [`Low-effort (<=2) ${item.category} item — safe UI improvement / low-risk refactor per PART 6 examples.`] };
  }

  return {
    risk: 'MEDIUM',
    reasons: [
      `Category ${item.category} defaults to MEDIUM: may be implemented autonomously on an isolated branch (the execution engine already always works this way — worktrees, never a direct commit to the default branch), but is not auto-deployed and is not in the LOW auto-select-without-extra-scrutiny set.`,
    ],
  };
}
