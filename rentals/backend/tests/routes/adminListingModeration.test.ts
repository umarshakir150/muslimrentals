/**
 * Coverage for the admin/moderator "Remove listing from public visibility" /
 * "Restore listing" moderation actions:
 *  - DELETE /admin/listings/:id — reversible soft-remove (reuses the
 *    existing ListingStatus.REMOVED status, already excluded from every
 *    public browse/map/search/detail query), now requiring a reason and
 *    recording who/when/why in the new moderationRemoved* fields.
 *  - PATCH /admin/listings/:id/restore — reverses a moderator's own removal,
 *    and only that: never a listing hidden for any other reason (owner's
 *    own delete, account deletion, or a still-active ban), and never while
 *    the owner is currently banned.
 *  - Interaction with the existing Ban/Unban listing-hiding behavior: a
 *    listing a moderator manually removed stays REMOVED through a later
 *    ban/unban cycle on its owner.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const MODERATOR_ID = '88888888-8888-4888-8888-888888888888';
const USER_ID = '77777777-7777-4777-8777-777777777777';
const OWNER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LISTING_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const userFindUniqueMock = vi.fn();
const userUpdateMock = vi.fn();
const listingFindUniqueMock = vi.fn();
const listingUpdateMock = vi.fn();
const listingUpdateManyMock = vi.fn();
const listingFindManyMock = vi.fn();
const listingCountMock = vi.fn();
const transactionMock = vi.fn((ops: Promise<any>[]) => Promise.all(ops));
const notificationCreateMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => userFindUniqueMock(...args),
      update:     (...args: any[]) => userUpdateMock(...args),
    },
    listing: {
      findUnique: (...args: any[]) => listingFindUniqueMock(...args),
      update:     (...args: any[]) => listingUpdateMock(...args),
      updateMany: (...args: any[]) => listingUpdateManyMock(...args),
      findMany:   (...args: any[]) => listingFindManyMock(...args),
      count:      (...args: any[]) => listingCountMock(...args),
    },
    notification: {
      create: (...args: any[]) => notificationCreateMock(...args),
    },
    $transaction: (...args: any[]) => transactionMock(...args),
  },
}));

function signToken(userId: string, role: string) {
  return jwt.sign({ userId, email: `${userId}@example.com`, role }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

function actingUser(id: string, role: string) {
  return { id, email: `${id}@example.com`, role, name: 'Staff', isActive: true, isBanned: false };
}

function mockUsersById(map: Record<string, any>) {
  userFindUniqueMock.mockImplementation(({ where }: any) => Promise.resolve(map[where.id] ?? null));
}

async function buildApp() {
  vi.resetModules();
  const { default: adminRoutes } = await import('../../src/routes/admin');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin', adminRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  userFindUniqueMock.mockReset();
  userUpdateMock.mockReset().mockResolvedValue({ email: 'target@example.com' });
  listingFindUniqueMock.mockReset();
  listingUpdateMock.mockReset().mockResolvedValue({});
  listingUpdateManyMock.mockReset().mockResolvedValue({ count: 0 });
  listingFindManyMock.mockReset().mockResolvedValue([]);
  listingCountMock.mockReset().mockResolvedValue(0);
  transactionMock.mockReset().mockImplementation((ops: Promise<any>[]) => Promise.all(ops));
  notificationCreateMock.mockReset().mockResolvedValue({});
});

describe('DELETE /admin/listings/:id — remove from public visibility', () => {
  it('ADMIN can remove a listing with a reason', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    listingFindUniqueMock.mockResolvedValue({ id: LISTING_ID });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Duplicate scam listing' });

    expect(res.status).toBe(200);
    expect(listingUpdateMock).toHaveBeenCalledWith({
      where: { id: LISTING_ID },
      data: expect.objectContaining({
        status: 'REMOVED',
        isActive: false,
        moderationRemovedById: ADMIN_ID,
        moderationRemovalReason: 'Duplicate scam listing',
        moderationRestoredAt: null,
        moderationRestoredById: null,
      }),
    });
    expect(listingUpdateMock.mock.calls[0][0].data.moderationRemovedAt).toBeInstanceOf(Date);
  });

  it('MODERATOR can also remove a listing (not ADMIN-escalated, unlike /ban)', async () => {
    mockUsersById({ [MODERATOR_ID]: actingUser(MODERATOR_ID, 'MODERATOR') });
    listingFindUniqueMock.mockResolvedValue({ id: LISTING_ID });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(MODERATOR_ID, 'MODERATOR')}`)
      .send({ reason: 'Misleading photos' });

    expect(res.status).toBe(200);
    expect(listingUpdateMock).toHaveBeenCalled();
  });

  it('a plain USER cannot call this endpoint at all (blocked by the router-wide role gate)', async () => {
    mockUsersById({ [USER_ID]: actingUser(USER_ID, 'USER') });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(USER_ID, 'USER')}`)
      .send({ reason: 'irrelevant, should never reach the handler' });

    expect(res.status).toBe(403);
    expect(listingUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects removal with no reason', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({});

    expect(res.status).toBe(422);
    expect(listingUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a reason under 5 characters', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'no' });

    expect(res.status).toBe(422);
    expect(listingUpdateMock).not.toHaveBeenCalled();
  });

  it('404s for a listing that does not exist', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    listingFindUniqueMock.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Valid reason, missing listing' });

    expect(res.status).toBe(404);
    expect(listingUpdateMock).not.toHaveBeenCalled();
  });

  it('removal works even on a listing currently BANNED (hidden by its owner\'s ban)', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    listingFindUniqueMock.mockResolvedValue({ id: LISTING_ID, status: 'BANNED' });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Independently actionable even while owner is banned' });

    expect(res.status).toBe(200);
    expect(listingUpdateMock.mock.calls[0][0].data.status).toBe('REMOVED');
  });

  it('notifies the owner with a generic message that never leaks the moderator\'s internal reason text', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    listingFindUniqueMock.mockResolvedValue({ id: LISTING_ID, userId: OWNER_ID, title: 'Cozy 2BR' });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Suspected fraud - payment outside platform' });

    expect(res.status).toBe(200);
    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    const [{ data }] = notificationCreateMock.mock.calls[0];
    expect(data.userId).toBe(OWNER_ID);
    expect(data.type).toBe('LISTING_REMOVED');
    expect(data.title).not.toMatch(/fraud|payment outside platform/i);
    expect(data.body).not.toMatch(/fraud|payment outside platform/i);
    expect(data.data).toEqual({ listingId: LISTING_ID });
  });

  it('does not notify when the listing has no owner (account permanently deleted)', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    listingFindUniqueMock.mockResolvedValue({ id: LISTING_ID, userId: null, title: 'Orphaned listing' });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Valid reason, no owner left' });

    expect(res.status).toBe(200);
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /admin/listings/:id/restore — reverse a moderator removal', () => {
  it('ADMIN/MODERATOR can restore a listing that was removed by moderation', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    listingFindUniqueMock.mockResolvedValue({
      id: LISTING_ID,
      moderationRemovedAt: new Date('2026-09-01T00:00:00.000Z'),
      moderationRestoredAt: null,
      user: { isBanned: false },
    });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/listings/${LISTING_ID}/restore`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({});

    expect(res.status).toBe(200);
    expect(listingUpdateMock).toHaveBeenCalledWith({
      where: { id: LISTING_ID },
      data: expect.objectContaining({
        status: 'ACTIVE',
        isActive: true,
        moderationRestoredById: ADMIN_ID,
      }),
    });
    expect(listingUpdateMock.mock.calls[0][0].data.moderationRestoredAt).toBeInstanceOf(Date);
  });

  it('notifies the owner that their listing was restored', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    listingFindUniqueMock.mockResolvedValue({
      id: LISTING_ID,
      userId: OWNER_ID,
      title: 'Cozy 2BR',
      moderationRemovedAt: new Date('2026-09-01T00:00:00.000Z'),
      moderationRestoredAt: null,
      user: { isBanned: false },
    });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/listings/${LISTING_ID}/restore`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({});

    expect(res.status).toBe(200);
    expect(notificationCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: OWNER_ID, type: 'LISTING_RESTORED', data: { listingId: LISTING_ID } }),
    }));
  });

  it('a plain USER cannot restore a listing (blocked by the router-wide role gate)', async () => {
    mockUsersById({ [USER_ID]: actingUser(USER_ID, 'USER') });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/listings/${LISTING_ID}/restore`)
      .set('Authorization', `Bearer ${signToken(USER_ID, 'USER')}`)
      .send({});

    expect(res.status).toBe(403);
    expect(listingUpdateMock).not.toHaveBeenCalled();
  });

  it('refuses to restore a listing never removed by moderation (e.g. owner-deleted/inactive)', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    listingFindUniqueMock.mockResolvedValue({
      id: LISTING_ID,
      moderationRemovedAt: null,
      moderationRestoredAt: null,
      user: { isBanned: false },
    });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/listings/${LISTING_ID}/restore`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(listingUpdateMock).not.toHaveBeenCalled();
  });

  it('refuses to restore a listing that was already restored since its last removal', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    listingFindUniqueMock.mockResolvedValue({
      id: LISTING_ID,
      moderationRemovedAt: new Date('2026-09-01T00:00:00.000Z'),
      moderationRestoredAt: new Date('2026-09-02T00:00:00.000Z'),
      user: { isBanned: false },
    });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/listings/${LISTING_ID}/restore`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(listingUpdateMock).not.toHaveBeenCalled();
  });

  it('refuses to restore while the listing\'s owner is currently banned', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    listingFindUniqueMock.mockResolvedValue({
      id: LISTING_ID,
      moderationRemovedAt: new Date('2026-09-01T00:00:00.000Z'),
      moderationRestoredAt: null,
      user: { isBanned: true },
    });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/listings/${LISTING_ID}/restore`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(listingUpdateMock).not.toHaveBeenCalled();
  });

  it('404s for a listing that does not exist', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    listingFindUniqueMock.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/listings/${LISTING_ID}/restore`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({});

    expect(res.status).toBe(404);
  });
});

describe('Interaction with Ban/Unban: a manually-removed listing stays REMOVED through a ban/unban cycle', () => {
  it('simulates remove -> ban -> unban on the same listing using a real in-memory row, not just call-shape assertions', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });

    // A real in-memory "table" so this test can't pass on a where-clause
    // typo the way an args-only assertion could -- update/updateMany here
    // actually filter and mutate the one row.
    const listing = {
      id: LISTING_ID, userId: OWNER_ID, status: 'ACTIVE',
      moderationRemovedAt: null as Date | null, moderationRemovedById: null as string | null,
      moderationRemovalReason: null as string | null,
      moderationRestoredAt: null as Date | null, moderationRestoredById: null as string | null,
    };
    listingFindUniqueMock.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === listing.id ? { ...listing } : null));
    listingUpdateMock.mockImplementation(({ where, data }: any) => {
      if (where.id === listing.id) Object.assign(listing, data);
      return Promise.resolve({ ...listing });
    });
    listingUpdateManyMock.mockImplementation(({ where, data }: any) => {
      let count = 0;
      if (listing.userId === where.userId && listing.status === where.status) {
        listing.status = data.status;
        count = 1;
      }
      return Promise.resolve({ count });
    });

    const app = await buildApp();

    // 1. A moderator removes the listing.
    await request(app)
      .delete(`/api/v1/admin/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Fraudulent listing' });
    expect(listing.status).toBe('REMOVED');

    // 2. The owner is separately banned. /ban's updateMany only targets
    // status: ACTIVE, so this REMOVED listing is untouched -- it never
    // becomes BANNED.
    await request(app)
      .patch(`/api/v1/admin/users/${OWNER_ID}/ban`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Unrelated account-level issue' });
    expect(listing.status).toBe('REMOVED');

    // 3. The owner is unbanned. /unban's updateMany only targets
    // status: BANNED, so this REMOVED listing is untouched again -- the
    // moderator's own removal decision survives the ban/unban cycle.
    await request(app)
      .patch(`/api/v1/admin/users/${OWNER_ID}/unban`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`);
    expect(listing.status).toBe('REMOVED');
    expect(listing.moderationRemovedAt).toBeInstanceOf(Date);
    expect(listing.moderationRemovedById).toBe(ADMIN_ID);
  });

  it('restore is refused while the owner is banned, then succeeds once unbanned', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });

    const owner = { id: OWNER_ID, isBanned: false };
    const listing = {
      id: LISTING_ID, userId: OWNER_ID, status: 'REMOVED',
      moderationRemovedAt: new Date('2026-09-01T00:00:00.000Z'), moderationRemovedById: ADMIN_ID,
      moderationRemovalReason: 'Fraudulent listing',
      moderationRestoredAt: null as Date | null, moderationRestoredById: null as string | null,
    };
    listingFindUniqueMock.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === listing.id ? { ...listing, user: { isBanned: owner.isBanned } } : null));
    listingUpdateMock.mockImplementation(({ where, data }: any) => {
      if (where.id === listing.id) Object.assign(listing, data);
      return Promise.resolve({ ...listing });
    });
    listingUpdateManyMock.mockResolvedValue({ count: 0 });
    userUpdateMock.mockImplementation(({ data }: any) => {
      if (typeof data.isBanned === 'boolean') owner.isBanned = data.isBanned;
      return Promise.resolve({ email: 'owner@example.com' });
    });

    // Owner gets banned (independent of this listing, which is already REMOVED).
    owner.isBanned = true;

    const app = await buildApp();

    const blocked = await request(app)
      .patch(`/api/v1/admin/listings/${LISTING_ID}/restore`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({});
    expect(blocked.status).toBe(400);
    expect(listing.status).toBe('REMOVED');

    owner.isBanned = false;

    const allowed = await request(app)
      .patch(`/api/v1/admin/listings/${LISTING_ID}/restore`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({});
    expect(allowed.status).toBe(200);
    expect(listing.status).toBe('ACTIVE');
  });
});
