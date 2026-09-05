/**
 * Admin routes
 * OWASP A01 – Broken Access Control
 *
 * Security measures:
 *  - Double-layered: authenticate + requireRole applied to entire router
 *  - adminRateLimiter applied to the whole router
 *  - UUIDs validated on all :id params
 *  - .strict() Zod schemas

 *  - ADMIN_SECRET header check on destructive actions (extra safety layer)
 */
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '../prisma/client';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { UserRole, ListingStatus, ReportStatus } from '@prisma/client';
import { validateUuidParam } from '../middleware/validateUuid';
import { adminRateLimiter, writeRateLimiter } from '../middleware/rateLimiter';
import { logger } from '../utils/logger';

const router = Router();

// S3 is optional-with-warning, same guard as users.ts/listings.ts/uploads.ts
// -- permanent account deletion must still work (the DB row is the source
// of truth) even if AWS/R2 isn't configured; avatar cleanup just skips the
// best-effort object delete.
const AWS_CONFIGURED = Boolean(
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET
);
const s3 = AWS_CONFIGURED
  ? new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    })
  : null;

// ─── Auth gate: every admin route requires auth + role ────────────────────────
router.use(adminRateLimiter, authenticate, requireRole(UserRole.ADMIN, UserRole.MODERATOR));

// ─── Input schemas ────────────────────────────────────────────────────────────

const banSchema = z.object({
  reason: z.string().min(5).max(500).trim(),
}).strict();

const restrictSchema = z.object({
  protectedUserId: z.string().uuid(),
  reason:          z.string().min(5).max(500).trim(),
}).strict();

const unrestrictSchema = z.object({
  protectedUserId: z.string().uuid(),
}).strict();

const roleSchema = z.object({
  role: z.nativeEnum(UserRole),
}).strict();

const removeListingSchema = z.object({
  reason: z.string().min(5).max(500).trim(),
}).strict();

const permanentDeleteSchema = z.object({
  reason: z.string().min(5).max(500).trim(),
}).strict();

const reportUpdateSchema = z.object({
  status:              z.nativeEnum(ReportStatus).optional(),
  resolution:          z.string().max(500).trim().optional(),
  // messageSnapshot retention hold (founder-approved policy, 2026-09-02):
  // an admin/moderator can toggle this independent of status, to pause the
  // 90-day post-resolution retention clock for an active investigation,
  // dispute, or legal-preservation need. Both optional, and independent of
  // `status`/`resolution` above, so a hold-only PATCH doesn't require also
  // resending (or accidentally changing) the report's status.
  retentionHold:       z.boolean().optional(),
  retentionHoldReason: z.string().max(300).trim().optional(),
}).strict();

