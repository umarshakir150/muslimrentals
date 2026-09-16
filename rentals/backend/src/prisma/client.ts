import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? [{ emit: 'event', level: 'query' }, 'info', 'warn', 'error']
    : ['warn', 'error'],
});

if (process.env.NODE_ENV === 'development') {
  // @ts-expect-error -- 'query' event typing requires the 'event' log config above, which is set
  prisma.$on('query', (e: any) => {
    if (process.env.LOG_QUERIES === 'true') {
      logger.debug(`Query: ${e.query} | Duration: ${e.duration}ms`);
    }
  });
  globalThis.__prisma = prisma;
}

export default prisma;
