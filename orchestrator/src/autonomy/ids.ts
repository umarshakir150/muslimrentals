import { randomUUID } from 'node:crypto';

/** Short, self-describing, globally-unique ids for autonomy-layer records
 * — a prefix makes an id readable in CLI/log output without a lookup. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