const adminQuerySchema = z.object({
  q:    z.string().max(200).trim().optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

const statusQuerySchema = z.object({
  status: z.nativeEnum(ListingStatus).optional(),
  page:   z.coerce.number().int().min(1).max(500).default(1),
});

// ─── GET /admin/stats ─────────────────────────────────────────────────────────
router.get('/stats', async (_req, res: Response, next: NextFunction) => {
  try {
    const [users, listings, reports, messages] = await Promise.all([
      prisma.user.count(),
      prisma.listing.count({ where: { status: 'ACTIVE' } }),
      prisma.report.count({ where: { status: 'PENDING' } }),
      prisma.message.count(),
    ]);
    res.json({ success: true, data: { users, activeListings: listings, pendingReports: reports, messages } });
  } catch (err) { next(err); }
});

// ─── GET /admin/users — directory search for User Search/Management ──────────
// ADMIN-only (escalated like /ban, /role, and permanent delete) -- unlike
// every other GET in this router, this one returns a searchable slice of
// every user account, so it's deliberately not available to MODERATOR.
// Partial, case-insensitive match on name or email (`q`), returning only
// the fields the admin UI actually needs (never passwordHash, tokens, or
// other sensitive columns). No `q` returns the full directory ordered by
// newest-first, same as before this became ADMIN-only -- the frontend's
// own User Search UI only ever calls this with a non-empty query.
router.get('/users', requireRole(UserRole.ADMIN), async (req, res: Response, next: NextFunction) => {
  try {
    const { q, page } = adminQuerySchema.parse(req.query);
    const where: any = {};
    if (q) where.OR = [
      { name:  { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 25,
        skip: (page - 1) * 25,
        select: {
          id: true, name: true, email: true, role: true,
          isBanned: true, isActive: true, createdAt: true,
          _count: { select: { listings: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);
    res.json({ success: true, data: users, total });
  } catch (err) { next(err); }
});

// ─── PATCH /admin/users/:id/ban ───────────────────────────────────────────────
// Also hides every currently-ACTIVE listing this user owns from public view
// (status -> BANNED), in the same transaction as the account ban so the two
// can never end up out of sync. Only ACTIVE listings are touched -- one
// that was already INACTIVE/PENDING/REMOVED for an unrelated reason is left
// exactly as it was, so /unban knows to leave it alone too (see below).
router.patch('/users/:id/ban', validateUuidParam('id'), requireRole(UserRole.ADMIN), writeRateLimiter, async (req, res: Response, next: NextFunction) => {
  try {
    const { reason } = banSchema.parse(req.body);
    const [user] = await prisma.$transaction([
      prisma.user.update({
        where: { id: req.params.id },
        data: { isBanned: true, banReason: reason, refreshToken: null },
      }),
      prisma.listing.updateMany({
        where: { userId: req.params.id, status: ListingStatus.ACTIVE },
        data:  { status: ListingStatus.BANNED },
      }),
    ]);

    // Force-close any live connection this user already has open -- the
    // DB re-check on every REST request already blocks them from doing
    // anything further, but Socket.IO's own auth only runs at connect
    // time (see socketServer.ts), so a session opened before this ban
    // would otherwise sit connected indefinitely (marking messages read,
    // seeing typing indicators, receiving new-message pushes) until it
    // happens to reconnect on its own.
    req.app.get('io')?.in(`user:${req.params.id}`).disconnectSockets(true);

    res.json({ success: true, message: `User ${user.email} banned.` });
  } catch (err) { next(err); }
});

// ─── PATCH /admin/users/:id/unban ────────────────────────────────────────────
// Restores only the listings this ban itself hid (status === BANNED) back
// to ACTIVE. A listing that was already INACTIVE/PENDING/REMOVED before the
// ban was never moved to BANNED in the first place, so it's untouched here
// too -- and one a moderator explicitly REMOVED while the owner was banned
// also stays REMOVED, since by then it's no longer at BANNED status either.
router.patch('/users/:id/unban', validateUuidParam('id'), requireRole(UserRole.ADMIN), writeRateLimiter, async (req, res: Response, next: NextFunction) => {
  try {
    const [user] = await prisma.$transaction([
      prisma.user.update({
        where: { id: req.params.id },
        data: { isBanned: false, banReason: null },
      }),
      prisma.listing.updateMany({
        where: { userId: req.params.id, status: ListingStatus.BANNED },
        data:  { status: ListingStatus.ACTIVE },
      }),
    ]);
    res.json({ success: true, message: `User ${user.email} unbanned.` });
  } catch (err) { next(err); }
});

// ─── POST /admin/users/:id/restrict ───────────────────────────────────────────
// Narrower than /ban: stops :id from messaging one specific other user
// (protectedUserId, typically the reporter who filed a report against them)
// without touching the rest of their account -- login, other conversations,
// listings, and profile visibility are all unaffected. ADMIN or MODERATOR
// (the router's default gate); unlike /ban this isn't escalated to
// ADMIN-only since it's a narrow, reversible, per-relationship action.
// Upserted on the (restrictedUserId, protectedUserId) unique pair so
// restricting an already-restricted pair updates the reason/re-activates
// a previously lifted restriction instead of erroring or duplicating.
router.post('/users/:id/restrict', validateUuidParam('id'), writeRateLimiter, async (req, res: Response, next: NextFunction) => {
  try {
    const { protectedUserId, reason } = restrictSchema.parse(req.body);
    if (protectedUserId === req.params.id) throw new AppError('A user cannot be restricted from messaging themselves.', 400);

    const protectedUser = await prisma.user.findUnique({ where: { id: protectedUserId }, select: { id: true } });
    if (!protectedUser) throw new AppError('protectedUserId does not refer to a real user.', 400);

    await prisma.userMessageRestriction.upsert({
      where: { restrictedUserId_protectedUserId: { restrictedUserId: req.params.id, protectedUserId } },
      create: { restrictedUserId: req.params.id, protectedUserId, reason },
      update: { reason, liftedAt: null },
    });
    res.json({ success: true, message: 'User restricted from messaging this person.' });
  } catch (err) { next(err); }
});

// ─── PATCH /admin/users/:id/unrestrict ────────────────────────────────────────
router.patch('/users/:id/unrestrict', validateUuidParam('id'), writeRateLimiter, async (req, res: Response, next: NextFunction) => {
  try {
    const { protectedUserId } = unrestrictSchema.parse(req.body);
    const restriction = await prisma.userMessageRestriction.findUnique({
      where: { restrictedUserId_protectedUserId: { restrictedUserId: req.params.id, protectedUserId } },
    });
    if (!restriction || restriction.liftedAt) throw new AppError('No active restriction found for this pair.', 404);

    await prisma.userMessageRestriction.update({
      where: { restrictedUserId_protectedUserId: { restrictedUserId: req.params.id, protectedUserId } },
      data: { liftedAt: new Date() },
    });
    res.json({ success: true, message: 'Restriction removed.' });
  } catch (err) { next(err); }
});

// ─── PATCH /admin/users/:id/role ─────────────────────────────────────────────
router.patch('/users/:id/role', validateUuidParam('id'), requireRole(UserRole.ADMIN), writeRateLimiter, async (req, res: Response, next: NextFunction) => {
  try {
    const { role } = roleSchema.parse(req.body);
    await prisma.user.update({ where: { id: req.params.id }, data: { role } });
    res.json({ success: true, message: 'Role updated.' });
  } catch (err) { next(err); }
});

// ─── DELETE /admin/users/:id — permanent account deletion ─────────────────────
// ADMIN-only (escalated like /ban) and intentionally different from Ban:
// Ban is reversible suspension that keeps the row/email/identity intact so
// it can be undone; this permanently removes the User row so the account
// no longer exists at all, and its email becomes available for a brand
// new signup -- a fresh row with a fresh id, carrying zero ownership of or
// connection to anything below. Distinct from (and does not touch) the
// existing self-service DELETE /users/me, which deliberately anonymizes
// in place rather than deleting the row (see that route's own comment for
// why); this is the one true hard-delete path, reserved for ADMIN.
//
// Order matters:
//  1. Soft-remove every listing this user owns from public visibility
//     first (the same status: REMOVED / isActive: false the self-service
//     flow already uses) in the same transaction as the row delete --
//     belt-and-suspenders alongside Listing.userId now being SET NULL, so
//     a listing is never even momentarily public-looking with no owner.
//  2. Delete the User row. Prisma-cascaded children (SavedListing,
//     Notification, UserMessageRestriction in both directions) go with
//     it -- all purely private/operational state, nothing worth
//     preserving once the account is gone. Every other reference
//     (Listing.userId, Message.senderId, Report.reporterId, and the
//     pre-existing Report.reportedUserId/listingId/messageId) is SET
//     NULL rather than cascaded, so listings, message history, and
//     reports all survive with the deleted identity detached -- read as
//     "Deleted user" on the client, the same label the self-service
//     delete flow's anonymized name already uses.
//  3. Force-disconnect any live Socket.IO session and best-effort delete
//     their avatar's S3/R2 object -- after the row delete, so a
//     concurrent request racing this one already gets the normal
//     "account not found" 401 from authenticate() rather than briefly
//     succeeding against a row that's about to disappear.
router.delete('/users/:id', validateUuidParam('id'), requireRole(UserRole.ADMIN), writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reason } = permanentDeleteSchema.parse(req.body);

    if (req.params.id === req.user!.id) {
      throw new AppError('You cannot permanently delete your own account.', 400);
    }

    const user = await prisma.user.findUnique({
      where:  { id: req.params.id },
      select: { id: true, email: true, avatarKey: true },
    });
    if (!user) throw new AppError('User not found.', 404);

    await prisma.$transaction([
      prisma.listing.updateMany({
        where: { userId: req.params.id, status: { not: ListingStatus.REMOVED } },
        data:  { status: ListingStatus.REMOVED, isActive: false },
      }),
      prisma.user.delete({ where: { id: req.params.id } }),
    ]);

    req.app.get('io')?.in(`user:${req.params.id}`).disconnectSockets(true);

    if (s3 && user.avatarKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET!, Key: user.avatarKey }));
      } catch (e) {
        logger.warn(`Failed to delete S3 avatar object for user ${req.params.id} during permanent account deletion: ${e}`);
      }
    }

    logger.info(`Permanently deleted account ${user.email} (${req.params.id}) by admin ${req.user!.id}. Reason: ${reason}`);

    res.json({ success: true, message: `Account for ${user.email} permanently deleted. That email can be used for a new signup.` });
  } catch (err) { next(err); }
});

