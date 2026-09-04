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
import { ListingStatus } from '@prisma/client';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

import { prisma } from '../prisma/client';
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validateUuidParam } from '../middleware/validateUuid';
import { writeRateLimiter } from '../middleware/rateLimiter';
import { distKm, getApproximateLocation, toPublicListingLocation } from '../utils/geo';
import { geocodeAddress, MAX_PIN_CORRECTION_METERS } from '../utils/geocode';
import { logger } from '../utils/logger';
import {
  listingCreateSchema,
  listingUpdateSchema,
  listingQuerySchema,
  reportSchema,
  applyRangeFilters,
} from '../validation/listingSchemas';

// S3 is optional-with-warning, same guard as uploads.ts — this route must
// still work (DB rows are the source of truth) even if AWS isn't configured,
// it just skips the best-effort object cleanup in that case.
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

const router = Router();

// ─── Universal confirm-property-location flow ──────────────────────────────
// Every new or address-changing listing requires the landlord to confirm
// (or drag) a pin before its exact private coordinate is ever stored --
// regardless of geocodeAddress's `confidence` for the match. geocodeAddress
// still finds the best available STARTING point (a 'precise' house-level
// match makes for a better starting pin than a 'street'-level one, but
// either way the landlord confirms it): nothing is created/updated until
// a confirmed pin is submitted, and even then it's validated against the
// geocoder's own matched point (see MAX_PIN_CORRECTION_METERS) rather than
// trusted outright.
//
// Shared by POST / (create) and PATCH /:id (edit) -- both need identical
// behavior here (see CLAUDE.md's product-consistency expectations), so this
// is the one place that decides it.
type LocationResolution =
  | { kind: 'resolved'; lat: number; lng: number }
  | { kind: 'needsConfirmation'; matchedLat: number; matchedLng: number };

