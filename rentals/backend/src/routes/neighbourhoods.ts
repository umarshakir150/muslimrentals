/**
 * Neighbourhoods routes
 * Read-only; no authentication required.
 * Mirrors cities.ts's pattern -- drives the neighbourhood autocomplete
 * during posting so a listing's coordinates resolve to a real, curated
 * neighbourhood point instead of the city's single center point.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma/client';

const router = Router();

const neighbourhoodQuerySchema = z.object({
  city:     z.string().min(1).max(100).trim(),
  province: z.string().max(3).trim().optional(),
});

// Neighbourhoods for a given city, for autocomplete -- lat/lng included so
// the frontend can resolve coordinates on selection, same as
// CityAutocomplete does with GET /cities/all.
router.get('/all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { city, province } = neighbourhoodQuerySchema.parse(req.query);
    const where: any = { city: { equals: city, mode: 'insensitive' } };
    if (province) where.province = province;

    const neighbourhoods = await prisma.neighbourhood.findMany({
      where,
      select:  { name: true, city: true, province: true, lat: true, lng: true },
      orderBy: { name: 'asc' },
    });

    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({ success: true, data: neighbourhoods });
  } catch (err) { next(err); }
});

export default router;
