# trust_safety analysis

**Task:** 20260826-005424-design-and-build-the-first-production-ready

## Summary

Roommate Profiles introduces a materially higher-risk surface than Listings: it centers on matching with a person, not a place, and (per company/users.md) needs stricter identity, contact, and location handling than the existing Listing model. Reviewed against the existing Listing/Report/messaging patterns (Listing.contactInfo, exact lat/lng, public unauthenticated browse) to identify what must NOT be copied forward as-is.

## Findings

1. **[CRITICAL]** Fake roommate profiles used for upfront-payment/deposit scams — the platform's single biggest known risk (company/users.md) extends directly to a new profile type.
   - Evidence: company/users.md renter/poster trust-concern sections; company/principles.md 'trust before growth hacks'
   - Recommended action: Reuse existing Report pipeline (item 6), auto-flag scam-reason reports for priority review (item 7); do not auto-remove, admin decides per existing Report.status workflow.
2. **[HIGH]** Stalking/safety risk if precise location (lat/lng or address) is exposed on a person-profile the way it already is on Listing.
   - Evidence: Listing model has lat/lng/address fields exposed; company/users.md notes roommate matching is 'higher-trust than a normal rental transaction'
   - Recommended action: Field/UX must use city or neighbourhood granularity only, never exact coordinates — route to Product Designer as a binding constraint, not a suggestion.
3. **[HIGH]** Public unauthenticated browse of roommate profiles enables scraping and low-cost harassment/enumeration in a way plain apartment listings don't.
   - Evidence: Listings currently use optionalAuth for public browse; roommate profiles are person-centric per company/users.md
   - Recommended action: Gate roommate profile browse/detail routes behind authenticate, not optionalAuth.
4. **[HIGH]** No existing mechanism to report a user or a roommate profile — only Listing is reportable today.
   - Evidence: ai/current-state.md: 'Reporting a user or a message directly — only listings can be reported today.'; Report model has only listingId (nullable) FK, no user/profile FK
   - Recommended action: Add nullable Report.roommateProfileId FK (additive) and POST /roommate-profiles/:id/report route mirroring the existing listings report route (reportSchema, authenticate, writeRateLimiter).
5. **[MEDIUM]** Repeating the Listing.contactInfo pattern (already flagged as a known weakness for unauthenticated exposure) on RoommateProfile would compound that risk on higher-trust, person-centric content.
   - Evidence: company/architecture.md 'Known weaknesses': 'Listing.contactInfo visible to unauthenticated viewers.'
   - Recommended action: No contactInfo field on RoommateProfile; require in-app messaging, which needs Conversation.listingId made nullable plus an optional roommateProfileId FK — flag this necessary touch to Engineering explicitly per scope-control instructions.
6. **[MEDIUM]** Misuse of reporting (false/retaliatory reports) against a legitimate profile holder is a realistic risk once reporting exists for profiles, mirroring the existing concern already documented for listing posters.
   - Evidence: company/users.md: listing-poster persona 'trust concern: could a bad-faith report get their legitimate listing removed unfairly'
   - Recommended action: Do not auto-remove/deactivate on report volume alone; require human admin review per existing Report.status workflow. Consider rate-limiting repeat reporters as a later hardening item, not required for MVP.

## Open questions

- Should RoommateProfile publication require User.isVerified (currently defined in schema but not enforced anywhere)? Recommend no for MVP, but this is a deliberate product-friction-vs-safety tradeoff worth the founder or Product Designer explicitly confirming rather than defaulting silently.
- Should Legal/Compliance's discrimination-risk pass on the final filterable-field list happen before or after Engineering starts building the schema, given schema changes should stay additive/non-destructive per CLAUDE.md? Recommend before, to avoid a second migration.

## Recommendation

Adopt these T&S requirements as binding constraints on the Product Designer's field list and Engineering's implementation, not optional nice-to-haves:

1. Gate browse/detail behind `authenticate` (not `optionalAuth`/public like Listings). A public, unauthenticated "people looking for roommates" directory is a scraping/stalking/enumeration risk that plain listings of apartments aren't — remove the anonymity that makes scraping/harassment cheap.
2. No `contactInfo` field on RoommateProfile (do not repeat the known Listing.contactInfo weakness, see ai/current-state.md). Contact must go through in-app messaging only. This requires Engineering to make `Conversation.listingId` nullable and add an optional `roommateProfileId` FK (additive, mirrors how `Report.listingId` is already optional) — flagging this now because it's a required touch to an existing shared model (Conversation), per the scope-control instruction to document any such necessity.
3. Location field must be city/neighbourhood-level only, never exact lat/lng or address — unlike Listing (which legitimately needs an exact pin for a property), a roommate profile pins a person, and precise location exposure is a stalking/safety risk, not a UX nicety.
4. No profile field should silently leak PII: no raw phone/email on the profile itself (User.phone/email must never appear in the public/browse or detail serializer — same explicit-safe-select discipline as the existing users.ts public-profile route).
5. Enforce one active profile per user at the DB level (unique constraint on userId, same discipline as `SavedListing.@@unique([userId, listingId])`) and auto-exclude profiles from browse/detail when the owning `User.isBanned` or the profile's own status is not ACTIVE — this must be a query-level filter, not a client-side hide.
6. Add reporting: extend the existing `Report` model with a nullable `roommateProfileId` FK (same optional-FK pattern as `Report.listingId`) and a `POST /roommate-profiles/:id/report` route that reuses the existing `reportSchema`, `authenticate`, `writeRateLimiter`, and admin-review pipeline (`Report.status` PENDING→REVIEWED/RESOLVED/DISMISSED) — do not build a new moderation system. This closes the gap flagged in ai/current-state.md ("reporting a user directly" doesn't exist yet); scope it minimally as reporting-the-profile, not a general user-report system.
7. Auto-flag for priority admin review (still human-reviewed, never auto-actioned): reports with reason category "scam"/"fraud"; ≥3 reports against the same profile/user within 72h; reports against a user with an existing PENDING or RESOLVED report on file. Everything else queues normally.
8. Rate-limit profile create/edit using the existing `writeRateLimiter` pattern to blunt spam/mass-profile creation and re-registration-after-ban churn (evasion).
9. Free-text bio field needs the same abusive-content posture as listing descriptions (length caps, no image uploads beyond what Product Designer scopes, and it should be reportable under #6) — do not build automated content filtering for MVP; rely on the reporting hook plus manual admin review, consistent with "what requires human review: any content removal beyond an obvious policy violation."

Abuse cases by severity: scam/fake-profile-for-upfront-fraud (critical — same core platform risk as listings, per company/principles.md "trust before growth hacks"), harassment via messaging initiated from a profile (high), stalking/safety from location or scraping (high — new risk class, not present in Listing today), impersonation (high), discriminatory/inappropriate bio content (medium-high), malicious/false reporting against a legitimate profile (medium), evasion via re-registration after ban (medium, mitigated by #5/#8).

Legal note (not authoritative): flag to Legal/Compliance that any filterable personal attribute on this profile (beyond the audience categories already established for Listings) is a discrimination-risk surface specific to this feature and needs their explicit sign-off on the field list before this ships — do not let Product Designer finalize filterable fields without that pass.

No founder-approval gate triggered by this T&S review specifically — items 1–9 are resolvable using this codebase's existing privacy-by-default/least-privilege principles and existing patterns (optional FKs on Report, unique constraints on SavedListing, writeRateLimiter), not novel product/legal calls. The one open item that may warrant a founder-level product call is whether any identity-verification requirement (leveraging the existing but currently-unenforced `User.isVerified`) should gate profile publication — recommend NOT requiring it for MVP (keep friction low, consistent with free-MVP stage) but flagging it as a deliberate, documented choice rather than an oversight.
