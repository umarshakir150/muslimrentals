// mosques.ts
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { city, lat, lng, radius = '50' } = req.query as Record<string, string>;
    const where: any = { sect: 'SUNNI' };
    if (city) where.city = { contains: city, mode: 'insensitive' };

    const mosques = await prisma.mosque.findMany({ where, orderBy: { name: 'asc' } });

    let result = mosques;
    if (lat && lng) {
      const cLat = parseFloat(lat), cLng = parseFloat(lng), r = parseFloat(radius);
      const R = 6371;
      result = mosques.filter(m => {
        const dLat = (m.lat - cLat) * Math.PI / 180;
        const dLng = (m.lng - cLng) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(cLat*Math.PI/180) * Math.cos(m.lat*Math.PI/180) * Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) <= r;
      });
    }

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

export { router as default };

// ─────────────────────────────────────────────────────────────────────────────