// ─── GET /admin/listings ──────────────────────────────────────────────────────
router.get('/listings', async (req, res: Response, next: NextFunction) => {
  try {
    const { status, page } = statusQuerySchema.parse(req.query);
    const where: any = {};
    if (status) where.status = status;

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 25,
        skip: (page - 1) * 25,
        include: {
          user:                { select: { name: true, email: true, isBanned: true } },
          images:              { take: 1 },
          moderationRemovedBy: { select: { name: true, email: true } },
          moderationRestoredBy: { select: { name: true, email: true } },
        },
      }),
      prisma.listing.count({ where }),
    ]);
    res.json({ success: true, data: listings, total });
  } catch (err) { next(err); }
});

// ─── DELETE /admin/listings/:id — remove from public visibility ───────────────
// ADMIN/MODERATOR (router's default gate) -- reversible soft-remove, not a
// destructive delete: sets status -> REMOVED (already excluded from every
// public browse/map/search/detail query, same as an owner's own removal)
// and records who/when/why in the moderationRemoved* fields so Restore can
// tell this apart from a listing hidden for any other reason (owner's own
// delete, account-deletion, or BANNED from /admin/users/:id/ban). Works
// regardless of the listing's current status -- including one currently
// BANNED because its owner is banned -- so a moderator's own removal
// decision survives that owner's later /unban (see /unban's comment: it
// only restores listings still at BANNED, and this moves the listing to
// REMOVED, off that status entirely). Clears any prior restore record so a
// remove -> restore -> remove cycle re-arms restore-eligibility correctly.
router.delete('/listings/:id', validateUuidParam('id'), writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reason } = removeListingSchema.parse(req.body);
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!listing) throw new AppError('Listing not found.', 404);

    await prisma.listing.update({
      where: { id: req.params.id },
      data: {
        status:                   ListingStatus.REMOVED,
        isActive:                 false,
        moderationRemovedAt:      new Date(),
        moderationRemovedById:    req.user!.id,
        moderationRemovalReason:  reason,
        moderationRestoredAt:     null,
        moderationRestoredById:   null,
      },
    });
    res.json({ success: true, message: 'Listing removed.' });
  } catch (err) { next(err); }
});

