# Task

## Objective

What the founder actually asked for, in one or two sentences.

## Business context

Why this matters — link to `company/product.md`, `company/users.md`, or the
specific founder request that motivated it.

## Status

`OPEN` / `IN_PROGRESS` / `IN_REVIEW` / `CHANGES_REQUIRED` / `BLOCKED` /
`DONE` — keep this current; it's what the Supervisor scans across tasks.

## Owner

Which agent is currently driving this task (usually Engineering Lead once
past the scoping stage).

## Participating agents

List every `agents/*.md` role involved in this task and why. Don't list a
role that isn't actually needed.

## Dependencies

Other tasks, decisions (`ai/decisions.md`), or founder answers this task is
blocked on.

## Requirements

The consolidated, agreed spec — what must be true when this is done.

## UX considerations

Product Designer's input, if this task touches a user-facing flow.

## Trust & Safety considerations

Abuse cases, report categories, escalation rules — if this task touches
user-generated content, messaging, profiles, or moderation. Otherwise:
"N/A — no user-generated content or moderation surface."

## Legal / privacy considerations

Issues flagged by Legal — if this task touches privacy, retention, consent,
housing regulation, discrimination, or terms. Otherwise: "N/A." Mark any
open issue that needs professional counsel explicitly.

## Technical plan

Engineering Lead's breakdown: files touched, Frontend/Backend split,
migration/regression risk, and — for any new user-owned/user-generated
object — the object-level authorization checklist from `agents/backend.md`.

## Files likely affected

A concrete list, updated as work proceeds.

## Test plan

What was tested and how. If no automated tests exist for this area yet
(see `ai/current-state.md`), document the manual steps taken and their
results here.

## QA result

`PASS` or `CHANGES_REQUIRED`, plus findings per `agents/qa.md`'s format.

## Security result

`APPROVED` or `CHANGES_REQUIRED`, plus findings per `agents/security.md`'s
format. `N/A` only if Security genuinely wasn't required — say why.

## T&S result

Findings/recommendation per `agents/trust-safety.md`. `N/A` if genuinely
not applicable — say why.

## Legal flags

Findings per `agents/legal.md`, each marked with severity and whether
professional counsel review is needed. `N/A` if genuinely not applicable.

## Open questions

Anything still unresolved — for the Supervisor or the founder.

## Founder approval required?

Yes/No, and specifically why (production deploy, permanent ban, production
data deletion, publishing legal policy, spending money, major auth/security
change — per `CLAUDE.md`). If yes, this task is not done until that
approval is recorded here.

## Final result

What actually shipped (or didn't), when, and what's left for a follow-up
task if anything.
