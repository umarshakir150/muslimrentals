/**
 * Users routes
 * OWASP A01 – Broken Access Control / A03 – Injection
 *
 * Security measures:
 *  - /me routes require authentication
 *  - Public profile (:id) only exposes safe fields
 *  - UUID validated on :id param
 *  - .strict() schemas reject extra fields
 *  - writeRateLimiter on mutations
 */
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { ListingStatus } from '@prisma/client';
import { prisma } from '../prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validateUuidParam } from '../middleware/validateUuid';
import { writeRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// ─── Input schemas ────────────────────────────────────────────────────────────

const updateProfileSchema = z.object({
  name:  z.string().min(2).max(80).trim().optional(),
  phone: z.string().max(20).trim().optional(),
  bio:   z.string().max(500).trim().optional(),
}).strict();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword:     z.string().min(8).max(128),
}).strict();

// ─── GET /users/:id — public profile ─────────────────────────────────────────
router.get('/:id', validateUuidParam('id'), async (req, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      // OWASP A01: only expose safe public fields — never email, phone, or passwordHash
      select: {
        id: true, name: true, avatarUrl: true, bio: true, createdAt: true,
        listings: {
          where:   { status: 'ACTIVE' },
          include: { images: { take: 1 } },
          orderBy: { createdAt: 'desc' },
          take: 12,
        },
      },
    });
    if (!user) throw new AppError('User not found.', 404);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

// ─── PATCH /users/me — update profile ─────────────────────────────────────────
router.patch('/me', authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = updateProfileSchema.parse(req.body);

    const user = await prisma.user.update({
      where:  { id: req.user!.id },
      data,
      select: { id: true, name: true, email: true, phone: true, bio: true, avatarUrl: true, role: true },
    });

    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

// ─── POST /users/me/change-password ───────────────────────────────────────────
router.post('/me/change-password', authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where:  { id: req.user!.id },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash) throw new AppError('No password set (Google account).', 400);

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError('Current password is incorrect.', 400);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash } });

    res.json({ success: true, message: 'Password updated.' });
  } catch (err) { next(err); }
});

// ─── GET /users/me/saved ──────────────────────────────────────────────────────
router.get('/me/saved', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const saved = await prisma.savedListing.findMany({
      where:   { userId: req.user!.id, listing: { status: { not: ListingStatus.REMOVED } } },
      include: {
        listing: {
          include: {
            images:     { take: 1 },
            amenities:  { select: { name: true } },
            user:       { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({
      success: true,
      data: saved.map(s => ({
        ...s.listing,
        amenities: s.listing.amenities.map(a => a.name),
        thumbnailUrl: s.listing.images[0]?.url || null,
        isSaved: true,
      })),
    });
  } catch (err) { next(err); }
});

// ─── GET /users/me/listings ───────────────────────────────────────────────────
router.get('/me/listings', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listings = await prisma.listing.findMany({
      where:   { userId: req.user!.id },
      include: { images: { take: 1 }, amenities: { select: { name: true } }, _count: { select: { savedBy: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: listings });
  } catch (err) { next(err); }
});

// ─── GET /users/me/notifications ─────────────────────────────────────────────
router.get('/me/notifications', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const notifs = await prisma.notification.findMany({
      where:   { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: notifs });
  } catch (err) { next(err); }
});

export default router;
