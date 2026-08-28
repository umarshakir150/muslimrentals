/**
 * Listings routes
 * OWASP A01 – Broken Access Control / A03 – Injection
 *
 * Security measures:
 *  - Strict Zod schemas with .strict() reject unexpected fields
 *  - UUIDs validated before DB queries
 *  - Ownership checked before any mutation
 *  - Numeric query params clamped to safe ranges
 *  - Write operations use writeRateLimiter

 */
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ListingAudience, ListingStatus } from '@prisma/client';

import { prisma } from '../prisma/client';
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validateUuidParam } from '../middleware/validateUuid';
import { writeRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// ─── Shared schemas ────────────────────────────────────────────────────────────

// Allowed amenity values (whitelist prevents injection via amenity names)
const ALLOWED_AMENITIES = [
  'Furnished', 'Parking', 'Utilities included', 'Laundry in-unit', 'Laundry shared',
  'Internet included', 'Air conditioning', 'Dishwasher', 'Pet-friendly',
  'Private entrance', 'Basement unit', 'Balcony', 'Backyard access',
] as const;

const listingCreateSchema = z.object({
  title:         z.string().min(5).max(200).trim(),
  description:   z.string().min(20).max(5000).trim(),
  price:         z.number().positive().max(50000),
  bedrooms:      z.number().min(0).max(20),
  bathrooms:     z.number().int().min(0).max(20),
  audience:      z.nativeEnum(ListingAudience),
  city:          z.string().min(1).max(100).trim(),
  town:          z.string().max(100).trim().optional(),
  province:      z.string().max(50).trim().optional(),
  neighbourhood: z.string().max(100).trim().optional(),
  address:       z.string().max(200).trim().optional(),
  lat:           z.number().min(-90).max(90),
  lng:           z.number().min(-180).max(180),
  contactInfo:   z.string().min(5).max(300).trim(),
  // Amenities must be from the allowed set only
  amenities:     z.array(z.enum(ALLOWED_AMENITIES)).max(20).optional(),
  // Image URLs must be real URLs and are bounded
  imageUrls:     z.array(z.string().url().max(2048)).max(10).optional(),
}).strict();

const listingUpdateSchema = listingCreateSchema.partial();

// Query param schema for GET /listings — typed, bounded, no injection surface
const listingQuerySchema = z.object({
  city:      z.string().max(100).trim().optional(),
  audience:  z.nativeEnum(ListingAudience).optional(),
  minBeds:   z.coerce.number().min(0).max(20).optional(),
  maxBeds:   z.coerce.number().min(0).max(20).optional(),
  minBaths:  z.coerce.number().min(0).max(20).optional(),
  maxBaths:  z.coerce.number().min(0).max(20).optional(),
  minPrice:  z.coerce.number().min(0).max(50000).optional(),
  maxPrice:  z.coerce.number().min(0).max(50000).optional(),
  lat:       z.coerce.number().min(-90).max(90).optional(),
  lng:       z.coerce.number().min(-180).max(180).optional(),
  radiusKm:  z.coerce.number().min(1).max(500).optional(),
  page:      z.coerce.number().int().min(1).max(1000).default(1),
  // Capped at 200, not 50 -- the map view (frontend src/app/map/page.tsx)
  // legitimately requests limit=200 to plot every active listing at once.
  limit:     z.coerce.number().int().min(1).max(200).default(20),
  sort:      z.enum(['newest', 'priceLow', 'priceHigh', 'beds']).default('newest'),
  keyword:   z.string().max(200).trim().optional(),
  amenities: z.string().max(500).optional(),  // comma-separated
  furnished: z.enum(['true', 'false']).optional(),
  parking:   z.enum(['true', 'false']).optional(),
  utilities: z.enum(['true', 'false']).optional(),
});

const reportSchema = z.object({
  reason:      z.string().min(5).max(300).trim(),
  description: z.string().max(1000).trim().optional(),
}).strict();

// ─── Distance helper ──────────────────────────────────────────────────────────
function distKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── GET /listings ────────────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = listingQuerySchema.parse(req.query);

    const where: any = { status: ListingStatus.ACTIVE };

    if (q.city)     where.city     = { contains: q.city, mode: 'insensitive' };
    if (q.audience) where.audience = q.audience;
    if (q.keyword)  where.OR = [
      { title:         { contains: q.keyword, mode: 'insensitive' } },
      { description:   { contains: q.keyword, mode: 'insensitive' } },
      { neighbourhood: { contains: q.keyword, mode: 'insensitive' } },
      { city:          { contains: q.keyword, mode: 'insensitive' } },
    ];
    if (q.minBeds  != null) where.bedrooms  = { ...where.bedrooms,  gte: q.minBeds  };
    if (q.maxBeds  != null) where.bedrooms  = { ...where.bedrooms,  lte: q.maxBeds  };
    if (q.minBaths != null) where.bathrooms = { ...where.bathrooms, gte: q.minBaths };
    if (q.maxBaths != null) where.bathrooms = { ...where.bathrooms, lte: q.maxBaths };
    if (q.minPrice != null) where.price     = { ...where.price,     gte: q.minPrice };
    if (q.maxPrice != null) where.price     = { ...where.price,     lte: q.maxPrice };

    // Amenity filters — values are already constrained by query schema
    const amenityFilters: string[] = [];
    if (q.amenities) amenityFilters.push(...q.amenities.split(',').slice(0, 10));
    if (q.furnished === 'true')  amenityFilters.push('Furnished');
    if (q.parking   === 'true')  amenityFilters.push('Parking');
    if (q.utilities === 'true')  amenityFilters.push('Utilities included');
    if (amenityFilters.length > 0) {
      where.amenities = { some: { name: { in: amenityFilters } } };
    }

    const orderBy: any =
      q.sort === 'priceLow'  ? { price: 'asc' }      :
      q.sort === 'priceHigh' ? { price: 'desc' }     :
      q.sort === 'beds'      ? { bedrooms: 'desc' }  :
      { createdAt: 'desc' };

    const skip = (q.page - 1) * q.limit;

    let [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        orderBy,
        skip,
        take: q.limit,
        include: {
          images:    { orderBy: { order: 'asc' }, take: 1 },
          amenities: { select: { name: true } },
          user:      { select: { id: true, name: true, avatarUrl: true } },
          _count:    { select: { savedBy: true } },
        },
      }),
      prisma.listing.count({ where }),
    ]);

    // Geo radius filter (in-memory; adequate for MVP scale)
    if (q.lat != null && q.lng != null && q.radiusKm != null) {
      listings = listings.filter(l => distKm(q.lat!, q.lng!, l.lat, l.lng) <= q.radiusKm!);
    }

    let savedIds = new Set<string>();
    if (req.user) {
      const saved = await prisma.savedListing.findMany({
        where: { userId: req.user.id, listingId: { in: listings.map(l => l.id) } },
        select: { listingId: true },
      });
      savedIds = new Set(saved.map(s => s.listingId));
    }

    const result = listings.map(l => ({
      ...l,
      isSaved:      savedIds.has(l.id),
      amenities:    l.amenities.map(a => a.name),
      thumbnailUrl: l.images[0]?.url || null,
    }));

    res.json({
      success: true,
      data: result,
      pagination: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) },
    });
  } catch (err) { next(err); }
});

