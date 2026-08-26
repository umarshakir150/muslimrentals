# designer analysis

**Task:** 20260826-093438-design-and-build-the-first-production-ready

## Summary

Proposed MVP flow for Roommate Profiles, grounded in the existing Listing/Browse/ListingCard/ListingDetail patterns: a signed-in-only directory of person profiles (not units), browsed as cards and opened in a detail modal exactly like listings today, with a single owned profile per user, curated (non-free-text) compatibility fields instead of an open essay, messaging-only contact (no phone/email reveal), soft deactivate instead of delete, and a Report affordance reusing the existing Report model pattern.

## Findings

1. **[HIGH]** Contact info must never be directly revealed on a roommate profile the way ListingDetail currently reveals a listing's contactInfo field — messaging-only contact is required for this feature given the elevated trust/safety sensitivity of a person-directory.
   - Recommended action: Do not include phone/email in the RoommateProfile schema or any API response; route all contact through the existing in-app messaging system.
2. **[HIGH]** Precise location (address/lat/lng/map pin) is appropriate for a rental unit (Listing) but not for a person's profile — it creates a stalking/safety risk the Listing model's map feature doesn't have to the same degree.
   - Recommended action: Store and display city-level location only for roommate profiles; do not build a map view or geo-radius search for this feature.
3. **[MEDIUM]** The existing Conversation model requires a non-null listingId, so there is no current way to start a conversation anchored to a roommate profile rather than a listing.
   - Recommended action: Engineering must decide how roommate-profile messaging attaches to the Conversation model (e.g. nullable listingId + new optional roommateProfileId) before Frontend can wire up the Message button.
4. **[MEDIUM]** Filtering/displaying roommate seekers by gender-preference-for-roommate is likely legally sound (mirrors the existing ListingAudience pattern and the common shared-accommodation human-rights exception) but applies to people rather than units, which may warrant a distinct legal look.
   - Recommended action: Legal should issue-spot this specific field/filter before ship, even though strong precedent exists in this codebase for the listing-audience equivalent.
5. **[LOW]** Free-text bio fields on a public-facing person directory are a vector for discriminatory, harassing, or inappropriate content that curated fields don't have.
   - Recommended action: Cap bio length, keep lifestyle attributes as a curated tag list rather than open text where possible, and ensure the Report hook covers profile content specifically.

## Open questions

- Should the Roommates directory be gated behind sign-in only (my recommendation) or publicly browsable like Listings — is there a growth-vs-safety tradeoff the founder wants to weigh in on later?
- How should roommate-profile messaging attach to the existing Conversation model given its current listingId requirement — Engineering decision needed before Frontend build.
- Does Legal want the gender/audience-preference field treated identically to ListingAudience, or does a person-directory need additional review before launch?

## Recommendation

Build Roommate Profiles as a new top-level "Roommates" section that visually and interactionally mirrors Browse/Listing exactly, so users don't have to learn a new pattern:

**Entry point:** New "Roommates" link in Navbar (same level as Browse/Map/Post/Messages). Route `/roommates` for the directory; profile detail opens as a modal (`RoommateProfileDetail`) on card click, not a separate page — matching how `ListingDetail` already works from Browse. Add a "My profile" affordance (in the user menu or as a persistent CTA on `/roommates`) for create/edit/deactivate.

**Data model (1 profile per user, not multiple "posts"):** unlike listings, a roommate profile represents a person, so enforce one active profile per user (unique on userId), status flag (ACTIVE/INACTIVE) mirroring `ListingStatus`, soft-deactivate not hard delete.

