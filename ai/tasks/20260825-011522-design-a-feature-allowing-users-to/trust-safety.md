# trust_safety analysis

**Task:** 20260825-011522-design-a-feature-allowing-users-to

## Summary

Roommate profiles do not exist in the codebase yet (no schema, routes, or UI — confirmed in company/product.md and ai/current-state.md), so this is a design-ahead spec for reportability that must ship alongside the roommate profile feature itself, not bolted on after. Reporting is only supported for listings today (POST /listings/:id/report against a Report model with a nullable listingId); it needs a target-type generalization to cover roommate profiles too. This surface carries elevated risk versus listings because it centers on matching with a person, not a place.

## Findings

1. **[HIGH]** Report model is listing-specific (Report.listingId, nullable FK to Listing) with no polymorphic target. It cannot represent a report against a roommate profile without a schema change.
   - Evidence: prisma/schema.prisma model Report: reporterId + listingId only, no reportedUserId/profileId or reportType/targetType discriminator.
   - Recommended action: Route to Backend/Engineering: add a targetType enum (LISTING, ROOMMATE_PROFILE) plus a reportedUserId (or roommateProfileId once that model exists) on Report, keep listingId for backward compatibility, and expose POST /roommate-profiles/:id/report mirroring the existing listing report route's auth/rate-limit pattern.
2. **[CRITICAL]** Fake or catfishing roommate profiles are a distinct scam vector beyond listing scams: a bad actor can pose as a prospective roommate to build trust for in-person meetups, extract deposits/personal info, or target vulnerable users (e.g. new immigrants, students) with no property backing the claim at all.
   - Evidence: company/users.md flags this persona explicitly: 'this is a higher-risk surface for harassment and misrepresentation than listings, since it centers on matching with a person rather than a place.'
   - Recommended action: Require a dedicated report reason 'Suspected fake/catfishing profile' with priority-review routing, not just a generic 'inappropriate content' bucket.
3. **[HIGH]** Harassment risk is elevated because roommate matching implies ongoing messaging plus more personal disclosure (habits, gender, religiosity/practice level, sometimes photos) than a listing inquiry. Existing messaging has no direct report path today.
   - Evidence: company/product.md: 'Reporting users or messages directly' is listed as a known gap; only listings are reportable via POST /listings/:id/report.
   - Recommended action: Do not ship roommate-profile reporting without also closing the adjacent gap of reporting the associated conversation/message thread — a profile report should let the reporter attach the relevant message history as evidence, or Engineering should scope message reporting in the same pass.
4. **[MEDIUM]** Roommate profiles are more identity-adjacent than listings (self-description, lifestyle, possibly photos, gender/audience fields), so impersonation and misrepresentation reports need identity-relevant evidence categories distinct from listing fraud evidence.
   - Evidence: company/users.md persona notes 'identity and intent verification matter more here' than for a standard rental transaction.
   - Recommended action: Evidence bundle for a roommate-profile report should include: profile snapshot at time of report (immutable copy, same pattern as listing snapshot on removal), reporter/reported message thread if one exists, reporter account age/history, reported account age/history and any prior reports against that account.
5. **[MEDIUM]** Report categories should be broader than the current generic listing report reasons to reflect roommate-specific abuse.
   - Evidence: Existing Report.reason is a free-text/enum string tied to listing report UX; no roommate-specific categories exist because the feature doesn't exist yet.
   - Recommended action: Recommend reason set: Fake/catfishing profile, Harassment via messages, Inappropriate content (description/photos), Scam/solicitation for money, Impersonation, Spam/duplicate profile, Other. Each maps to a severity tier below.
6. **[INFO]** Severity tiers for roommate-profile reports, mirroring listing report triage but adjusted for the person-matching context.
   - Evidence: n/a — design recommendation
   - Recommended action: Critical (auto-priority queue): scam/money solicitation, fake/catfishing profile with evidence of off-platform payment requests, threats. High: harassment with message evidence, impersonation of a real identifiable person. Medium: inappropriate content, spam/duplicate profiles. Low: vague/no-evidence 'other' reports, single reports with no corroborating history.
7. **[MEDIUM]** Reporting-abuse risk exists here too: a rejected roommate match or a scorned party could weaponize reports to get a legitimate profile hidden or the poster banned.
   - Evidence: company/users.md flags 'malicious or retaliatory false reports' as an existing concern for listing posters; same dynamic applies, arguably more acutely, to roommate profiles given the personal/relational context.
   - Recommended action: Do not auto-hide a roommate profile on report volume alone. Apply the same manual-review gate used for listings: PENDING until an admin/moderator reviews via /admin/reports (extended to cover the new targetType). Automate only: rate-limiting a single reporter's repeat reports against the same target, and flagging (not hiding) profiles with 3+ distinct reporters within a short window for priority queue placement.
8. **[LOW]** What can be safely automated without human judgment.
   - Evidence: n/a — design recommendation, consistent with agents/trust-safety.md hard limits
   - Recommended action: Automate: rate-limiting repeat reports from the same reporter against the same profile; flagging profiles that share identical contact info/phone/email with an already-banned account or an already-removed listing/profile (duplicate-contact-info detection, same pattern already implied for listings); surfacing prior report count on the target account to the reviewing admin. Do NOT automate: content removal, profile hiding, or any ban — those stay behind /admin/reports and PATCH /admin/users/:id/ban, admin/founder-only per CLAUDE.md.

## Open questions

- Should roommate-profile reports also let the reporter attach specific message excerpts from the matching conversation, requiring the messaging-report gap to be closed in the same feature pass rather than deferred?
- What fields will the roommate profile model actually expose (photos? contact info visibility rules?) — evidence/report-category design here assumes a description+lifestyle-fields+optional-photo model similar to a listing; confirm once Engineering drafts the schema.
- Should there be a distinct 'impersonation of a real person' report path (e.g. someone using another real person's photo/name) requiring identity verification evidence beyond what admins currently handle for listings?

## Recommendation

Do not build roommate-profile reporting as a standalone add-on — scope it as part of the roommate profile feature's initial spec, per ai/current-state.md TODO #4. Concretely: (1) Backend/Engineering should generalize the Report model with a targetType discriminator (LISTING | ROOMMATE_PROFILE, and ideally MESSAGE_THREAD to close the existing messaging-report gap in the same pass) rather than adding a separate parallel report table; (2) add POST /roommate-profiles/:id/report mirroring the existing listing report route's auth, rate-limiting, and Zod `.strict()` validation patterns; (3) use the reason taxonomy and severity tiers above, with fake/catfishing-profile and money-solicitation reports auto-flagged for priority admin review while everything else queues normally through the existing PENDING→REVIEWED/RESOLVED/DISMISSED flow in /admin/reports; (4) automate only rate-limiting of repeat reporters and duplicate-contact-info flagging — all removal/ban actions remain manual, admin-only, per CLAUDE.md's founder-authority list and this role's hard limits. Loop in Legal for identity/consent issue-spotting given roommate profiles' higher personal-disclosure surface, and QA/Security once Backend has a concrete schema and route diff to review.
