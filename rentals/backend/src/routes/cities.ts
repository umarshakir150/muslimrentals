/**
 * Cities routes
 * Read-only; no authentication required.
 * Input validated and bounded; caching headers applied.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma/client';

const router = Router();

const cityQuerySchema = z.object({
  q:        z.string().max(100).trim().optional(),
  province: z.string().max(3).trim().optional(),
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, province } = cityQuerySchema.parse(req.query);
    const where: any = {};
    if (q)        where.name     = { contains: q, mode: 'insensitive' };
    if (province) where.province = province;

    const cities = await prisma.city.findMany({ where, orderBy: { name: 'asc' }, take: 20 });
    res.json({ success: true, data: cities });
  } catch (err) { next(err); }
});

// All cities for autocomplete — heavily cached
router.get('/all', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // lat/lng are included -- CityAutocomplete.tsx uses them to set the
    // listing's coordinates on selection. Without them here, every listing
    // silently fell back to the post form's hardcoded default coordinates
    // regardless of which city was actually chosen.
    const cities = await prisma.city.findMany({
      select:  { name: true, province: true, lat: true, lng: true },
      orderBy: { name: 'asc' },
    });
    // 1 hour public cache — city list rarely changes
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.json({ success: true, data: cities });
  } catch (err) { next(err); }
});

export default router;
