/**
 * Ad-hoc place/address search geocoding, for the renter-facing "search a
 * location + radius" filter (distinct from listing creation's own
 * geocoding call in routes/listings.ts, but built on the exact same
 * utils/geocode.ts helper -- no second geocoding implementation).
 *
 * Read-only; no authentication required (mirrors cities.ts/the old
 * neighbourhoods.ts pattern). Relies on the app-wide `rateLimiter` already
 * applied to every route in index.ts rather than adding a new tier --
 * consistent with those other simple read-only lookup routes.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { geocodeAddress } from '../utils/geocode';

const router = Router();

const geocodeQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
});

// GET /geocode?q=<free text> -> { lat, lng } for the searched place, or a
// clear 404 if it couldn't be resolved. The renter's search text is never
// stored -- this is a stateless lookup, same as the map center it produces.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = geocodeQuerySchema.parse(req.query);
    const result = await geocodeAddress(q, '');
    if (!result) {
      throw new AppError('Could not find that location. Try a different search.', 404);
    }
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

export default router;