**MVP fields — public to signed-in users only (see safety note below):**
- Display name + avatar (reuse `User.name`/`avatarUrl` — no new name field)
- Seeking type (enum: "Looking for a room" / "Has a room, needs a roommate") — required
- City (reuse City/CityAutocomplete, city-level only) — required
- Budget range (min–max monthly CAD, like listing price) — required
- Headline (short one-line free text, like a listing title) — required
- Bio (longer free text, like listing description) — optional
- Move-in timeframe: coarse enum (ASAP / within 1 month / flexible) — optional, no exact date
- Roommate-audience preference (BROTHERS/SISTERS/EITHER, reusing the existing `ListingAudience`-style enum already accepted in this product) — optional
- Lifestyle tags: curated multi-select chips (Non-smoker, Quiet household, Practicing, Student, Working professional, Pet-friendly, etc.) — optional, capped list, NOT free text, mirroring `ListingAmenity`'s constrained-vocabulary pattern

**Never included in any API response, at any auth level:** phone, email, precise address, lat/lng, or any map/geo pin. City name only. No "reveal contact info" button like listings have — contact happens only via in-app messaging, which is a deliberate deviation from `ListingDetail`'s "Contact" button given the higher trust/safety sensitivity of a person-directory (see `company/users.md` roommate-seeker section).

**Directory itself requires sign-in** (unlike Browse, which is public) — this is a designer-level privacy/safety default, not a founder-gated decision, since it doesn't touch money or legal copy; it substantially raises the bar against scraping/enumeration of a directory of real people. Flag to Security/T&S to confirm it's sufficient as the sole mitigation, and to the founder only if they want it reconsidered for growth reasons later.

**Browse UX:** `RoommateProfileCard` mirrors `ListingCard` (rounded-3xl white card, badge for seeking-type in top-left like the audience badge, avatar circle instead of photo, city + budget + move-in timeframe, up to 3 lifestyle-tag chips, "Message" button — no "Map" button, no save/heart in MVP). Filter bar (`RoommateProfileFilters`, mirrors `ListingFilters`) kept to 4 controls: seeking type, city, budget range, roommate-audience preference. Do not add lifestyle-tag filtering in MVP — display-only, to keep this a browse tool rather than a checklist-screening tool.

**Detail modal:** mirrors `ListingDetail` structure — header with seeking-type badge, Flag/Report and Close buttons; avatar-centered (no photo carousel, this is a person not a property); headline, city/budget/move-in; full bio; full lifestyle-tag chips; footer is "Message" (primary) for other users, or "Edit profile" / "Deactivate profile" if viewing your own profile.

**Required new states for Frontend:** empty state on `/roommates` ("No roommate profiles yet in [city] — be the first, create your profile" + CTA, mirrors Browse's empty state); brand-new-user empty state on "My profile" (one-line purpose copy + create CTA); loading skeleton grid (reuse Browse's animate-pulse pattern); error/retry state (reuse Browse's pattern); destructive-confirm state for Deactivate ("Your profile will be hidden from the Roommates directory. You can reactivate it anytime." — reversible, non-alarming copy, confirm dialog required before deactivating).

**Reporting:** add a Flag button on the detail modal identical in placement/behavior to `ListingDetail`'s report flow, reusing the existing `Report` model/pattern minimally scoped to roommate profiles (this becomes the app's first user-facing report-a-person hook — Backend/T&S should decide the minimal schema shape, e.g. an optional reported-profile relation on the existing Report model, not a new moderation system).

**Open question for Engineering (not resolved here):** the existing `Conversation` model requires a non-null `listingId`, so a "Message" button on a roommate profile has nowhere to attach a conversation today. Recommend adding a nullable optional link (e.g. `roommateProfileId`) and making `listingId` nullable on `Conversation` — additive/non-destructive per repo rules — but this is Engineering's call to scope and confirm; flag it rather than assuming it's already solved.

Legal should confirm before this ships: (1) whether a person-directory filterable by gender-preference-for-roommate carries different discrimination-law exposure than the existing listing-audience filter, even though it likely rests on the same shared-accommodation exception; (2) PIPEDA-relevant consent/retention treatment for this new category of personal data (bio, lifestyle tags, budget) since it's more personal than a listing. Security should verify ownership/IDOR on create/edit/deactivate, that browse/detail responses never leak phone/email/precise location under any auth state, and rate-limit/enumeration protection on the browse endpoint given it's a directory of real people.
