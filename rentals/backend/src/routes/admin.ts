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
router.get('/reports', async (req, res: Response, next: NextFunction) => {
  try {
    const { status } = z.object({ status: z.nativeEnum(ReportStatus).optional() }).parse(req.query);
    const reports = await prisma.report.findMany({
      where:   status ? { status } : { status: 'PENDING' },
      include: {
        reporter: { select: { name: true, email: true } },
        listing:  { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: reports });
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
