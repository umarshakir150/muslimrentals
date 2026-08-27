# designer analysis

**Task:** 20260825-011522-design-a-feature-allowing-users-to

## Summary

Designed a report flow for roommate profiles, modeled on the existing listing-report pattern (flag icon → confirm → toast), but this feature has a hard dependency: roommate profiles themselves are not built yet (confirmed — no schema, routes, or pages exist; `ai/roadmap.md` places roommate profiles in "Later" and explicitly requires Designer+Backend+Trust&Safety+Legal review before any implementation starts, since this is a higher-risk person-matching surface, not just listing content).

## Findings

1. **[HIGH]** Roommate profiles do not exist in the codebase (no schema model, no routes, no frontend pages — confirmed against company/product.md and ai/roadmap.md). This task asks to design reporting for a feature that hasn't been built, so it cannot ship standalone.
   - Evidence: company/product.md: 'no "roommate" string appears anywhere in rentals/backend or rentals/frontend outside this documentation'; ai/roadmap.md 'Later' bucket: 'Roommate profiles and matching ... needs a full pass ... before any implementation starts.'
   - Recommended action: Supervisor should sequence this as a sub-task of the roommate-profiles feature itself, not an independent ticket, and ensure Backend, Trust & Safety, and Legal are looped in per the roadmap's explicit requirement.
2. **[MEDIUM]** The existing report affordance (listings) is a bare window.confirm() with a hardcoded reason string, even though the backend Report model supports a reason + optional description. This is fine for content reports but insufficient for reporting a person, where reason granularity matters for Trust & Safety triage.
   - Evidence: rentals/frontend/src/components/listings/ListingDetail.tsx:43-52 — window.confirm('Report this listing as inappropriate?') then listingsApi.report(listing!.id, 'Inappropriate content') hardcoded.
   - Recommended action: Build the roommate-profile report as a proper modal with reason selection + optional description (spec above), rather than copying the listing pattern verbatim. Do not retrofit the listing flow as part of this task — that would be scope creep into an unrelated area.
3. **[MEDIUM]** Report model likely needs generalization to support multiple target types (listing today, roommate profile next, user/message later per roadmap) rather than a new bespoke table per content type.
   - Evidence: rentals/backend/prisma/schema.prisma:204-208 shows Report with reason/description/status but no visible generic target-type field in the excerpt reviewed.
   - Recommended action: Flag to Backend/Engineering Lead to confirm the Report schema shape before implementation and decide on a target-type discriminator now, to avoid a second migration when user/message reporting is added next.
4. **[INFO]** Reporting a person is a materially different trust surface than reporting a listing — false or retaliatory reports against a specific individual, and the risk that a scammer/harasser could report a legitimate user to get them removed first.
   - Evidence: company/users.md: 'this is a higher-risk surface for harassment and misrepresentation than listings ... any roommate-profile feature needs Trust & Safety and Legal review before launch, not just Engineering and QA.'
   - Recommended action: Do not treat this as complete until Trust & Safety has reviewed the reason taxonomy and abuse cases (e.g. reason floods, coordinated reporting) and Legal has reviewed retention/handling of person-directed allegations.

## Open questions

- Is the founder prioritizing roommate profiles now (pulling it forward from the 'Later' roadmap bucket), or is this task premature and should be deferred until that feature is scoped?
- Should reporting a roommate profile also offer a 'block this user' action in the same flow, given the higher person-to-person risk, or should blocking be a separate feature?
- Does the admin Reports queue need a target-type filter/column added now, or can it wait until roommate profiles + reporting actually ship?

## Recommendation

Do not implement this in isolation. Sequence it as part of the roommate-profiles feature buildout (or immediately after MVP launch of that feature), not as a standalone report endpoint against nothing. Before implementation: (1) Backend must confirm/generalize the Report model — it currently appears scoped to listings (listingId FK); reporting a person needs a target-type model (LISTING | ROOMMATE_PROFILE, and later USER/MESSAGE per roadmap) rather than a new one-off table. (2) Trust & Safety review is mandatory, not optional, because this reports a *person* — false/retaliatory reporting risk and harassment-escape-valve misuse are higher here than for listings (see `company/users.md` on roommate seeker risk). (3) Legal issue-spotting is needed given reports store user-authored allegations about a specific individual (retention, potential defamation-adjacent content). Once roommate profiles are scoped, hand this flow spec to Frontend/Backend as the reference for the report sub-feature.

Flow (mirrors and slightly upgrades the existing listing-report pattern):
1. Entry point: a "Report" flag icon on the roommate profile detail view, same placement convention as `ListingDetail.tsx`'s report button. Also add the same affordance in the message-thread header for a conversation tied to a roommate profile, since harassment more often surfaces in messages than on the static profile.
2. Unauthenticated tap: "Sign in required" toast, same as listings — do not gate visibility of the button itself, only submission.
3. Authenticated tap opens a modal (recommend upgrading from the listing flow's bare `window.confirm()` to a real modal here — reporting a person warrants more structure than reporting content):
   - Title: "Report this profile"
   - Reassurance line: "Your report is confidential — this person won't be notified that you reported them."
   - Required reason, presented as radio options (not a dropdown, for mobile tap-target size): "Fake or impersonated profile" / "Scam or fraud attempt" / "Inappropriate or offensive content" / "Harassment" / "Misrepresents themselves (e.g. gender, living situation)" / "Other"
   - Optional free-text description (matches backend's existing optional `description` field)
   - Primary button "Submit report" (disabled until a reason is picked), secondary "Cancel"
4. Loading state: submit button shows spinner + "Submitting…", disabled to prevent double-submit.
5. Success state: modal closes, toast "Report submitted — we review all reports within 24 hours" (reuses existing safety-page copy for consistency). No visible "reported" badge shown anywhere the other party could see it.
6. Error state: keep the modal open with an inline error message ("Something went wrong submitting your report. Try again.") so the user doesn't lose their typed reason/description — do not just fire a toast and close, since that loses their input.
7. Duplicate-report state: if this user already reported this profile, show the report button as disabled/already-reported ("You've already reported this profile") rather than allowing silent re-submission — needs a backend uniqueness check per (reporter, target).
8. Accessibility: modal needs focus trap and ESC-to-close, radio rows and the flag icon at ≥44px tap targets, all form elements labeled for screen readers.

New states Frontend/Backend must build (call these out explicitly so they aren't missed): loading (submitting), success (toast + close), error (inline, non-destructive of user input), duplicate-report (disabled state), and the confirm-adjacent "not visible to the reported party" trust guarantee must hold end-to-end (don't leak reporter identity in admin UI to anyone but moderators).
