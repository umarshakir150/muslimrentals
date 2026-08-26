import { randomUUID } from 'node:crypto';

/** Short, self-describing, globally-unique ids for autonomy-layer records
 * — a prefix makes an id readable in CLI/log output without a lookup. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Strips keys whose value is `undefined` from a partial patch object
 * before merging it onto an existing record with `{...existing, ...patch}`.
 * Without this, a patch that simply omits a field (JS/TS convention for
 * "don't change this") is indistinguishable from one that explicitly sets
 * it to `undefined` — and object spread treats a *present* key with value
 * `undefined` as an overwrite, silently nulling out a real existing value.
 * Observed for real: a Lead-generated status-only backlog update (no
 * scoring fields touched) reset userImpact/severity/confidence/effort/
 * strategicRelevance to undefined and crashed BacklogItem validation. Every
 * store module's "merge a partial patch onto an existing record" function
 * must run the patch through this first. */
export function definedOnly<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result;
}