function resolveGeocodedLocation(
  geocoded: { lat: number; lng: number },
  confirmedLat: number | undefined,
  confirmedLng: number | undefined
): LocationResolution {
  if (confirmedLat === undefined || confirmedLng === undefined) {
    return { kind: 'needsConfirmation', matchedLat: geocoded.lat, matchedLng: geocoded.lng };
  }

  // Never trust the confirmed pin outright -- validate it's actually near
  // the point the geocoder matched (see MAX_PIN_CORRECTION_METERS), so
  // submitting an address on one street/city and manually placing the pin
  // somewhere unrelated is rejected rather than silently stored.
  const correctionMeters = distKm(geocoded.lat, geocoded.lng, confirmedLat, confirmedLng) * 1000;
  if (correctionMeters > MAX_PIN_CORRECTION_METERS) {
    throw new AppError(
      `That pin is too far from the address we matched (about ${Math.round(correctionMeters)}m away; the maximum is ${MAX_PIN_CORRECTION_METERS}m). Please move it closer to the property's actual location.`,
      422
    );
  }

  return { kind: 'resolved', lat: confirmedLat, lng: confirmedLng };
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
    Object.assign(where, applyRangeFilters(where, q));

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

    // Geo radius filter (in-memory; adequate for MVP scale). Deliberately
    // filters against each listing's PUBLIC approximate point (the exact
    // same one toPublicListingLocation returns below), never the real
    // precise coordinate -- filtering on the real point would let a
    // motivated searcher binary-search increasingly small radii around a
    // suspected address to localize a listing far more precisely than the
    // stated privacy radius promises. Using the same deterministic
    // approximate point here means the result set a renter sees always
    // matches what they'd expect from the circle drawn on the map, too.
    if (q.lat != null && q.lng != null && q.radiusKm != null) {
      listings = listings.filter(l => {
        const approx = getApproximateLocation(l.id, l.lat, l.lng);
        return distKm(q.lat!, q.lng!, approx.lat, approx.lng) <= q.radiusKm!;
      });
    }

    let savedIds = new Set<string>();
    if (req.user) {
      const saved = await prisma.savedListing.findMany({
        where: { userId: req.user.id, listingId: { in: listings.map(l => l.id) } },
        select: { listingId: true },
      });
      savedIds = new Set(saved.map(s => s.listingId));
    }

    // Public browse/search/map results never carry a listing's real
    // address or precise coordinates -- see utils/geo.ts's
    // toPublicListingLocation for what "approximate" means here.
    const result = listings.map(l => ({
      ...toPublicListingLocation(l),
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

    if (!listing || listing.status === ListingStatus.REMOVED || listing.status === ListingStatus.BANNED) {
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

    // The owner (viewing their own listing) and staff (moderation context)
    // see the real address/coordinates; every other viewer -- including an
    // unauthenticated one -- gets the same privacy-safe approximate
    // location the public browse/map results already use.
    const isOwnerOrStaff = !!req.user && (req.user.id === listing.userId || req.user.role !== 'USER');
    const locationSafeListing = isOwnerOrStaff ? listing : toPublicListingLocation(listing);

    res.json({ success: true, data: { ...locationSafeListing, isSaved, amenities: listing.amenities.map(a => a.name) } });
  } catch (err) { next(err); }
});

// ─── POST /listings ───────────────────────────────────────────────────────────
// Location pipeline (NEW shape): real address -> geocode (server-side,
// never trusts a client-supplied coordinate) -> precise private lat/lng,
// stored here. Public reads later run these through
// toPublicListingLocation() for the privacy-safe approximate point -- this
// route only ever deals with the real, precise one.
//
// The LEGACY shape (neighbourhood + client lat/lng) is accepted
// transitionally -- see the comment on legacyListingCreateSchema in
// listingSchemas.ts for exactly why and when to delete this branch.
router.post('/', authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = listingCreateSchema.parse(req.body);
    const amenities = data.amenities ?? [];
    const imageUrls = data.imageUrls ?? [];
    const common = {
      title:       data.title,
      description: data.description,
      price:       data.price,
      bedrooms:    data.bedrooms,
      bathrooms:   data.bathrooms,
      audience:    data.audience,
      city:        data.city,
      town:        data.town,
      province:    data.province,
      contactInfo: data.contactInfo,
    };

    let location: { address?: string; unit?: string; neighbourhood?: string; lat: number; lng: number };
    if ('address' in data) {
      const geocoded = await geocodeAddress(data.address, data.city, data.province, { requirePreciseMatch: true });
      if (!geocoded) {
        throw new AppError('We couldn\'t verify that exact address. Please check the street number and spelling and try again.', 422);
      }

      const resolution = resolveGeocodedLocation(geocoded, data.confirmedLat, data.confirmedLng);
      if (resolution.kind === 'needsConfirmation') {
        // Nothing is created yet -- the landlord must confirm the pin first
        // (see resolveGeocodedLocation above). The client resubmits this
        // same POST with confirmedLat/confirmedLng added once they do.
        return res.status(200).json({
          success: true,
          needsLocationConfirmation: true,
          data: { matchedLat: resolution.matchedLat, matchedLng: resolution.matchedLng },
        });
      }

      location = { address: data.address, unit: data.unit, lat: resolution.lat, lng: resolution.lng };
    } else {
      // Transitional legacy path -- see listingSchemas.ts.
      location = { neighbourhood: data.neighbourhood, lat: data.lat, lng: data.lng };
    }

    const listing = await prisma.listing.create({
      data: {
        ...common,
        ...location,
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

    // confirmedLat/confirmedLng only exist on the NEW shape (see
    // listingSchemas.ts) and are never Listing table columns -- pulled out
    // here for the location-confirmation flow below, then stripped from
    // `rest` before it's spread into the Prisma update so an unknown-field
    // error is never possible.
    const confirmedLat: number | undefined = (rest as any).confirmedLat;
    const confirmedLng: number | undefined = (rest as any).confirmedLng;
    delete (rest as any).confirmedLat;
    delete (rest as any).confirmedLng;

    // Which of the two shapes (see listingSchemas.ts) this particular PATCH
    // is using, if either -- a request touching neither is common (e.g.
    // editing only price/title) and needs no location handling at all.
    // Checked with inline `in` narrowing (not a hoisted boolean) so
    // TypeScript actually narrows `rest`'s union type within each branch.
    let geocoded: { lat: number; lng: number } | undefined;

    if ('address' in rest && rest.address !== undefined) {
      // Re-geocode only when something that could change the real-world
      // location actually changed -- editing just the unit, price, title,
      // etc. must never trigger (or need) a new geocoding lookup. Comparing
      // against the currently stored values (not just "was address sent")
      // also avoids a needless re-geocode when a client resubmits the same
      // address unchanged.
      const addressChanging  = rest.address  !== listing.address;
      const cityChanging     = rest.city     !== undefined && rest.city     !== listing.city;
      const provinceChanging = rest.province !== undefined && rest.province !== listing.province;
      if (addressChanging || cityChanging || provinceChanging) {
        const nextCity     = rest.city     !== undefined ? rest.city     : listing.city;
        const nextProvince = rest.province !== undefined ? rest.province : listing.province;
        const newGeocoded = await geocodeAddress(rest.address, nextCity, nextProvince, { requirePreciseMatch: true });
        if (!newGeocoded) {
          throw new AppError('We couldn\'t verify that exact address. Please check the street number and spelling and try again.', 422);
        }

        const resolution = resolveGeocodedLocation(newGeocoded, confirmedLat, confirmedLng);
        if (resolution.kind === 'needsConfirmation') {
          // Nothing is applied yet, including any other fields in this same
          // PATCH -- the landlord must confirm the pin first, then resubmit
          // the whole edit with confirmedLat/confirmedLng added, exactly
          // like the POST /listings create flow.
          return res.status(200).json({
            success: true,
            needsLocationConfirmation: true,
            data: { matchedLat: resolution.matchedLat, matchedLng: resolution.matchedLng },
          });
        }
        geocoded = { lat: resolution.lat, lng: resolution.lng };
      }
    } else if (
      'neighbourhood' in rest && rest.neighbourhood !== undefined ||
      'lat' in rest && rest.lat !== undefined ||
      'lng' in rest && rest.lng !== undefined
    ) {
      // Transitional legacy path -- trusts the client-supplied lat/lng
      // directly (matching pre-geocoding behavior). Values are already in
      // `rest` and applied via the spread below; nothing more to do here.
    } else if ((rest.city !== undefined || rest.province !== undefined) && listing.address) {
      // Neither shape's location fields were sent, but city/province still
      // changed on a listing that already has a real (NEW-shape) address on
      // file -- re-resolve its coordinates against that existing address so
      // renaming the city doesn't silently leave a stale coordinate behind.
      // A legacy (address-less) listing falls through untouched instead:
      // there is nothing to re-geocode from, and forcing an address just to
      // rename a city would be a regression for those rows.
      const nextCity     = rest.city     !== undefined ? rest.city     : listing.city;
      const nextProvince = rest.province !== undefined ? rest.province : listing.province;
      const newGeocoded = await geocodeAddress(listing.address, nextCity, nextProvince, { requirePreciseMatch: true });
      if (!newGeocoded) {
        throw new AppError('We couldn\'t verify that exact address. Please check the street number and spelling and try again.', 422);
      }

      const resolution = resolveGeocodedLocation(newGeocoded, confirmedLat, confirmedLng);
      if (resolution.kind === 'needsConfirmation') {
        return res.status(200).json({
          success: true,
          needsLocationConfirmation: true,
          data: { matchedLat: resolution.matchedLat, matchedLng: resolution.matchedLng },
        });
      }
      geocoded = { lat: resolution.lat, lng: resolution.lng };
    }

    const updated = await prisma.listing.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(geocoded && { lat: geocoded.lat, lng: geocoded.lng }),
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
// Owner-only, same as /:id/permanent below -- an admin/moderator removing
// someone else's listing must go through POST/DELETE /admin/listings/:id
// instead, which requires a reason and records who/when/why in the
// moderationRemoved* fields. This used to also allow ADMIN/MODERATOR to
// bypass the ownership check here, which let a moderator soft-remove a
// listing with no reason and no moderation record -- closed as part of
// adding the admin Remove/Restore Listing feature (moderationRemovedAt
// etc.), so every moderator removal now goes through the one path that
// actually tracks it.
router.delete('/:id', validateUuidParam('id'), authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
    if (!listing) throw new AppError('Listing not found.', 404);

    if (listing.userId !== req.user!.id) {
      throw new AppError('Not authorized.', 403);
    }

    await prisma.listing.update({
      where: { id: req.params.id },
      data: { status: ListingStatus.REMOVED, isActive: false },
    });

    res.json({ success: true, message: 'Listing removed.' });
  } catch (err) { next(err); }
});

// ─── DELETE /listings/:id/permanent ───────────────────────────────────────────
// Distinct from the soft-remove DELETE /:id above (which sets
// status=REMOVED and remains admin-reversible). This is a hard delete: the
// row and its Prisma-cascaded children (images, amenities, saved-listing
// references) are gone for good, and the S3 objects backing each image are
// also removed here since the DB cascade can't reach into object storage.
// Conversations/messages about this listing are deliberately NOT deleted —
// Conversation.listingId is SetNull, not Cascade (see schema.prisma) —
// because the other participant has no say in this listing's deletion and
// must not lose their own message history as a side effect of it.
// Owner-only by design (not admin/moderator) — admins already have the
// reversible soft-remove path for moderation.
router.delete('/:id/permanent', validateUuidParam('id'), authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      include: { images: { select: { id: true, key: true } } },
    });
    if (!listing) throw new AppError('Listing not found.', 404);

    // Strict server-side ownership check — never trust a client-supplied
    // user id; req.user.id comes only from the verified JWT.
    if (listing.userId !== req.user!.id) {
      throw new AppError('Not authorized.', 403);
    }

    // Best-effort S3 cleanup: attempt every object, log failures, but never
    // let a storage hiccup block the user from deleting their own data.
    // Listings created via raw imageUrls (not the S3 upload flow) store the
    // URL itself as `key`, which isn't a real S3 object key — deletes for
    // those simply no-op against S3 and are safely ignored.
    if (s3 && listing.images.length > 0) {
      const results = await Promise.allSettled(
        listing.images.map(img =>
          s3!.send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET!, Key: img.key }))
        )
      );
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          logger.warn(`Failed to delete S3 object for listing image ${listing.images[i].id}: ${r.reason}`);
        }
      });
    }

    // Prisma cascade (see schema.prisma) removes images, amenities, and
    // saved references. Report.listingId and Conversation.listingId are
    // both SetNull -- reports and conversations survive.
    await prisma.listing.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Listing permanently deleted.' });
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

    res.json({ success: true, message: 'Report submitted. Our team reviews reports as soon as possible.' });
  } catch (err) { next(err); }
});

export default router;
