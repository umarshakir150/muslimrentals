/**
 * The standing founder objective — the autonomy layer's one persistent,
 * founder-editable input. Every cycle reads this instead of a human typing
 * a fresh objective per task. See ai/autonomy-architecture.md.
 */
import { getDb } from './db.js';
import { nowIso } from './ids.js';
import { DEFAULT_STANDING_OBJECTIVE } from './types.js';

interface Row {
  id: string;
  text: string;
  updated_at: string;
}

export function getStandingObjective(): string {
  const db = getDb();
  const row = db.prepare("SELECT * FROM standing_objective WHERE id = 'default'").get() as Row | undefined;
  return row?.text ?? DEFAULT_STANDING_OBJECTIVE;
}

export function setStandingObjective(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('setStandingObjective: objective text cannot be empty.');
  const db = getDb();
  db.prepare(
    `INSERT INTO standing_objective (id, text, updated_at) VALUES ('default', ?, ?)
     ON CONFLICT(id) DO UPDATE SET text=excluded.text, updated_at=excluded.updated_at`
  ).run(trimmed, nowIso());
}
