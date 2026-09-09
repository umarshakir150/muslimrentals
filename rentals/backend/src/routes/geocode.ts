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
import { geocodeAddress, searchPlaces, resolvePlace, GeocodingUnavailableError } from '../utils/geocode';

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
  } catch (err) {
    // Distinct from "no match" (404 above) -- the provider itself refused
    // the request (rate-limited), so telling the searcher to "try a
    // different search" would be actively misleading about what's wrong.
    if (err instanceof GeocodingUnavailableError) {
      return next(new AppError('Location search is temporarily unavailable. Please try again in a minute.', 503));
    }
    next(err);
  }
});

// GET /geocode/suggestions?q=<free text> -> a list of matching places for
// the Browse location-search autocomplete (LocationRadiusSearch.tsx),
// distinct from the single-result lookup above: this backs an as-you-type
// dropdown, not a one-shot "resolve this exact string" call, so it can
// return several candidates (a genuinely ambiguous query, e.g. a street
// name repeated across cities, lets the renter pick) and returns an empty
// list -- never a 404 -- when nothing matches, since "no results yet" is a
// normal state for an autocomplete box, not an error. Always resolves via
// Nominatim regardless of GEOCODING_PROVIDER -- see searchPlaces's own doc
// comment for why Geocodio isn't a fit for named-place search. Same
// stateless-lookup, no-API-key-ever-leaves-the-server stance as every other
// route in this file.
router.get('/suggestions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = geocodeQuerySchema.parse(req.query);
    const suggestions = await searchPlaces(q);
    res.json({ success: true, data: suggestions });
  } catch (err) {
    if (err instanceof GeocodingUnavailableError) {
      return next(new AppError('Location search is temporarily unavailable. Please try again in a minute.', 503));
    }
    next(err);
  }
});

// GET /geocode/resolve?q=<free text> -> { lat, lng } for the single best
// Canadian match of the COMPLETE typed text, or a clear 404 if nothing
// resolves. Backs LocationRadiusSearch.tsx's manual Enter/Search action:
// autocomplete suggestions (GET /geocode/suggestions above) are assistance,
// never a required gate -- a renter whose intended place doesn't appear in
// (or disagrees with) the dropdown can still finish typing and search their
// own complete text directly. Deliberately built on resolvePlace()/
// searchPlaces() rather than geocodeAddress (the single-result lookup GET
// /geocode above uses) -- see resolvePlace's own doc comment for the two
// concrete reasons that reuse was rejected (a provider-dependent Canada-
// only gap, and a different, address-oriented matching model). This never
// simply picks the frontend's already-fetched top suggestion -- it always
// re-resolves the complete current input text fresh, since the renter may
// have kept typing past the last suggestion fetch, or want a location the
// dropdown didn't surface at all.
router.get('/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = geocodeQuerySchema.parse(req.query);
    const result = await resolvePlace(q);
    if (!result) {
      throw new AppError('Could not find that location. Try a different search.', 404);
    }
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof GeocodingUnavailableError) {
      return next(new AppError('Location search is temporarily unavailable. Please try again in a minute.', 503));
    }
    next(err);
  }
});

export default router;
