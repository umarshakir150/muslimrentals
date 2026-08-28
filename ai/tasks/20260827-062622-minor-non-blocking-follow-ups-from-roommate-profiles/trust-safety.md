# trust_safety analysis

**Task:** 20260827-062622-minor-non-blocking-follow-ups-from-roommate-profiles

## Summary

Reviewed the two non-blocking follow-ups from the Roommate Profiles QA/Security review (audience-filter semantics for unset audiencePref, and participants.every() in the message-lookup route). Neither is an active abuse vector today, so backlog placement is appropriate. However, I could not locate any roommate-profile code in the actual repository (no 'roommate' references anywhere in rentals/backend or rentals/frontend, no ai/tasks/ record) to independently verify the reviewed files, which is a process gap the Supervisor should resolve. Separately, company/users.md already flags roommate profiles as a higher-risk surface requiring full Trust & Safety + Legal review before launch — these two polish items are not a substitute for that review.

## Findings

1. **[MEDIUM]** The roommate-profiles code referenced by this review (RoommateProfileFilters component, POST /roommate-profiles/:id/message route) could not be located anywhere in the current repository.
   - Evidence: Grep for 'audiencePref' and 'participants.every' in rentals/backend returned no matches; case-insensitive grep for 'roommate' across rentals/ returned no matches; no corresponding file exists under ai/tasks/. company/product.md explicitly states roommate profiles have 'no schema model, no routes, no frontend pages' as of the last verified read.
   - Recommended action: Supervisor should confirm which branch/worktree the reviewed code actually lives on before treating these as backlog items against the mainline codebase, and should re-run the workflow's build-verification step against that branch.
2. **[LOW]** EITHER audience-filter pill only matches profiles with audiencePref explicitly set to EITHER, missing profiles that left the field unset but may be open to any audience.
   - Evidence: Flagged by QA/Security (sig_0edaa6a8); not independently reproducible against current repo code since the file doesn't exist locally.
   - Recommended action: Route to Product Designer for filter-semantics decision (should 'unset' be treated as an implicit EITHER, or should posting require an explicit choice). No abuse/report-category implication — do not action as a T&S item.
3. **[LOW]** Conversation lookup in the roommate-profile message route uses participants.every(...) instead of an exact 2-participant match, which is only correct because conversations are always created with exactly 2 participants today.
   - Evidence: Flagged by Security (sig_a396e2ec); not independently reproducible against current repo code since the file doesn't exist locally.
   - Recommended action: Backlog as defense-in-depth hardening: switch to an exact-length + set-equality check. Do this before any feature introduces group/multi-participant conversations, since a lookup mismatch would then risk delivering a message into the wrong conversation thread — a genuine privacy/harassment issue at that point, not just a latent one.
4. **[MEDIUM]** Roommate profiles, once built, will introduce new user-generated content (bios, photos) and a new message-initiation path, but the platform's reporting system today only supports reporting listings.
   - Evidence: company/product.md: 'Reporting users or messages directly... Only listings are reportable today (POST /listings/:id/report). Flag this as a gap if a task touches harassment-via-messaging.' company/users.md flags roommate matching as 'a higher-risk surface for harassment and misrepresentation than listings.'
   - Recommended action: Before roommate profiles launch, require Backend/Engineering to add report categories for roommate profiles and for messages sent via the roommate-profile message flow, and require a full T&S severity-tier and escalation-rule pass for roommate-specific abuse cases (harassment, misrepresentation, malicious roommate behavior) — not just the two polish items in this backlog request.

## Open questions

- Which branch or worktree contains the actual roommate-profiles implementation that QA/Security reviewed, since it is absent from the checked-out repository?
- Has a full pre-launch Trust & Safety + Legal review (per company/users.md) been scheduled for roommate profiles, or is this backlog task the only T&S touchpoint planned so far?
- When roommate profiles ship, will messages/profiles be added to the existing Report model's categories, or is a separate reporting mechanism planned?

## Recommendation

Keep both items in the backlog as low-priority polish; neither blocks the current build-verification gap. (1) Audience-filter semantics (EITHER pill missing unset-audiencePref profiles) is a discovery/fairness issue, not an abuse vector — route to Product Designer as already suggested, no T&S action needed. (2) participants.every() vs. exact 2-participant match is a defense-in-depth item, not a live bug given conversations are always created with exactly 2 participants — low priority, but recommend fixing it now while cheap, before any group/multi-participant conversation feature is ever added, since a lookup mismatch there would become a genuine message-misrouting/harassment risk. Before this dovetails into anything scoped for launch: Supervisor should (a) confirm the roommate-profiles code actually exists on a real branch, since it isn't present in the repository as currently checked out, and (b) schedule the full T&S + Legal pre-launch review company/users.md calls for, which must additionally cover: making roommate profiles and roommate-profile-initiated messages reportable (currently only listings are reportable via POST /listings/:id/report), and defining severity tiers for harassment/misrepresentation/malicious-roommate abuse cases before this feature goes live.
