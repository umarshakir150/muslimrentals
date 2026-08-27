# Users

Three primary personas use Muslim Rentals today. (A fourth — the roommate
seeker as a distinct *profile-holder* rather than just a browser — is
aspirational until roommate profiles are built; see `company/product.md`.)

## Renter

Someone looking for a place to live that fits their community/lifestyle
needs (e.g. sisters-only housing, proximity to a mosque).

- **Goals:** find a suitable, legitimate listing quickly; understand who
  it's being rented to (audience filter) before reaching out; contact the
  poster without exposing more personal info than necessary up front.
- **Common frustrations:** listings that are stale/no-longer-available,
  vague descriptions, unclear pricing (utilities/furnished ambiguity — the
  amenity system exists specifically to reduce this), slow responses.
- **Trust concerns:** is this a real listing and a real landlord; is the
  price too good to be true; will contacting the poster expose them to a
  scam (see `safety` page content, already covers some of this).
- **Likely misuse / safety concerns they're exposed to:** fake listings
  used to collect upfront deposits/e-transfers before a viewing; being
  pressured to move communication off-platform quickly (a common scam
  pattern); harassment through the messaging system.

## Listing poster / landlord

Someone renting out a unit or room, posting it to reach the Muslim
community specifically.

- **Goals:** reach qualified, serious renters that fit the audience they're
  renting to; avoid time-wasters and screening every inbound message
  manually; keep their contact info from being scraped/spammed.
- **Common frustrations:** low-quality inbound messages, needing to repeat
  the same details to every inquirer (the description/amenities fields
  exist to reduce this), not knowing if a listing is performing (view
  counts exist; deeper analytics don't).
- **Trust concerns:** is a given inquirer a serious renter; could a bad-
  faith report get their legitimate listing removed unfairly.
- **Likely misuse / safety concerns they're exposed to:** fraudulent
  inquiries used for identity theft or scams targeting landlords, malicious
  or retaliatory false reports against their listing.

## Roommate seeker

Someone looking to find or become a roommate rather than rent a whole unit
solo. **Note:** today this persona is served only indirectly — they browse
listings the same way a Renter does. There is no roommate-specific profile,
matching, or search yet (`company/product.md`).

- **Goals:** find a compatible roommate/room quickly with some assurance of
  community/lifestyle fit; avoid the awkwardness and risk of matching with
  a stranger with no shared context.
- **Common frustrations (anticipated, based on the general roommate-search
  problem — validate before building):** hard to gauge compatibility from a
  short listing; no dedicated space to describe themselves as a prospective
  roommate rather than just react to existing listings.
- **Trust concerns:** sharing a living space is higher-trust than a normal
  rental transaction — identity and intent verification matter more here.
- **Likely misuse / safety concerns:** this is a higher-risk surface for
  harassment and misrepresentation than listings, since it centers on
  matching with a person rather than a place — any roommate-profile feature
  needs Trust & Safety and Legal review before launch, not just Engineering
  and QA.
