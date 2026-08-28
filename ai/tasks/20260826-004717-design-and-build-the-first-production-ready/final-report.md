# Final task report

- **Task ID:** 20260826-004717-design-and-build-the-first-production-ready
- **Final state:** FOUNDER_APPROVAL_REQUIRED
- **Agents involved:** designer, trust_safety, legal
- **Correction cycles used:** 0
- **QA verdict:** N/A
- **Security verdict:** N/A

## Objective

Design and build the first production-ready MVP of Roommate Profiles for Muslim Rentals.

Background: "Roommate profiles / roommate matching" is mentioned in the product's intended
scope (CLAUDE.md, company/product.md) but does not exist anywhere in the codebase today — no
schema model, no routes, no frontend pages (verified: no "roommate" string appears in
rentals/backend or rentals/frontend). This is genuinely new feature work, not a bug fix or an
extension of an existing feature.

Product goal: a signed-in user should be able to (1) create a roommate profile, (2) edit their
roommate profile, (3) deactivate/remove their roommate profile from discovery, (4) browse other
users' roommate profiles, and (5) view an individual roommate profile. This is an MVP — keep it
simple and useful, do not over-engineer it, and do not build a complex matching/recommendation
algorithm; plain browsing/filtering of profiles is preferred over an opaque
recommendation/matching algorithm unless the Product Designer or Engineering analysis surfaces a
compelling, concrete reason to do otherwise for this MVP specifically. Do not add any paid
features.

Product Designer: determine the appropriate MVP profile fields and browse/detail UX yourself,
grounded in this app's existing product and design patterns (how Listing/browse/ListingCard/
ListingDetail work today, the app's existing personas in company/users.md, and its existing
visual/interaction patterns) — do not invent a generic roommate-finder from scratch disconnected
from how this specific app already presents listings and profiles. Decide what "sensible
information useful for finding a compatible roommate" actually means for this specific
community-focused platform (see company/product.md's problem statement — this is not a generic
rental site). Prioritize privacy, safety, simplicity, mobile usability, and accessibility in the
field/UX choices. Do not require a user to publicly expose sensitive personal information beyond
what is genuinely necessary for the stated purpose.

Trust & Safety: review exactly what profile information is appropriate to expose publicly vs.
only to signed-in users vs. never expose at all, and identify abuse/privacy/safety risks specific
to a public-facing "people looking for roommates" directory (harassment, unwanted contact,
enumeration/scraping of personal details, impersonation, discriminatory profile content,
stalking/safety risk from real-time or precise location exposure, etc.) and what mitigations or
moderation/reporting hooks this MVP needs as a result. This app already has a Report model and a
"report a listing" flow (rentals/backend's Report model, POST /listings/:id/report) but no way to
report a user or message directly yet (ai/current-state.md) — decide whether Roommate Profiles
needs its own reporting hook for this MVP and, if so, scope it minimally and reuse the existing
Report model/pattern rather than inventing a new moderation system.

Legal/Compliance: issue-spot (not authoritative legal advice) housing-discrimination risk in
whatever profile fields/filters are proposed (this is a housing-adjacent product operating in
Canada — filtering or displaying roommate-seekers by certain personal attributes can raise
human-rights/discrimination concerns depending on which fields exist and how they're
filterable/searchable), privacy/PIPEDA-relevant concerns for a new category of personal data
being collected and displayed, and general user-generated-content/liability concerns for a new
public-facing profile type. Flag concerns for eventual professional legal review rather than
resolving them yourself.

Engineering: determine the concrete implementation using this app's existing architecture and
conventions — reuse existing authentication, existing UI components/styling/navigation patterns,
existing backend route/validation/ownership-check conventions (see how Listing CRUD and
save/unsave already handle ownership, Zod .strict() validation, and soft status changes), and
existing database conventions (see how Listing/ListingStatus/soft-removal already work — a
RoommateProfile likely follows a similar per-user-owned, status-flag pattern rather than hard
deletes). Split frontend and backend work between the Frontend and Backend roles if the work
cleanly divides that way, the same way past feature work in this repo has split. Any schema
change must be additive and non-destructive per this repo's ground rules (CLAUDE.md) — a new
table/model for roommate profiles is expected; do not touch existing Listing/User/Report/etc.
models beyond what's genuinely required (e.g. a new relation field on User, if needed).

Security must pay particular attention to: profile ownership and authorization on every
create/edit/deactivate operation, IDOR (can user A ever read, edit, or deactivate user B's
roommate profile, or act on it via a guessable/sequential ID), private information exposure
(is anything meant to be private ever returned in a public browse/detail API response),
enumeration/scraping risk on the browse/list endpoint, input validation on every field
(especially free-text fields), handling of abusive/inappropriate profile content, and how this
interacts with the existing reporting/moderation model.

Scope control: do not use this task as an excuse to redesign or touch unrelated areas of Muslim
Rentals (listings, messaging, admin, auth internals, etc.) beyond what Roommate Profiles genuinely
requires. Reuse existing authentication, existing frontend components/styling/navigation patterns,
existing backend conventions, existing validation patterns, and existing database conventions
wherever they already fit, rather than introducing new ones. If some other small supporting change
is genuinely required to ship Roommate Profiles (e.g. a new nav link, a small shared-component
change), include it and explicitly document why it was necessary in your implementation report —
do not silently expand scope without saying so.

Founder approval gate: if you (any agent, including the Supervisor) encounter a genuinely
consequential product or legal decision with multiple reasonable options and no clear
best answer resolvable from this app's existing product/context (e.g. a real
discrimination-risk tradeoff with no clean resolution, or a privacy/data-collection choice with
no established precedent in this codebase to follow), stop at the appropriate approval gate and
explain the decision, the available options, your recommendation, and the tradeoffs — do not
silently invent product or legal policy. Do not stop for ordinary implementation decisions
(exact field list, exact UI layout, exact validation rules, etc.) that a specialist agent is
capable of resolving and documenting on its own.

Do not deploy anything. Do not merge anything into the default/production branch automatically —
finish with the integrated, reviewed implementation on its own branch, ready for founder
inspection.

## Founder approval gate

**FOUNDER_APPROVAL_REQUIRED**

- Task objective itself is limited to designing/building the MVP on a feature branch with no deployment and no merge to the default branch, so none of CLAUDE.md's founder-approval triggers (production deployment, permanent bans, production data deletion, publication of legal policies, spending money, major auth/security changes) apply to the objective as scoped.
- However, per the task's explicit instructions, any specialist that encounters a genuinely consequential, precedent-free product/discrimination/privacy decision while executing this task (e.g. a specific profile field or filter with a real housing-discrimination tradeoff) must stop and escalate to the founder at that point rather than resolving it unilaterally — this is a conditional mid-task gate, not a property of the task's stated objective.
- production deployment
- publishing legal policies (Terms, Privacy, Safety pages)

## Summary

Execution stopped for founder approval. Agents involved so far: designer, trust_safety, legal.

## Files changed

_None (dry run or analysis-only task)._

## Next steps

- Founder review required before this task can proceed — see approval gate reasons above.
