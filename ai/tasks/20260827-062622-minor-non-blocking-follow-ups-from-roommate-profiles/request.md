# Task request

- **Task ID:** 20260827-062622-minor-non-blocking-follow-ups-from-roommate-profiles
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-08-27T06:26:22.124Z

## Objective

Minor non-blocking follow-ups from Roommate Profiles review

Two small non-blocking items flagged during the Roommate Profiles review: (1) RoommateProfileFilters' 'EITHER' audience pill only strictly matches profiles with audiencePref=EITHER set, so a searcher misses profiles that left audiencePref unset but might still be open to anyone — worth a Product Designer pass on the filter semantics. (2) The conversation-lookup logic in POST /roommate-profiles/:id/message uses participants.every(...) rather than an exact 2-participant match, which is only correct because conversations are always created with exactly 2 participants today — a small defense-in-depth hardening, not a current bug.

Why this matters (backlog rationale): Both items were explicitly identified with file-level evidence by QA and Security during an approved review, but both reviewers marked them non-blocking/low severity, so they belong in the backlog as low-priority polish rather than being actioned ahead of the build-verification gap.

Evidence:
- sig_0edaa6a8
- sig_a396e2ec
