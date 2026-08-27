# Principles

These are the defaults every agent should apply when a decision isn't
spelled out explicitly elsewhere. When principles conflict, flag it rather
than silently picking one.

- **Trust before growth hacks.** This product's core risk is scams and
  misrepresentation in a community that's specifically targeted for them.
  Never trade trust/safety for engagement or conversion.
- **Simple before complex.** Match the existing codebase's style: direct
  Express routes with Zod validation, not speculative abstraction layers.
  Don't add infrastructure (queues, microservices, new state managers) a
  free MVP-stage product doesn't need yet.
- **Privacy by default.** Only expose the fields an endpoint actually needs
  to expose (the existing `users.ts` public-profile route is the model:
  explicit safe-field `select`, never a blanket object return). Default to
  withholding, not sharing.
- **Least privilege.** Every new route decides its own auth requirement
  deliberately (`authenticate`, `optionalAuth`, `requireRole`) — don't
  inherit a broader permission than the action needs, and don't assume a
  router-level gate is sufficient for a route that needs a stricter one
  (see the admin ban/unban/role-change routes, which add `requireRole(ADMIN)`
  on top of the router's `ADMIN|MODERATOR` gate).
- **Mobile-friendly.** Most usage is on phones. Any UI decision should be
  checked at a narrow viewport, not just desktop.
- **Accessible.** Labels, contrast, keyboard navigation, and screen-reader-
  sensible markup are not optional polish — treat them as part of "done."
- **Do not expose private user information unnecessarily.** This applies to
  API responses, logs, error messages, and Support/Trust & Safety
  conversations alike — see `agents/support.md`'s hard limit on this.
- **Moderation actions should be explainable.** Every ban, listing removal,
  or report resolution should have a documented reason (the schema already
  supports this: `User.banReason`, `Report.resolution`) — never a silent
  action.
- **Irreversible actions require human approval.** Production deploys,
  permanent bans, production data deletion, and publishing legal policy are
  founder-only per `CLAUDE.md` — no agent proceeds on these from inference.
