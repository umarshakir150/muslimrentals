/**
 * Coverage for PATCH /admin/reports/:id, specifically:
 *  - the messageSnapshot retention clock (resolvedAt) is only started the
 *    first time a report actually transitions into a terminal status, not
 *    re-stamped on every PATCH -- a real bug relative to the founder-
 *    approved 90-day-from-resolvedAt retention policy, since re-stamping
 *    on an unrelated PATCH (e.g. a hold-only toggle) would silently push
 *    the clock forward indefinitely.
 *  - the new retentionHold/retentionHoldReason fields can be toggled
 *    independent of status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';

const userFindUniqueMock = vi.fn();
const reportFindUniqueMock = vi.fn();
const reportUpdateMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user:   { findUnique: (...args: any[]) => userFindUniqueMock(...args) },
    report: {
      findUnique: (...args: any[]) => reportFindUniqueMock(...args),
      update:     (...args: any[]) => reportUpdateMock(...args),
    },
  },
}));

function signToken(userId: string) {
  return jwt.sign({ userId, email: `${userId}@example.com`, role: 'ADMIN' }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

function adminUser() {
  return { id: ADMIN_ID, email: 'admin@example.com', role: 'ADMIN', name: 'Admin', isActive: true, isBanned: false };
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
  userFindUniqueMock.mockReset().mockResolvedValue(adminUser());
  reportFindUniqueMock.mockReset();
  reportUpdateMock.mockReset().mockResolvedValue({});
});

const REPORT_ID = '55555555-5555-4555-8555-555555555555';

describe('PATCH /admin/reports/:id', () => {
  it('404s when the report does not exist', async () => {
    reportFindUniqueMock.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/reports/${REPORT_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID)}`)
      .send({ status: 'RESOLVED' });

    expect(res.status).toBe(404);
    expect(reportUpdateMock).not.toHaveBeenCalled();
  });

  it('sets resolvedAt the first time a report transitions into RESOLVED', async () => {
    reportFindUniqueMock.mockResolvedValue({ status: 'PENDING' });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/reports/${REPORT_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID)}`)
      .send({ status: 'RESOLVED', resolution: 'Reviewed and dismissed' });

    expect(res.status).toBe(200);
    expect(reportUpdateMock).toHaveBeenCalledWith({
      where: { id: REPORT_ID },
      data: expect.objectContaining({ status: 'RESOLVED', resolution: 'Reviewed and dismissed', resolvedAt: expect.any(Date) }),
    });
  });

  it('does NOT re-stamp resolvedAt on a PATCH that resends the same terminal status the report is already in', async () => {
    reportFindUniqueMock.mockResolvedValue({ status: 'RESOLVED' });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/reports/${REPORT_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID)}`)
      .send({ status: 'RESOLVED', resolution: 'Reviewed again' });

    expect(res.status).toBe(200);
    const call = reportUpdateMock.mock.calls[0][0];
    expect(call.data.resolvedAt).toBeUndefined();
  });

  it('lets a moderator place a retention hold independent of status, without touching resolvedAt', async () => {
    reportFindUniqueMock.mockResolvedValue({ status: 'RESOLVED' });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/reports/${REPORT_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID)}`)
      .send({ retentionHold: true, retentionHoldReason: 'Active police investigation' });

    expect(res.status).toBe(200);
    expect(reportUpdateMock).toHaveBeenCalledWith({
      where: { id: REPORT_ID },
      data: { retentionHold: true, retentionHoldReason: 'Active police investigation' },
    });
  });

  it('lets a moderator clear a retention hold', async () => {
    reportFindUniqueMock.mockResolvedValue({ status: 'RESOLVED' });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/reports/${REPORT_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID)}`)
      .send({ retentionHold: false });

    expect(res.status).toBe(200);
    expect(reportUpdateMock).toHaveBeenCalledWith({
      where: { id: REPORT_ID },
      data: { retentionHold: false },
    });
  });

  it('rejects an unrecognized field (strict schema)', async () => {
    reportFindUniqueMock.mockResolvedValue({ status: 'PENDING' });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/admin/reports/${REPORT_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID)}`)
      .send({ status: 'RESOLVED', notAField: true });

    expect(res.status).toBe(422);
    expect(reportUpdateMock).not.toHaveBeenCalled();
  });
});