// ─── PATCH /admin/listings/:id/restore — reverse a moderator removal ──────────
// Only ever reverses this listing's own moderationRemovedAt/By action --
// never a listing hidden by its owner's own delete, by account deletion, or
// currently BANNED for an unrelated (still-active) ban. Eligibility is
// "moderationRemovedAt is set AND moderationRestoredAt is not" (mirrors
// UserMessageRestriction.liftedAt's already-established pattern), so a
// listing that was never moderator-removed, or one already restored since
// its last removal, correctly 400s instead of silently no-op'ing. Also
// blocked while the owner is currently banned -- the founder-specified rule
// so a restore can never undo a ban's own listing-hiding side effect out
// from under it; /unban (or a future moderator removal) is the only way
// forward for that listing after the owner is unbanned.
router.patch('/listings/:id/restore', validateUuidParam('id'), writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.findUnique({
      where:  { id: req.params.id },
      select: { id: true, moderationRemovedAt: true, moderationRestoredAt: true, user: { select: { isBanned: true } } },
    });
    if (!listing) throw new AppError('Listing not found.', 404);
    if (!listing.moderationRemovedAt || listing.moderationRestoredAt) {
      throw new AppError('This listing was not removed by moderation, so there is nothing to restore.', 400);
    }
    // `listing.user` is null when the owner's account has since been
    // permanently deleted (Listing.userId nulled by ADMIN account
    // deletion) -- there's no one to restore a public listing to, so that
    // blocks restore exactly like a currently-banned owner does.
    if (!listing.user || listing.user.isBanned) {
      throw new AppError('Cannot restore this listing while its owner is banned or no longer has an account.', 400);
    }

    await prisma.listing.update({
      where: { id: req.params.id },
      data: {
        status:                 ListingStatus.ACTIVE,
        isActive:               true,
        moderationRestoredAt:   new Date(),
        moderationRestoredById: req.user!.id,
      },
    });
    res.json({ success: true, message: 'Listing restored.' });
  } catch (err) { next(err); }
});

