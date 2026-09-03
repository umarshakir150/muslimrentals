/**
 * Coverage for the address -> geocode -> precise-coordinate pipeline that
 * replaced the old neighbourhood-dropdown/centroid system: POST /listings
 * now geocodes the submitted address server-side (never trusts a
 * client-supplied lat/lng -- see listingSchemas.ts, which no longer accepts
 * those fields at all), and PATCH /listings/:id re-geocodes only when the
 * address/city/province actually changes.
 *
 * Prisma and utils/geocode are both mocked -- there is no test database or
 * real network access wired up in this repo (same established pattern as
 * listingsLocationPrivacy.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const LISTING_ID = '22222222-2222-4222-8222-222222222222';

const geocodeAddressMock = vi.fn();
vi.mock('../../src/utils/geocode', () => ({
  geocodeAddress: (...args: any[]) => geocodeAddressMock(...args),
}));

const createMock = vi.fn();
const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const userFindUniqueMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    listing: {
      create:     (...args: any[]) => createMock(...args),
      findUnique: (...args: any[]) => findUniqueMock(...args),
      update:     (...args: any[]) => updateMock(...args),
    },
    user: { findUnique: (...args: any[]) => userFindUniqueMock(...args) },
  },
}));

function signToken(userId: string, role: string) {
  return jwt.sign({ userId, email: `${userId}@example.com`, role }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

function activeUser(id: string, role = 'USER') {
  return { id, email: `${id}@example.com`, role, name: 'Person', isActive: true, isBanned: false };
}

function validPayload(overrides: Record<string, any> = {}) {
  return {
    title: 'Bright 2BR near the mosque',
    description: 'A lovely two-bedroom apartment close to transit and shops.',
    price: 1500,
    bedrooms: 2,
    bathrooms: 1,
    audience: 'ALL',
    city: 'Toronto',
    province: 'ON',
    address: '123 Main Street',
    contactInfo: 'call 555-555-5555',
    ...overrides,
  };
}

async function buildApp() {
  vi.resetModules();
  const { default: listingRoutes } = await import('../../src/routes/listings');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/listings', listingRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  geocodeAddressMock.mockReset();
  createMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  userFindUniqueMock.mockReset();
  userFindUniqueMock.mockResolvedValue(activeUser(OWNER_ID));
});

describe('POST /listings — server-side geocoding', () => {
  it('geocodes the submitted address and stores the resolved coordinates, never client-supplied ones', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 43.6532, lng: -79.3832 });
    createMock.mockImplementation((args: any) =>
      Promise.resolve({ id: 'new-listing', ...args.data, images: [], amenities: [], user: { id: OWNER_ID, name: 'Owner', avatarUrl: null } })
    );
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(validPayload());

    expect(res.status).toBe(201);
    expect(geocodeAddressMock).toHaveBeenCalledWith('123 Main Street', 'Toronto', 'ON');
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lat: 43.6532, lng: -79.3832, address: '123 Main Street' }),
    }));
  });

  it('never passes the unit number into the geocoding call', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 43.6532, lng: -79.3832 });
    createMock.mockImplementation((args: any) => Promise.resolve({ id: 'new-listing', ...args.data, images: [], amenities: [], user: {} }));
    const app = await buildApp();

    await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(validPayload({ unit: 'Unit 4B' }));

    // geocodeAddress's own signature has no unit parameter -- confirms the
    // route only ever calls it with (address, city, province).
    expect(geocodeAddressMock).toHaveBeenCalledWith('123 Main Street', 'Toronto', 'ON');
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ unit: 'Unit 4B' }),
    }));
  });

  it('rejects with a clear error and creates nothing when the address cannot be geocoded', async () => {
    geocodeAddressMock.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(validPayload({ address: 'Not A Real Address Whatsoever' }));

    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects a request that tries to supply lat/lng directly (unknown fields)', async () => {
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ ...validPayload(), lat: 43.6532, lng: -79.3832 });

    expect(res.status).toBe(422); // Zod .strict() validation failure -- see errorHandler's ZodError mapping
    expect(geocodeAddressMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /listings/:id — re-geocodes only when the location actually changes', () => {
  function existingListing(overrides: Record<string, any> = {}) {
    return {
      id: LISTING_ID, userId: OWNER_ID, status: 'ACTIVE',
      title: 'Old title', city: 'Toronto', province: 'ON', address: '123 Main Street', unit: null,
      lat: 43.6532, lng: -79.3832,
      ...overrides,
    };
  }

  it('re-geocodes when the address changes, and stores the new coordinates', async () => {
    findUniqueMock.mockResolvedValue(existingListing());
    geocodeAddressMock.mockResolvedValue({ lat: 45.4215, lng: -75.6972 });
    updateMock.mockImplementation((args: any) => Promise.resolve({ id: LISTING_ID, ...args.data, images: [], amenities: [], user: {} }));
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ address: '999 New Street' });

    expect(res.status).toBe(200);
    expect(geocodeAddressMock).toHaveBeenCalledWith('999 New Street', 'Toronto', 'ON');
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lat: 45.4215, lng: -75.6972 }),
    }));
  });

  it('does not re-geocode when only unrelated fields (e.g. unit, price, title) change', async () => {
    findUniqueMock.mockResolvedValue(existingListing());
    updateMock.mockImplementation((args: any) => Promise.resolve({ id: LISTING_ID, ...existingListing(), ...args.data, images: [], amenities: [], user: {} }));
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ unit: 'Unit 9', price: 1600 });

    expect(res.status).toBe(200);
    expect(geocodeAddressMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ lat: expect.anything(), lng: expect.anything() }),
    }));
  });

  it('does not re-geocode when the address is resubmitted unchanged', async () => {
    findUniqueMock.mockResolvedValue(existingListing());
    updateMock.mockResolvedValue({ id: LISTING_ID, ...existingListing(), images: [], amenities: [], user: {} });
    const app = await buildApp();

    await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ address: '123 Main Street' }); // identical to the stored value

    expect(geocodeAddressMock).not.toHaveBeenCalled();
  });

  it('re-geocodes when only the city changes (address text reused against a new city)', async () => {
    findUniqueMock.mockResolvedValue(existingListing());
    geocodeAddressMock.mockResolvedValue({ lat: 49.2827, lng: -123.1207 });
    updateMock.mockImplementation((args: any) => Promise.resolve({ id: LISTING_ID, ...args.data, images: [], amenities: [], user: {} }));
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ city: 'Vancouver' });

    expect(res.status).toBe(200);
    expect(geocodeAddressMock).toHaveBeenCalledWith('123 Main Street', 'Vancouver', 'ON');
  });

  it('rejects with a clear error and applies no update when the new address cannot be geocoded', async () => {
    findUniqueMock.mockResolvedValue(existingListing());
    geocodeAddressMock.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ address: 'Not A Real Address Whatsoever' });

    expect(res.status).toBe(422);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
