# legal analysis

**Task:** 20260828-084425-add-ability-to-report-a-user

## Summary

Issue-spotting review for the proposed "report a user or message directly" feature (currently recommended by Engineering to be deferred pending the DB-migration verification gap). No terms/privacy/safety copy was changed. Found: (1) an existing, unrelated but serious drift — Terms §9 already promises account deletion ("You may delete your account at any time") that the product does not implement — should be escalated regardless of this task's timeline; (2) Privacy §5 already discloses message review "in response to abuse reports," which covers message-reporting specifically, so no new consent gap there; (3) new gaps to close before shipping: itemizing reported-user data in the Privacy Policy, defamation/due-process discipline around user-targeted reports, discrimination-vector risk in report reasons, and a Safety-page copy update once the surface expands beyond listings.</summary>
<parameter name="findings">[
  {
    "severity": "high",
    "finding": "Pre-existing drift (not caused by this task): terms/page.tsx §9 states \"You may delete your account at any time,\" but no user-initiated account/data deletion endpoint exists anywhere in the product (confirmed absent in company/architecture.md and company/product.md). This is a live, user-facing misrepresentation today, independent of whether the report-user/message feature proceeds.",
    "evidence": "rentals/frontend/src/app/terms/page.tsx:25 — '...You may delete your account at any time. Upon termination, your listings will be removed and your data handled per our Privacy Policy.' vs. company/architecture.md 'No user-initiated account/data deletion endpoint exists'",
    "recommendedAction": "Escalate to Supervisor/founder as its own backlog item, separate from this task: either build a deletion path or correct the Terms language (Terms edits require founder approval per CLAUDE.md). Recommend professional counsel review — this is a live consumer-protection/misrepresentation exposure, not just an issue-spotting note."
  },
  {
    "severity": "info",
    "finding": "Privacy Policy already discloses message-level review for abuse purposes, so adding a message-report feature does not itself create a new consent gap for that action.",
    "evidence": "rentals/frontend/src/app/privacy/page.tsx:21 — 'We may review messages in response to abuse reports.'",
    "recommendedAction": "None required for this specific disclosure when the feature is eventually built; verify the implementation matches this language (only review message content in the reported conversation, not unrelated messages)."
  },
  {
    "severity": "medium",
    "finding": "A user-targeted or message-targeted Report record stores new personal data about the reported party (allegation text, reporter identity, and potentially a snapshot/reference of message content as evidence) that is not itemized anywhere in the current Privacy Policy's data inventory.",
    "evidence": "privacy/page.tsx §2 only lists high-level purposes ('Detect fraud and ensure platform safety'), not what report-specific data is collected/retained about a reported user; schema.prisma's current Report model has no userId/messageId target field to review the shape of yet.",
    "recommendedAction": "When this feature is scoped, draft an addition to the Privacy Policy's data-inventory section describing report data collected (DRAFT — NOT LEGAL ADVICE — FOUNDER/COUNSEL REVIEW REQUIRED). Any change to privacy/page.tsx requires founder approval before publishing per CLAUDE.md."
  },
  {
    "severity": "medium",
    "finding": "Enabling reports against a specific user (as opposed to a listing) raises defamation and due-process exposure: allegations are recorded against an identifiable person, and moderation action (e.g., ban) taken on unverified reports could harm the reported user's reputation or platform access without a documented review standard.",
    "evidence": "company/architecture.md — admin panel currently handles 'report review (resolve/dismiss with a resolution note)' for listings only; no documented standard exists yet for user-targeted reports.",
    "recommendedAction": "Before shipping: keep report content and resolution notes internal/admin-only (do not surface 'reported' status publicly on a user profile), require a documented reason taxonomy rather than free text only, and apply the same due-process discipline currently used for listing reports and bans. Recommend a brief professional counsel check on Canadian defamation exposure for hosting/acting on third-party allegations, given this is new territory for the platform beyond listing reports."
  },
  {
    "severity": "low",
    "finding": "Because ListingAudience (BROTHERS/SISTERS/COUPLES/FAMILIES/ALL) is a self-selecting community-fit filter, a user-report feature could be weaponized to target someone on a protected ground (religion, sex, family status) dressed up as a 'community fit' or harassment complaint.",
    "evidence": "agents/legal.md discrimination-concerns guidance; ListingAudience enum in company/architecture.md.",
    "recommendedAction": "When Trust & Safety defines report reasons/moderation guidance for user reports, explicitly distinguish legitimate safety/harassment reports from discrimination-pretext reports, and train moderators (or write review guidance) accordingly. Design note, not a legal blocker."
  },
  {
    "severity": "low",
    "finding": "The Safety page currently scopes all reporting language to listings ('flag button on any listing') and makes an operational promise ('Our team reviews all reports within 24 hours'). If reporting expands to users/messages, this copy will need updating to reflect the new surface and confirm the 24-hour SLA is still realistic at higher volume.",
    "evidence": "rentals/frontend/src/app/safety/page.tsx:52-53, 81",
    "recommendedAction": "Draft a Safety-page copy update alongside the feature (DRAFT — NOT LEGAL ADVICE — FOUNDER/COUNSEL REVIEW REQUIRED). Any change to safety/page.tsx is a founder-approval item per CLAUDE.md — do not publish without it."
  }
]

## Findings

_No findings._

## Open questions

- Should the pre-existing Terms §9 account-deletion promise vs. no-deletion-endpoint gap be treated as urgent/blocking independent of this task, given it's a live misrepresentation to users today?
- When this feature is eventually scoped, should reported-user data have a distinct (shorter or policy-defined) retention period given the higher sensitivity of allegations about a specific person, versus general message/listing data?
- Should report reasons for user/message reports use a fixed enum (mirroring the existing ReportReason pattern for listings) rather than free text, to keep moderation review consistent and reduce discrimination-pretext risk?

## Recommendation

No legal objection to Engineering's recommendation to defer implementation until the DB-migration verification gap is resolved or the schema change is scoped narrowly — none of the findings above require blocking that decision. When this feature does move forward: (1) draft a Privacy Policy addition itemizing report data collected about a reported user, and a Safety-page update reflecting the expanded reporting surface — both DRAFT-only, founder/counsel approval required before publishing per CLAUDE.md; (2) keep report content/resolution notes admin-only, use a fixed reason taxonomy rather than free text, and avoid any public 'reported' flag on user profiles, to limit defamation and due-process exposure; (3) separately and with higher urgency, escalate to the Supervisor/founder the pre-existing Terms §9 vs. reality drift (Terms promises account deletion; no deletion endpoint exists) — this is live today, unrelated to this task's timeline, and warrants professional counsel review given it's a direct misrepresentation to users.
