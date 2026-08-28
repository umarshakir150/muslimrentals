/**
 * Deterministic backlog scoring. The Lead (lead.ts) proposes the
 * qualitative inputs (userImpact/severity/confidence/effort/
 * strategicRelevance) for a candidate it just found or re-evaluated — code
 * always computes the actual priority number from those inputs, the same
 * "model proposes, code decides" split already used for scheduling
 * (planner.ts) and implementation scope (crossBranchAnalysis.ts).
 *
 * This is a heuristic, not ground truth — see PART 5 of the task this
 * module was built for: "Do not pretend the score is objective truth."
 * The weights encode one explicit policy: security/privacy/safety/broken-
 * core-flow work generally outranks cosmetic polish, core MVP work
 * generally outranks speculative growth features, and verification gaps
 * are weighted seriously rather than treated as busywork. Every score is
 * persisted with the inputs and a plain-language explanation of how it was
 * computed, so a human can see (and dispute) exactly why one item outranked
 * another.
 */
import type { BacklogCategory } from './types.js';

// >1 generally outranks cosmetic/speculative work; <1 generally falls behind
// core/safety work at equal impact/severity. Tuned to the explicit ordering
// PART 5 asks for — not a scientific measurement.
const CATEGORY_WEIGHT: Record<BacklogCategory, number> = {
  SECURITY: 1.35,
  PRIVACY: 1.35,
  TRUST_SAFETY: 1.25,
  BUG: 1.2,
  LEGAL_FLAG: 1.2,
  TESTING: 1.1, // verification gaps matter more once autonomous work is happening
  FEATURE_GAP: 1.1, // core MVP journeys
  ACCESSIBILITY: 1.0,
  PERFORMANCE: 0.95,
  INFRASTRUCTURE: 0.9,
  DEVOPS: 0.9,
  UX: 0.9,
  TECH_DEBT: 0.8,
  PRODUCT_OPPORTUNITY: 0.75, // speculative growth work — deliberately deprioritized
  DOCUMENTATION: 0.6,
};

export interface PriorityInputs {
  category: BacklogCategory;
  userImpact: number; // 0-5
  severity: number; // 0-5
  confidence: number; // 0-1
  effort: number; // 0-5 — higher effort is penalized, not ignored
  strategicRelevance: number; // 0-5
}

export interface PriorityResult {
  score: number;
  rationale: string;
}

export function computePriority(inputs: PriorityInputs): PriorityResult {
  const weight = CATEGORY_WEIGHT[inputs.category];
  const raw = inputs.userImpact * 2 + inputs.severity * 2.5 + inputs.strategicRelevance * 1.5;
  const confidenceAdjusted = raw * inputs.confidence;
  const categoryAdjusted = confidenceAdjusted * weight;
  const effortAdjusted = categoryAdjusted / (1 + inputs.effort * 0.4);
  const score = Math.round(effortAdjusted * 2.5 * 10) / 10;

  const rationale =
    `score=${score} = (userImpact=${inputs.userImpact}*2 + severity=${inputs.severity}*2.5 + ` +
    `strategicRelevance=${inputs.strategicRelevance}*1.5) * confidence=${inputs.confidence} * ` +
    `categoryWeight(${inputs.category})=${weight} / (1 + effort=${inputs.effort}*0.4), scaled x2.5.`;

  return { score, rationale };
}

export function categoryWeightFor(category: BacklogCategory): number {
  return CATEGORY_WEIGHT[category];
}
