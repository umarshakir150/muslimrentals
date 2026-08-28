# trust_safety analysis

**Task:** 20260826-004717-design-and-build-the-first-production-ready

## Summary

Roommate Profiles introduces a new class of directly-personal, publicly-browsable content (people, not property) with meaningfully higher abuse/safety surface than Listings. Reviewed against existing Report model, Listing browse/detail patterns, and the app's known weaknesses (Listing.contactInfo exposed unauth). Key risks: scam/impersonation profiles, harassment via contact, enumeration/scraping of personal data, precise-location stalking risk, discriminatory free-text content, and misuse of reporting. The existing Report model is extensible enough to cover this MVP with a minimal additive change (nullable roommateProfileId FK, same pattern as the existing nullable listingId FK) rather than a new moderation system.

## Findings

1. **[HIGH]** Scam/impersonation risk transfers directly from Listings to Roommate Profiles — fraudsters can pose as roommate seekers to extract deposits, personal info, or pressure victims off-platform, and can impersonate real people using stolen photos/identity.
   - Evidence: company/users.md flags scams as the platform's single biggest known risk; no identity verification exists anywhere in the current auth model (email/password + Google OAuth only).
   - Recommended action: Reuse existing safety-page scam guidance on the roommate profile/detail page (contextual warning near contact action), and ensure reporting reason categories include an impersonation/scam-suspected option on the reused Report model.
2. **[HIGH]** A public or scrapeable roommate directory creates enumeration and stalking risk that Listings don't carry to the same degree, because the content is inherently about a person, not a property.
   - Evidence: Listing browse currently uses `optionalAuth` and Listing.contactInfo is already flagged as visible to unauthenticated viewers in company/architecture.md's known weaknesses — that precedent should not be copied here.
   - Recommended action: Gate the entire roommate directory (browse + detail) behind `authenticate`, paginate with sane limits, and never expose precise lat/lng, address, phone, or email in any roommate-profile response.
3. **[MEDIUM]** Free-text profile fields (bio/description) are a vector for discriminatory content, contact-info-stuffing to bypass the messaging system, and inappropriate content.
   - Evidence: Listing.description is comparable prior art but is about a unit, not a person; the same abuse pattern (embedding phone numbers/off-platform handles in free text) is a known risk category for any UGC bio field.
   - Recommended action: Apply the same input validation/length limits Listing description uses, and make bio content reportable via the reused Report model's INAPPROPRIATE_CONTENT-style reason.
4. **[MEDIUM]** No existing mechanism to report a user or profile directly — only listings are reportable today, which is an explicit product gap for this feature.
   - Evidence: company/product.md and ai/current-state.md both state only `POST /listings/:id/report` exists.
   - Recommended action: Add nullable `roommateProfileId` to the existing Report model (same nullable-FK pattern as `listingId`) rather than inventing a new report type or table.
5. **[LOW]** Misuse of reporting (retaliatory false reports to get a legitimate profile removed/hidden) is possible once profiles are reportable.
   - Evidence: Existing Listing report flow already carries this risk in principle; roommate profiles raise the stakes since removal affects a person's ability to find housing, not just a listing.
   - Recommended action: Rate-limit repeat reporting from the same reporter against the same target, and require human admin review before any removal — never auto-remove on report volume alone, only auto-flag for priority queue.

## Open questions

- Should the roommate directory require authentication to view (T&S recommends yes) even though Listing browse allows unauthenticated access — founder confirmation needed given this diverges from existing precedent.
- Should gender/audience-segment filtering (mirroring ListingAudience) be applied to person-profiles the same way it's applied to property listings, or does filtering people by this attribute need a different legal treatment than filtering units? Routed to Legal, not resolved here.
- Does the MVP need a lightweight 'block this user from messaging me' control given roommate profiles invite more direct, personal contact than listing inquiries, or is that explicitly out of scope for this MVP?

## Recommendation

Ship Roommate Profiles with these Trust &amp; Safety guardrails built in from the start, not retrofitted: (1) extend the existing Report model with a nullable `roommateProfileId` FK (mirrors the existing nullable `listingId` pattern) so profiles are reportable via a `POST /roommate-profiles/:id/report` route reusing the current reason/description/status shape — no new moderation system needed; (2) require authentication to view the roommate directory and individual profiles (stronger default than Listing's `optionalAuth`, given this is personal data about a person, not a property) — this is a deliberate divergence from Listing precedent, flag it to the founder for a quick confirm, not a blocking gate; (3) never return phone/email/contactInfo or precise lat/lng/address in any roommate-profile API response — city/neighbourhood-level location only, and route all contact through the existing in-app messaging system exactly as Listings do, explicitly avoiding the known `Listing.contactInfo` exposure weakness in this new surface; (4) give RoommateProfile the same soft-status lifecycle as Listing (`ACTIVE/INACTIVE/REMOVED`, no hard deletes) so deactivation and moderation removal both work through the existing pattern; (5) rate-limit profile creation (prevent spam/duplicate profiles) and report submission per reporter-per-profile (prevent retaliatory report abuse), reusing existing rate-limiter middleware; (6) extend the existing `/admin/reports` triage UI to display and resolve roommate-profile reports alongside listing reports rather than building a parallel admin surface; (7) auto-flag (not auto-act) reports for priority review when reason indicates suspected scam/impersonation or when the reported profile already has ≥2 prior non-dismissed reports — resolution, content removal, and any ban remain human/admin-only per the existing hard limits. Route the discriminatory-content and gender-segment-filtering-on-a-person-profile question to Legal for issue-spotting before this ships; Trust &amp; Safety is flagging the exposure risk, not resolving the policy question.
