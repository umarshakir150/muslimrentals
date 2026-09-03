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
import { prisma } from '../prisma/client';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { UserRole, ListingStatus, ReportStatus } from '@prisma/client';
import { validateUuidParam } from '../middleware/validateUuid';
import { adminRateLimiter, writeRateLimiter } from '../middleware/rateLimiter';

const router = Router();

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

// ─── GET /admin/users ─────────────────────────────────────────────────────────
router.get('/users', async (req, res: Response, next: NextFunction) => {
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
        include: { user: { select: { name: true, email: true } }, images: { take: 1 } },
      }),
      prisma.listing.count({ where }),
    ]);
    res.json({ success: true, data: listings, total });
  } catch (err) { next(err); }
});

// ─── DELETE /admin/listings/:id ───────────────────────────────────────────────
router.delete('/listings/:id', validateUuidParam('id'), writeRateLimiter, async (req, res: Response, next: NextFunction) => {
  try {
    await prisma.listing.update({
      where: { id: req.params.id },
      data: { status: ListingStatus.REMOVED, isActive: false },
    });
    res.json({ success: true, message: 'Listing removed.' });
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
//    (Trust & Safety review, 2026-09-01).
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
        listing:      { select: { id: true, title: true } },
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
    // enough to compute once for the whole page.
    const reporterIds = [...new Set(reports.map(r => r.reporterId))];
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
      const stat = reporterStats.get(row.reporterId)!;
      stat.totalFiled += row._count._all;
      if (row.status === ReportStatus.DISMISSED) stat.dismissed += row._count._all;
    }

    // Active message-restriction lookup, keyed `restrictedUserId:protectedUserId`
    // -- surfaced on any report that names a reportedUser (USER and MESSAGE
    // reports both do) so the admin UI can show the reported user's current
    // moderation state and choose Restrict vs. Unrestrict correctly.
    const restrictionPairs = reports
      .filter(r => r.reportedUserId)
      .map(r => ({ restrictedUserId: r.reportedUserId!, protectedUserId: r.reporterId }));
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
      const recipient = conversation?.participants.find(p => p.userId !== r.message?.sender.id)?.user ?? null;
      const restriction = r.reportedUserId ? restrictionMap.get(`${r.reportedUserId}:${r.reporterId}`) ?? null : null;
      return {
        ...r,
        message: r.message ? message : r.message,
        ...(r.targetType === 'MESSAGE' && { recipient }),
        ...(r.targetType === 'USER' && { reporterHistory: reporterStats.get(r.reporterId) }),
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