// ─── GET /admin/reports ───────────────────────────────────────────────────────
// Branches on targetType so moderators get the right review context per
// kind of report instead of every report being rendered as if it were a
// listing report:
//  - LISTING: the reported listing (unchanged from before this feature).
//  - USER: the reported user's identity + restriction history (isBanned/
//    banReason), plus the *reporter's* own filed/dismissed report counts so
//    a moderator can spot a retaliatory or bad-faith report pattern
//    (Trust & Safety review, 2026-09-01). `qualifyingInteraction` (a plain
//    scalar enum string, included by default via the `...r` spread below --
//    no explicit select needed) shows which prior-interaction path the
//    reporter actually had with the target when they filed the report; the
//    admin UI compares this string directly (no nested object), so keep
//    both sides in sync if this contract ever changes.
//  - MESSAGE: the sender's identity, the derived `recipient` (the other
//    conversation participant, not the sender), the message's own
//    createdAt, the frozen messageSnapshot (not a live lookup -- the
//    message may have since been edited/deleted), and the conversation id
//    to link into the live thread for surrounding context.
router.get('/reports', async (req, res: Response, next: NextFunction) => {
  try {
    const { status } = z.object({ status: z.nativeEnum(ReportStatus).optional() }).parse(req.query);
    const reports = await prisma.report.findMany({
      where:   status ? { status } : { status: 'PENDING' },
      include: {
        reporter:     { select: { id: true, name: true, email: true } },
        listing:      {
          select: {
            id: true, title: true, status: true,
            moderationRemovedAt: true, moderationRestoredAt: true, moderationRemovalReason: true,
            moderationRemovedBy: { select: { name: true } },
            user: { select: { isBanned: true } },
          },
        },
        reportedUser: { select: { id: true, name: true, email: true, isBanned: true, banReason: true, createdAt: true } },
        message:      {
          select: {
            id: true,
            conversationId: true,
            createdAt: true,
            sender: { select: { id: true, name: true, email: true } },
            conversation: {
              select: {
                participants: { select: { userId: true, user: { select: { id: true, name: true, email: true } } } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Reporter report-history stats (filed / dismissed-against-them), keyed
    // by reporterId -- surfaced only for USER-type reports below, but cheap
    // enough to compute once for the whole page. A permanently-deleted
    // reporter (reporterId nulled by ADMIN account deletion) has no history
    // to look up -- filtered out here rather than passed through as null.
    const reporterIds = [...new Set(reports.map(r => r.reporterId).filter((id): id is string => id !== null))];
    const statCounts = reporterIds.length
      ? await prisma.report.groupBy({
          by: ['reporterId', 'status'],
          where: { reporterId: { in: reporterIds } },
          _count: { _all: true },
        })
      : [];
    const reporterStats = new Map<string, { totalFiled: number; dismissed: number }>();
    for (const id of reporterIds) reporterStats.set(id, { totalFiled: 0, dismissed: 0 });
    for (const row of statCounts) {
      if (!row.reporterId) continue;
      const stat = reporterStats.get(row.reporterId)!;
      stat.totalFiled += row._count._all;
      if (row.status === ReportStatus.DISMISSED) stat.dismissed += row._count._all;
    }

    // Active message-restriction lookup, keyed `restrictedUserId:protectedUserId`
    // -- surfaced on any report that names a reportedUser (USER and MESSAGE
    // reports both do) so the admin UI can show the reported user's current
    // moderation state and choose Restrict vs. Unrestrict correctly. A
    // permanently-deleted reporter can't hold an active restriction (there's
    // no one left to protect), so those reports are excluded here too.
    const restrictionPairs = reports
      .filter(r => r.reportedUserId && r.reporterId)
      .map(r => ({ restrictedUserId: r.reportedUserId!, protectedUserId: r.reporterId! }));
    const restrictions = restrictionPairs.length
      ? await prisma.userMessageRestriction.findMany({
          where: { OR: restrictionPairs, liftedAt: null },
        })
      : [];
    const restrictionMap = new Map(restrictions.map(res => [`${res.restrictedUserId}:${res.protectedUserId}`, res]));

    const data = reports.map(r => {
      // Strip the raw nested conversation/participants payload regardless of
      // targetType -- it's only ever an intermediate for deriving `recipient`
      // below, not something the admin UI should receive directly.
      const { conversation, ...message } = r.message ?? {};
      const recipient = conversation?.participants.find(p => p.userId !== r.message?.sender?.id)?.user ?? null;
      const restriction = r.reportedUserId && r.reporterId ? restrictionMap.get(`${r.reportedUserId}:${r.reporterId}`) ?? null : null;
      return {
        ...r,
        message: r.message ? message : r.message,
        ...(r.targetType === 'MESSAGE' && { recipient }),
        ...(r.targetType === 'USER' && { reporterHistory: r.reporterId ? reporterStats.get(r.reporterId) : undefined }),
        ...(r.reportedUserId && { restriction: restriction && { reason: restriction.reason, createdAt: restriction.createdAt } }),
      };
    });

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ─── PATCH /admin/reports/:id ─────────────────────────────────────────────────
router.patch('/reports/:id', validateUuidParam('id'), writeRateLimiter, async (req, res: Response, next: NextFunction) => {
  try {
    const { status, resolution, retentionHold, retentionHoldReason } = reportUpdateSchema.parse(req.body);

    const existing = await prisma.report.findUnique({ where: { id: req.params.id }, select: { status: true } });
    if (!existing) throw new AppError('Report not found.', 404);

    const data: { status?: ReportStatus; resolution?: string; resolvedAt?: Date; retentionHold?: boolean; retentionHoldReason?: string } = {};
    if (status !== undefined) {
      data.status = status;
      // Only (re)start the 90-day messageSnapshot retention clock the
      // first time a report actually transitions into a terminal state --
      // never on a PATCH that resends the same status it's already in
      // (e.g. a hold-only toggle that happens to also include status).
      // The old unconditional `resolvedAt: new Date()` on every PATCH
      // would otherwise silently push the retention clock forward
      // indefinitely on any incidental future update.
      const isTerminal = status === ReportStatus.RESOLVED || status === ReportStatus.DISMISSED;
      if (isTerminal && existing.status !== status) data.resolvedAt = new Date();
    }
    if (resolution !== undefined) data.resolution = resolution;
    if (retentionHold !== undefined) data.retentionHold = retentionHold;
    if (retentionHoldReason !== undefined) data.retentionHoldReason = retentionHoldReason;

    await prisma.report.update({ where: { id: req.params.id }, data });
    res.json({ success: true, message: 'Report updated.' });
  } catch (err) { next(err); }
});

export default router;
