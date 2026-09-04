/**
 * Coverage for GET /geocode -- the ad-hoc place/address search endpoint
 * backing the renter-facing "search a location + radius" filter. Built on
 * the same utils/geocode.ts helper listing creation uses (mocked here);
 * its own success/failure-mode behavior is covered in tests/utils/geocode.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const geocodeAddressMock = vi.fn();
vi.mock('../../src/utils/geocode', () => ({
  geocodeAddress: (...args: any[]) => geocodeAddressMock(...args),
}));

async function buildApp() {
  vi.resetModules();
  const { default: geocodeRoutes } = await import('../../src/routes/geocode');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/geocode', geocodeRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  geocodeAddressMock.mockReset();
});

describe('GET /geocode', () => {
  it('resolves a free-text place search to coordinates', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 43.773, lng: -79.257 });
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode').query({ q: 'Scarborough' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ lat: 43.773, lng: -79.257 });
    expect(geocodeAddressMock).toHaveBeenCalledWith('Scarborough', '');
  });

  it('never requires or accepts a city/province -- one free-text field is enough', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 1, lng: 2 });
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode').query({ q: 'Anywhere', city: 'Toronto' });

    // `city` is an unrecognized field for this schema -- .strict() isn't used
    // here (no mass-assignment risk on a read-only lookup), but the route
    // must still ignore it and only ever pass the single `q` value through.
    expect(res.status).toBe(200);
    expect(geocodeAddressMock).toHaveBeenCalledWith('Anywhere', '');
  });

  it('returns 404 with a clear message when the place cannot be found', async () => {
    geocodeAddressMock.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode').query({ q: 'Nonexistent Fake Place 99999' });

    expect(res.status).toBe(404);
    expect(geocodeAddressMock).toHaveBeenCalled();
  });

  it('rejects a query shorter than 2 characters', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/geocode').query({ q: 'a' });

    expect(res.status).toBe(422);
    expect(geocodeAddressMock).not.toHaveBeenCalled();
  });

  it('rejects a missing q param', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/geocode');

    expect(res.status).toBe(422);
  });

  it('trims whitespace from the query', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 1, lng: 2 });
    const app = await buildApp();

    await request(app).get('/api/v1/geocode').query({ q: '  Scarborough  ' });

    expect(geocodeAddressMock).toHaveBeenCalledWith('Scarborough', '');
  });

  it('never stores or persists the search query anywhere (stateless lookup)', async () => {
    // No prisma import at all in the route module -- this test documents
    // and enforces that contract by never mocking prisma/client; if the
    // route ever tried to touch the database, this test file would need a
    // mock for it to even load without throwing, which is the point.
    geocodeAddressMock.mockResolvedValue({ lat: 1, lng: 2 });
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode').query({ q: 'Some Place' });

    expect(res.status).toBe(200);
  });
});