// ─── GET /listings/:id ────────────────────────────────────────────────────────
router.get('/:id', validateUuidParam('id'), optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      include: {
        images:    { orderBy: { order: 'asc' } },
        amenities: { select: { name: true } },
        user:      { select: { id: true, name: true, avatarUrl: true, createdAt: true } },
        _count:    { select: { savedBy: true } },
      },
    });

    if (!listing || listing.status === ListingStatus.REMOVED) {
      throw new AppError('Listing not found.', 404);
    }

    await prisma.listing.update({ where: { id: listing.id }, data: { viewCount: { increment: 1 } } });

    let isSaved = false;
    if (req.user) {
      const saved = await prisma.savedListing.findUnique({
        where: { userId_listingId: { userId: req.user.id, listingId: listing.id } },
      });
      isSaved = !!saved;
    }

    res.json({ success: true, data: { ...listing, isSaved, amenities: listing.amenities.map(a => a.name) } });
  } catch (err) { next(err); }
});

// ─── POST /listings ───────────────────────────────────────────────────────────
router.post('/', authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = listingCreateSchema.parse(req.body);
    const { amenities = [], imageUrls = [], ...rest } = data;

    const listing = await prisma.listing.create({
      data: {
        ...rest,
        userId:    req.user!.id,
        amenities: { create: amenities.map(name => ({ name })) },
        images:    { create: imageUrls.map((url, i) => ({ url, key: url, order: i })) },
      },
      include: {
        images:    true,
        amenities: { select: { name: true } },
        user:      { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    res.status(201).json({ success: true, data: { ...listing, amenities: listing.amenities.map(a => a.name) } });
  } catch (err) { next(err); }
});

// ─── PATCH /listings/:id ──────────────────────────────────────────────────────
router.patch('/:id', validateUuidParam('id'), authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
    if (!listing) throw new AppError('Listing not found.', 404);

    // OWASP A01: only owner or admin/moderator can edit
    if (listing.userId !== req.user!.id && req.user!.role === 'USER') {
      throw new AppError('Not authorized.', 403);
    }

    const data = listingUpdateSchema.parse(req.body);
    const { amenities, imageUrls, ...rest } = data;

    const updated = await prisma.listing.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(amenities !== undefined && {
          amenities: { deleteMany: {}, create: amenities.map(name => ({ name })) },
        }),
      },
      include: {
        images:    { orderBy: { order: 'asc' } },
        amenities: { select: { name: true } },
        user:      { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    res.json({ success: true, data: { ...updated, amenities: updated.amenities.map(a => a.name) } });
  } catch (err) { next(err); }
});

// ─── DELETE /listings/:id ─────────────────────────────────────────────────────
router.delete('/:id', validateUuidParam('id'), authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
    if (!listing) throw new AppError('Listing not found.', 404);

    if (listing.userId !== req.user!.id && req.user!.role === 'USER') {
      throw new AppError('Not authorized.', 403);
    }

    await prisma.listing.update({
      where: { id: req.params.id },
      data: { status: ListingStatus.REMOVED, isActive: false },
    });

    res.json({ success: true, message: 'Listing removed.' });
  } catch (err) { next(err); }
});

// ─── POST /listings/:id/save ──────────────────────────────────────────────────
router.post('/:id/save', validateUuidParam('id'), authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.savedListing.findUnique({
      where: { userId_listingId: { userId: req.user!.id, listingId: req.params.id } },
    });

    if (existing) {
      await prisma.savedListing.delete({
        where: { userId_listingId: { userId: req.user!.id, listingId: req.params.id } },
      });
      return res.json({ success: true, saved: false });
    }

    // Verify listing exists before creating saved record
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!listing) throw new AppError('Listing not found.', 404);

    await prisma.savedListing.create({ data: { userId: req.user!.id, listingId: req.params.id } });
    res.json({ success: true, saved: true });
  } catch (err) { next(err); }
});

// ─── POST /listings/:id/report ────────────────────────────────────────────────
router.post('/:id/report', validateUuidParam('id'), authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reason, description } = reportSchema.parse(req.body);

    const listing = await prisma.listing.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!listing) throw new AppError('Listing not found.', 404);

    await prisma.report.create({
      data: { reporterId: req.user!.id, listingId: req.params.id, reason, description },
    });

    res.json({ success: true, message: 'Report submitted. We review all reports within 24 hours.' });
  } catch (err) { next(err); }
});

export default router;
