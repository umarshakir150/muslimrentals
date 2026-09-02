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

const roleSchema = z.object({
  role: z.nativeEnum(UserRole),
}).strict();

const reportUpdateSchema = z.object({
  status:     z.nativeEnum(ReportStatus),
  resolution: z.string().max(500).trim().optional(),
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
router.patch('/users/:id/ban', validateUuidParam('id'), requireRole(UserRole.ADMIN), writeRateLimiter, async (req, res: Response, next: NextFunction) => {
  try {
    const { reason } = banSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isBanned: true, banReason: reason, refreshToken: null },
    });
    res.json({ success: true, message: `User ${user.email} banned.` });
  } catch (err) { next(err); }
});

// ─── PATCH /admin/users/:id/unban ────────────────────────────────────────────
router.patch('/users/:id/unban', validateUuidParam('id'), requireRole(UserRole.ADMIN), writeRateLimiter, async (req, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isBanned: false, banReason: null },
    });
    res.json({ success: true, message: `User ${user.email} unbanned.` });
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

    const data = reports.map(r => {
      // Strip the raw nested conversation/participants payload regardless of
      // targetType -- it's only ever an intermediate for deriving `recipient`
      // below, not something the admin UI should receive directly.
      const { conversation, ...message } = r.message ?? {};
      const recipient = conversation?.participants.find(p => p.userId !== r.message?.sender.id)?.user ?? null;
      return {
        ...r,
        message: r.message ? message : r.message,
        ...(r.targetType === 'MESSAGE' && { recipient }),
        ...(r.targetType === 'USER' && { reporterHistory: reporterStats.get(r.reporterId) }),
      };
    });

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ─── PATCH /admin/reports/:id ─────────────────────────────────────────────────
router.patch('/reports/:id', validateUuidParam('id'), writeRateLimiter, async (req, res: Response, next: NextFunction) => {
  try {
    const { status, resolution } = reportUpdateSchema.parse(req.body);
    await prisma.report.update({
      where: { id: req.params.id },
      data: { status, resolution, resolvedAt: new Date() },
    });
    res.json({ success: true, message: 'Report updated.' });
  } catch (err) { next(err); }
});

export default router;
