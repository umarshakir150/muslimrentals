/**
 * One-time cleanup of the pre-existing approval-request duplicates caused by
 * the bug fixed in this same change (approvalStore.ts's missing dedup
 * guard + lead.ts's unvalidated escalation.backlogItemId). This script does
 * NOT contain any general dedup algorithm — the historical rows are already
 * corrupted in ways a fresh guard can't retroactively regroup on its own
 * (the same real backlog item shows up under its real id, a truncated id,
 * and no id at all across different rows), so the exact grouping below was
 * worked out by hand against the live .autonomy/state.db on 2026-09-06 and
 * is hardcoded intentionally. Do not reuse this script for any future
 * cleanup — the store-layer guard (approvalStore.ts) and the id validation
 * (lead.ts) prevent this class of duplicate from recurring.
 *
 * Usage:
 *   npx tsx scripts/dedupe-approvals-2026-09-06.ts            # dry run (default) — prints the plan, changes nothing
 *   npx tsx scripts/dedupe-approvals-2026-09-06.ts --apply    # actually applies the SUPERSEDED decisions
 */
import { getApprovalRequest, decideApprovalRequest } from '../src/autonomy/approvalStore.js';

interface SupersessionGroup {
  label: string;
  canonicalId: string;
  supersededIds: string[];
  note: string;
}

const GROUPS: SupersessionGroup[] = [
  {
    label: 'Google Sign-In fate (bl_8341eb1a-1682-4703-b0b9-6725f44258b0)',
    canonicalId: 'appr_a4f22b1c-e2d6-410c-b339-c8830bc4ad84',
    supersededIds: [
      'appr_01b12272-0d82-4f88-9bfa-0057aa475658', // truncated backlogItemId ("bl_8341eb1a")
      'appr_cd1cc07b-fd45-4c27-922a-1b928bc39bb2', // no backlogItemId, only mentioned in title
      'appr_6c3f2f7b-8932-4eca-a695-7dcede0ef366',
      'appr_67099909-581b-4e32-849f-7f244961a4ad',
      'appr_90ee5603-fab9-47ad-a87a-1fb3f39ea70b',
      'appr_acb14963-1c0f-405d-9d3a-edaa831b5e32', // no backlogItemId, only mentioned in title
    ],
    note: 'Superseded by appr_a4f22b1c-e2d6-410c-b339-c8830bc4ad84 — duplicate re-escalation of the same still-open Google Sign-In fate decision (2026-09-06 dedup cleanup).',
  },
  {
    label: 'Basic CI approval (bl_ad4f53c8-6375-487d-a46b-1f8f6a42bfb2)',
    canonicalId: 'appr_84629ee7-9192-413e-93cd-60eb7089d200',
    supersededIds: [
      'appr_3484150c-de7d-4184-ab20-ed364b26b53b', // truncated backlogItemId ("bl_ad4f53c8")
      'appr_46d3ebf4-407b-4af1-be01-6acdb17caa14', // no backlogItemId, only mentioned in title
      'appr_5b22b8ee-adb1-4bd9-a010-2079eb98a9df',
      'appr_c381f614-1f9e-44b7-adf7-86beecfba2f3',
      'appr_8619d66a-460c-4a06-ab29-6bad46fb12c9',
      'appr_ea9e894e-f375-46aa-a9d4-af9e18954de5', // no backlogItemId, only mentioned in title
    ],
    note: 'Superseded by appr_84629ee7-9192-413e-93cd-60eb7089d200 — duplicate re-escalation of the same still-open basic-CI approval decision (2026-09-06 dedup cleanup).',
  },
];

/** Not a duplicate group — these two are independently stale because the
 * underlying work (PR #10, which resolved bl_7a0b37d9) already merged into
 * main on 2026-09-06. No canonical replacement; both are simply moot. */
const STALE_MOOT_IDS = [
  'appr_0201cdc3-2440-4262-b8fa-51636b913cce', // FOUNDER_DECISION_REQUIRED mid-execution
  'appr_25618404-cdc4-4721-8b6a-4976b6ba1737', // RETRY_LIMIT_EXHAUSTED
];
const MOOT_NOTE = 'Superseded — moot. This backlog item (bl_7a0b37d9, prior-interaction-evidence moderator task) shipped as PR #10, merged into main 2026-09-06. No founder decision is needed on this request any more.';

const apply = process.argv.includes('--apply');

function planLine(id: string, note: string): void {
  const req = getApprovalRequest(id);
  if (!req) {
    console.log(`  ! ${id} — NOT FOUND, skipping (already resolved or id typo)`);
    return;
  }
  if (req.status !== 'PENDING') {
    console.log(`  - ${id} — already ${req.status}, skipping ("${req.title}")`);
    return;
  }
  console.log(`  ${apply ? '>' : '?'} ${id} -> SUPERSEDED  ("${req.title}")`);
  if (apply) decideApprovalRequest(id, 'SUPERSEDED', note);
}

function main(): void {
  console.log(`[dedupe-approvals] mode: ${apply ? 'APPLY (mutating .autonomy/state.db)' : 'DRY RUN (no changes will be made)'}\n`);

  for (const group of GROUPS) {
    console.log(`== ${group.label} ==`);
    const canonical = getApprovalRequest(group.canonicalId);
    console.log(`  canonical (kept PENDING): ${group.canonicalId} ("${canonical?.title ?? 'NOT FOUND'}")${canonical && canonical.status !== 'PENDING' ? `  [warning: canonical is ${canonical.status}, not PENDING]` : ''}`);
    for (const id of group.supersededIds) planLine(id, group.note);
    console.log('');
  }

  console.log('== Stale/moot (bl_7a0b37d9 — PR #10 already merged) ==');
  for (const id of STALE_MOOT_IDS) planLine(id, MOOT_NOTE);

  console.log(`\n[dedupe-approvals] ${apply ? 'done.' : 'dry run complete — re-run with --apply to actually mutate the DB.'}`);
}

main();
