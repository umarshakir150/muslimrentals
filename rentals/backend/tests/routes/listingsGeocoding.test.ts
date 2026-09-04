/**
 * Coverage for the address -> geocode -> universal-confirmation ->
 * precise-coordinate pipeline that replaced the old neighbourhood-dropdown/
 * centroid system: POST /listings geocodes the submitted address
 * server-side (never trusts a client-supplied lat/lng on its own -- see
 * listingSchemas.ts) to find the best STARTING point, but never creates or
 * updates a listing until the landlord confirms (or drags) a pin over that
 * point -- regardless of how confident the geocode match was. PATCH
 * /listings/:id re-geocodes only when the address/city/province actually
 * changes, and follows the exact same confirmation rule when it does.
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
  // Real value (not mocked) -- the landlord-confirmed-pin distance check in
  // routes/listings.ts imports this constant directly, and these tests pick
  // confirmed-pin fixtures that are deliberately near/far relative to it.
  MAX_PIN_CORRECTION_METERS: 2000,
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

// Coverage for the universal confirm-property-location flow: EVERY new
// address-based listing requires the landlord to confirm (or drag) a pin
// before it's created, regardless of geocodeAddress's confidence for the
// match -- a house/building-level ("precise") result and a street-only
// result are treated identically here. geocodeAddress is only ever used to
// find the best STARTING point shown to the landlord.
describe('POST /listings — universal confirm-property-location flow', () => {
  it('returns needsLocationConfirmation and creates nothing for a precise (house-level) match (1051 Cedarglen Gate, Mississauga style)', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 43.5789, lng: -79.6583, confidence: 'precise' });
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(validPayload({ address: '1051 Cedarglen Gate', city: 'Mississauga' }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.needsLocationConfirmation).toBe(true);
    expect(res.body.data).toEqual({ matchedLat: 43.5789, matchedLng: -79.6583 });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('returns needsLocationConfirmation and creates nothing for a street-level-only match (732 Mill St, Windsor style)', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 42.3023085, lng: -83.0764497, confidence: 'street' });
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(validPayload({ address: '732 Mill St', city: 'Windsor', province: 'ON' }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.needsLocationConfirmation).toBe(true);
    expect(res.body.data).toEqual({ matchedLat: 42.3023085, matchedLng: -83.0764497 });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('geocodes with the right address/city/province and never passes the unit number, before confirmation is even in the picture', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 43.6532, lng: -79.3832, confidence: 'precise' });
    const app = await buildApp();

    await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(validPayload({ unit: 'Unit 4B' }));

    // geocodeAddress's own signature has no unit parameter -- confirms the
    // route only ever calls it with (address, city, province, options).
    expect(geocodeAddressMock).toHaveBeenCalledWith('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('creates the listing with the confirmed pin as the exact private coordinate for a precise match (small landlord nudge)', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 43.5789, lng: -79.6583, confidence: 'precise' });
    createMock.mockImplementation((args: any) =>
      Promise.resolve({ id: 'new-listing', ...args.data, images: [], amenities: [], user: { id: OWNER_ID, name: 'Owner', avatarUrl: null } })
    );
    const app = await buildApp();

    // A small ~10m nudge -- the landlord just double-checking a precise pin.
    const confirmedLat = 43.5789 + 0.00009;
    const confirmedLng = -79.6583;

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(validPayload({ address: '1051 Cedarglen Gate', city: 'Mississauga', confirmedLat, confirmedLng }));

    expect(res.status).toBe(201);
    expect(res.body.needsLocationConfirmation).toBeUndefined();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lat: confirmedLat, lng: confirmedLng, address: '1051 Cedarglen Gate' }),
    }));
  });

  it('creates the listing with the confirmed pin as the exact private coordinate for a street-level match (larger landlord correction)', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 42.3023085, lng: -83.0764497, confidence: 'street' });
    createMock.mockImplementation((args: any) =>
      Promise.resolve({ id: 'new-listing', ...args.data, images: [], amenities: [], user: { id: OWNER_ID, name: 'Owner', avatarUrl: null } })
    );
    const app = await buildApp();

    // A pin the landlord dragged ~120m from the matched street point --
    // comfortably within MAX_PIN_CORRECTION_METERS.
    const confirmedLat = 42.3023085 + 0.0011;
    const confirmedLng = -83.0764497;

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(validPayload({ address: '732 Mill St', city: 'Windsor', province: 'ON', confirmedLat, confirmedLng }));

    expect(res.status).toBe(201);
    expect(res.body.needsLocationConfirmation).toBeUndefined();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lat: confirmedLat, lng: confirmedLng }),
    }));
  });

  it('rejects a confirmed pin that is implausibly far from the geocoded point (e.g. a different city) and creates nothing', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 42.3023085, lng: -83.0764497, confidence: 'street' });
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      // Toronto -- hundreds of km from the matched Windsor point.
      .send(validPayload({ address: '732 Mill St', city: 'Windsor', province: 'ON', confirmedLat: 43.6532, confirmedLng: -79.3832 }));

    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects an implausibly-far confirmed pin even for a precise match, not just a street-level one', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 43.5789, lng: -79.6583, confidence: 'precise' });
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(validPayload({ address: '1051 Cedarglen Gate', city: 'Mississauga', confirmedLat: 45.4215, confirmedLng: -75.6972 }));

    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('never exposes the landlord-confirmed exact coordinate through the public listing response shape', async () => {
    // toPublicListingLocation (utils/geo.ts) is exercised directly here
    // since the create response returns the raw (owner-facing) listing --
    // this proves the SAME private coordinate this flow stores is subject
    // to the exact same public-redaction pipeline as any other listing,
    // never a bypass. See listingsLocationPrivacy.test.ts for the broader
    // GET / and GET /:id public-response guarantees.
    const confirmedLat = 42.3023085 + 0.0011;
    const confirmedLng = -83.0764497;
    geocodeAddressMock.mockResolvedValue({ lat: 42.3023085, lng: -83.0764497, confidence: 'street' });
    createMock.mockImplementation((args: any) =>
      Promise.resolve({ id: 'new-listing', ...args.data, images: [], amenities: [], user: { id: OWNER_ID, name: 'Owner', avatarUrl: null } })
    );
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(validPayload({ address: '732 Mill St', city: 'Windsor', province: 'ON', confirmedLat, confirmedLng }));

    const { toPublicListingLocation } = await import('../../src/utils/geo');
    const publicView = toPublicListingLocation(res.body.data);

    expect(publicView.lat).not.toBe(confirmedLat);
    expect(publicView.lng).not.toBe(confirmedLng);
    expect((publicView as any).address).toBeUndefined();
    expect(publicView.locationApproximate).toBe(true);
  });

  it('rejects with a clear error and creates nothing when the address cannot be geocoded at all (no candidate to confirm against)', async () => {
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

describe('POST /listings — TRANSITIONAL legacy shape (old production Post Listing contract)', () => {
  function legacyPayload(overrides: Record<string, any> = {}) {
    const { address, ...rest } = validPayload();
    return { ...rest, neighbourhood: 'Kensington Market', lat: 43.6532, lng: -79.3832, ...overrides };
  }

  it('accepts the old production shape (neighbourhood + client lat/lng, no address) and stores it verbatim -- no confirmation step for the legacy shape', async () => {
    createMock.mockImplementation((args: any) =>
      Promise.resolve({ id: 'new-listing', ...args.data, images: [], amenities: [], user: { id: OWNER_ID, name: 'Owner', avatarUrl: null } })
    );
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(legacyPayload());

    expect(res.status).toBe(201);
    // The whole point of the legacy path: no geocoding call at all, and the
    // client-supplied coordinates are trusted directly -- exactly the
    // pre-existing production behavior this preserves. The universal
    // confirm-property-location flow only applies to the NEW (address)
    // shape, which this payload deliberately doesn't use.
    expect(geocodeAddressMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ neighbourhood: 'Kensington Market', lat: 43.6532, lng: -79.3832 }),
    }));
  });

  it('never stores an address for a legacy-shape submission (none was ever provided)', async () => {
    createMock.mockImplementation((args: any) => Promise.resolve({ id: 'new-listing', ...args.data, images: [], amenities: [], user: {} }));
    const app = await buildApp();

    await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(legacyPayload());

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ address: expect.anything() }),
    }));
  });

  it('rejects a request mixing the legacy shape with a real address (modes cannot mix)', async () => {
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ ...legacyPayload(), address: '123 Main Street' });

    expect(res.status).toBe(422);
    expect(geocodeAddressMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects a legacy-shape request missing lat (an incomplete legacy payload is not accepted as a fallback)', async () => {
    const { lat, ...incomplete } = legacyPayload();
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(incomplete);

    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects a request with neither an address nor a complete legacy triple (no location info at all)', async () => {
    const { address, ...rest } = validPayload();
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send(rest);

    expect(res.status).toBe(422);
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

  it('re-geocodes (and requires confirmation, not an immediate update) when the address changes', async () => {
    findUniqueMock.mockResolvedValue(existingListing());
    geocodeAddressMock.mockResolvedValue({ lat: 45.4215, lng: -75.6972, confidence: 'precise' });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ address: '999 New Street' });

    expect(res.status).toBe(200);
    expect(geocodeAddressMock).toHaveBeenCalledWith('999 New Street', 'Toronto', 'ON', { requirePreciseMatch: true });
    expect(res.body.needsLocationConfirmation).toBe(true);
    expect(res.body.data).toEqual({ matchedLat: 45.4215, matchedLng: -75.6972 });
    expect(updateMock).not.toHaveBeenCalled();
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

  it('re-geocodes (and requires confirmation) when only the city changes (address text reused against a new city)', async () => {
    findUniqueMock.mockResolvedValue(existingListing());
    geocodeAddressMock.mockResolvedValue({ lat: 49.2827, lng: -123.1207, confidence: 'precise' });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ city: 'Vancouver' });

    expect(res.status).toBe(200);
    expect(geocodeAddressMock).toHaveBeenCalledWith('123 Main Street', 'Vancouver', 'ON', { requirePreciseMatch: true });
    expect(res.body.needsLocationConfirmation).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
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

  it('a city-only edit on a legacy (address-less) listing does not force a geocode or throw', async () => {
    findUniqueMock.mockResolvedValue(existingListing({ address: null, neighbourhood: 'Kensington Market' }));
    updateMock.mockImplementation((args: any) => Promise.resolve({ id: LISTING_ID, ...args.data, images: [], amenities: [], user: {} }));
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ city: 'Vancouver' });

    expect(res.status).toBe(200);
    expect(geocodeAddressMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ city: 'Vancouver' }),
    }));
  });
});

// Coverage for the universal confirm-property-location flow applied to
// PATCH -- identical rule to POST (see the describe block above): a
// re-geocode triggered by an edit NEVER commits a new coordinate without
// landlord confirmation, whether the match was 'precise' or 'street'.
describe('PATCH /listings/:id — universal confirm-property-location flow (same rules as POST)', () => {
  function existingListing(overrides: Record<string, any> = {}) {
    return {
      id: LISTING_ID, userId: OWNER_ID, status: 'ACTIVE',
      title: 'Old title', city: 'Toronto', province: 'ON', address: '123 Main Street', unit: null,
      lat: 43.6532, lng: -79.3832,
      ...overrides,
    };
  }

  it('does not apply the edit and returns needsLocationConfirmation for a precise (house-level) match, not just a street-level one', async () => {
    findUniqueMock.mockResolvedValue(existingListing());
    geocodeAddressMock.mockResolvedValue({ lat: 43.5789, lng: -79.6583, confidence: 'precise' });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ address: '1051 Cedarglen Gate', city: 'Mississauga' });

    expect(res.status).toBe(200);
    expect(res.body.needsLocationConfirmation).toBe(true);
    expect(res.body.data).toEqual({ matchedLat: 43.5789, matchedLng: -79.6583 });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('does not apply the edit and returns needsLocationConfirmation when the new address only geocodes to street-level', async () => {
    findUniqueMock.mockResolvedValue(existingListing());
    geocodeAddressMock.mockResolvedValue({ lat: 42.3023085, lng: -83.0764497, confidence: 'street' });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ address: '732 Mill St', city: 'Windsor', province: 'ON' });

    expect(res.status).toBe(200);
    expect(res.body.needsLocationConfirmation).toBe(true);
    expect(res.body.data).toEqual({ matchedLat: 42.3023085, matchedLng: -83.0764497 });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('applies the edit using the landlord-confirmed pin once confirmedLat/confirmedLng are resubmitted', async () => {
    findUniqueMock.mockResolvedValue(existingListing());
    geocodeAddressMock.mockResolvedValue({ lat: 42.3023085, lng: -83.0764497, confidence: 'street' });
    updateMock.mockImplementation((args: any) => Promise.resolve({ id: LISTING_ID, ...args.data, images: [], amenities: [], user: {} }));
    const app = await buildApp();

    const confirmedLat = 42.3023085 + 0.0011;
    const confirmedLng = -83.0764497;

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ address: '732 Mill St', city: 'Windsor', province: 'ON', confirmedLat, confirmedLng });

    expect(res.status).toBe(200);
    expect(res.body.needsLocationConfirmation).toBeUndefined();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lat: confirmedLat, lng: confirmedLng }),
    }));
    // confirmedLat/confirmedLng are not Listing columns -- must never leak
    // into the Prisma update payload itself.
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ confirmedLat: expect.anything(), confirmedLng: expect.anything() }),
    }));
  });

  it('applies the edit using the landlord-confirmed pin when only city/province changed (re-geocoded from the existing stored address)', async () => {
    findUniqueMock.mockResolvedValue(existingListing());
    geocodeAddressMock.mockResolvedValue({ lat: 49.2827, lng: -123.1207, confidence: 'precise' });
    updateMock.mockImplementation((args: any) => Promise.resolve({ id: LISTING_ID, ...args.data, images: [], amenities: [], user: {} }));
    const app = await buildApp();

    const confirmedLat = 49.2827 + 0.00005;
    const confirmedLng = -123.1207;

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ city: 'Vancouver', confirmedLat, confirmedLng });

    expect(res.status).toBe(200);
    expect(res.body.needsLocationConfirmation).toBeUndefined();
    expect(geocodeAddressMock).toHaveBeenCalledWith('123 Main Street', 'Vancouver', 'ON', { requirePreciseMatch: true });
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lat: confirmedLat, lng: confirmedLng, city: 'Vancouver' }),
    }));
  });

  it('rejects an implausibly-far confirmed pin on PATCH and applies no update', async () => {
    findUniqueMock.mockResolvedValue(existingListing());
    geocodeAddressMock.mockResolvedValue({ lat: 42.3023085, lng: -83.0764497, confidence: 'street' });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ address: '732 Mill St', city: 'Windsor', province: 'ON', confirmedLat: 43.6532, confirmedLng: -79.3832 });

    expect(res.status).toBe(422);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /listings/:id — TRANSITIONAL legacy shape', () => {
  function legacyExistingListing(overrides: Record<string, any> = {}) {
    return {
      id: LISTING_ID, userId: OWNER_ID, status: 'ACTIVE',
      title: 'Old title', city: 'Toronto', province: 'ON', address: null, unit: null,
      neighbourhood: 'Kensington Market', lat: 43.6532, lng: -79.3832,
      ...overrides,
    };
  }

  it('accepts a legacy-shape lat/lng update and trusts it directly, no geocoding', async () => {
    findUniqueMock.mockResolvedValue(legacyExistingListing());
    updateMock.mockImplementation((args: any) => Promise.resolve({ id: LISTING_ID, ...args.data, images: [], amenities: [], user: {} }));
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ lat: 45.4215, lng: -75.6972 });

    expect(res.status).toBe(200);
    expect(geocodeAddressMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lat: 45.4215, lng: -75.6972 }),
    }));
  });

  it('rejects a PATCH mixing address with a legacy field', async () => {
    findUniqueMock.mockResolvedValue(legacyExistingListing());
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`)
      .send({ address: '999 New Street', neighbourhood: 'Downtown' });

    expect(res.status).toBe(422);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
