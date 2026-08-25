/**
 * Founder approval gate.
 *
 * The canonical list of what requires founder sign-off lives in exactly one
 * place: CLAUDE.md's "## Founder authority" bullet list. This module reads
 * that file at runtime and parses the bullets out — it does not hardcode a
 * second copy of the list. What IS hardcoded (necessarily — matching free
 * text against prose bullets needs some heuristic) is a keyword pattern set
 * per category, keyed to the bullet it corresponds to. A test
 * (tests/founderGate.test.ts) asserts every category's expected bullet
 * substring is still present in CLAUDE.md, so if the founder edits that
 * list, the mismatch fails loudly instead of silently losing a gate.
 *
 * This is intentionally a blunt, fail-toward-caution instrument: false
 * positives (asking the founder when it wasn't strictly necessary) are
 * cheap; false negatives (silently proceeding on something that needed
 * sign-off) are not. When in doubt, it flags.
 */
import { readFileSync } from 'node:fs';
import { CLAUDE_MD } from '../paths.js';

export interface FounderGateResult {
  required: boolean;
  reasons: string[];
}

interface Category {
  key: string;
  /** Case-insensitive substring used to locate this category's bullet in CLAUDE.md. */
  bulletSubstring: string;
  /** Fallback label if the bullet can't be found verbatim (CLAUDE.md wording drifted). */
  fallbackLabel: string;
  patterns: RegExp[];
}

const CATEGORIES: Category[] = [
  {
    key: 'production_deployment',
    bulletSubstring: 'production deployment',
    fallbackLabel: 'production deployment',
    patterns: [/\bdeploy(ment|ing|s)?\b/i, /\bship(ping)?\s+to\s+prod/i, /\brelease\s+to\s+production\b/i, /\bgo\s+live\b/i],
  },
  {
    key: 'irreversible_production_changes',
    bulletSubstring: 'irreversible production changes',
    fallbackLabel: 'irreversible production changes',
    patterns: [/\birreversible\b/i],
  },
  {
    key: 'deleting_production_data',
    bulletSubstring: 'deleting production data',
    fallbackLabel: 'deleting production data',
    patterns: [
      /\bdelete[^.]{0,40}\b(production|prod|user)\b[^.]{0,40}\bdata\b/i,
      /\bdrop\s+(table|column)\b/i,
      /\bpurge\b[^.]{0,40}\bdata\b/i,
      /\bwipe\b[^.]{0,40}\b(database|data)\b/i,
    ],
  },
  {
    key: 'permanent_account_bans',
    bulletSubstring: 'permanent account bans',
    fallbackLabel: 'permanent account bans',
    patterns: [/\bban(s|ned|ning)?\b/i, /\bpermanent(ly)?\s+suspend/i],
  },
  {
    key: 'publishing_legal_policies',
    bulletSubstring: 'publishing legal policies',
    fallbackLabel: 'publishing legal policies',
    patterns: [/\bpublish\b[^.]{0,40}\b(terms|privacy|polic(y|ies))\b/i, /\blegal\s+polic(y|ies)\b/i, /\bterms\s+of\s+service\b/i],
  },
  {
    key: 'spending_money',
    bulletSubstring: 'spending money',
    fallbackLabel: 'spending money',
    patterns: [/\bspend(ing)?\s+money\b/i, /\bpurchase\b/i, /\bpayment\b/i, /\bbilling\b/i, /\bsubscription\b/i, /\bpaid\s+(plan|tier)\b/i],
  },
  {
    key: 'major_auth_security_changes',
    bulletSubstring: 'authentication/security changes',
    fallbackLabel: 'major authentication/security changes',
    patterns: [
      /\b(rewrite|overhaul|redesign|replace)\b[^.]{0,40}\bauth(entication)?\b/i,
      /\bauth(entication)?\b[^.]{0,40}\b(rewrite|overhaul|redesign)\b/i,
      /\bsecurity\b[^.]{0,40}\b(overhaul|rewrite|redesign)\b/i,
    ],
  },
  {
    key: 'major_architecture_rewrites',
    bulletSubstring: 'architecture rewrites',
    fallbackLabel: 'major architecture rewrites',
    patterns: [
      /\brewrite\b[^.]{0,40}\barchitecture\b/i,
      /\barchitecture\b[^.]{0,40}\brewrite\b/i,
      /\bmigrate\b[^.]{0,40}\b(framework|database engine|stack)\b/i,
    ],
  },
];

/** Extracts the bullet lines under "## Founder authority" in CLAUDE.md. */
export function parseFounderAuthorityBullets(claudeMd: string): string[] {
  const lines = claudeMd.split('\n');
  const headingIdx = lines.findIndex((l) => /^##\s+Founder authority/i.test(l.trim()));
  if (headingIdx === -1) return [];

  const bullets: string[] = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^##\s+/.test(line.trim())) break; // next section
    const m = line.match(/^\s*-\s+(.*)$/);
    if (m) bullets.push(m[1]!.trim());
  }
  return bullets;
}

function findBullet(bullets: string[], substring: string): string | undefined {
  const needle = substring.toLowerCase();
  return bullets.find((b) => b.toLowerCase().includes(needle));
}

export function evaluateFounderGate(text: string, claudeMdContent?: string): FounderGateResult {
  const md = claudeMdContent ?? readFileSync(CLAUDE_MD, 'utf8');
  const bullets = parseFounderAuthorityBullets(md);
  const reasons: string[] = [];

  for (const category of CATEGORIES) {
    const matched = category.patterns.some((p) => p.test(text));
    if (!matched) continue;
    const bullet = findBullet(bullets, category.bulletSubstring);
    reasons.push(bullet ?? `${category.fallbackLabel} (CLAUDE.md wording not found verbatim — using built-in category)`);
  }

  return { required: reasons.length > 0, reasons };
}

/** Exposed for tests that want to assert CLAUDE.md still contains every expected category. */
export const FOUNDER_GATE_CATEGORIES = CATEGORIES.map((c) => ({ key: c.key, bulletSubstring: c.bulletSubstring }));
