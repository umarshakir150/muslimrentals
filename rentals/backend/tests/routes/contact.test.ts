/**
 * Regression coverage for POST /contact.
 *
 * The Contact page previously only built a mailto: link with no backend
 * involvement at all -- a founder test confirmed nothing arrived, since a
 * mailto: handoff silently does nothing without a configured default email
 * client. This endpoint actually delivers the submission via the existing
 * sendEmail()/Resend infrastructure (already used for password-reset/
 * welcome/email-change emails) to the real public inbox. sendEmail is
 * mocked -- there is no test database or live Resend account wired up in
 * this repo (see authForgotReset.test.ts for the same established pattern).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const sendEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/utils/email', () => ({
  sendEmail: (...args: any[]) => sendEmailMock(...args),
  contactFormEmail:     vi.fn(() => '<html></html>'),
  contactFormEmailText: vi.fn(() => 'text'),
}));

async function buildApp() {
  vi.resetModules();
  const { default: contactRoutes } = await import('../../src/routes/contact');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/contact', contactRoutes);
  app.use(errorHandler);
  return app;
}

const VALID_BODY = {
  name: 'Amina',
  email: 'amina@example.com',
  subject: 'safety',
  message: 'Someone asked for a deposit before a viewing.',
};

beforeEach(() => {
  sendEmailMock.mockReset().mockResolvedValue(undefined);
});

describe('POST /contact', () => {
  it('actually delivers the submission via sendEmail to the real public contact inbox', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/v1/contact').send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Message sent.' });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const [{ to, subject }] = sendEmailMock.mock.calls[0];
    expect(to).toBe('muslimrentals.ca@gmail.com');
    expect(subject).toBe('[Safety concern] Muslim Rentals contact form');
  });

  it('maps every subject key to its human-readable label in the outgoing email subject', async () => {
    const app = await buildApp();
    await request(app).post('/api/v1/contact').send({ ...VALID_BODY, subject: 'report' });

    const [{ subject }] = sendEmailMock.mock.calls[0];
    expect(subject).toBe('[Report a user] Muslim Rentals contact form');
  });

  it('rejects an unknown subject key before attempting to send', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/v1/contact').send({ ...VALID_BODY, subject: 'not-a-real-subject' });

    expect(res.status).toBe(422); // Zod validation failure
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed email before attempting to send', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/v1/contact').send({ ...VALID_BODY, email: 'not-an-email' });

    expect(res.status).toBe(422);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('rejects an empty message before attempting to send', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/v1/contact').send({ ...VALID_BODY, message: '' });

    expect(res.status).toBe(422);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('rejects extra unknown fields (strict schema)', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/v1/contact').send({ ...VALID_BODY, isAdmin: true });

    expect(res.status).toBe(422);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('never claims success when delivery actually fails -- the whole point of this endpoint over the old mailto: handoff', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('Resend not configured'));

    const app = await buildApp();
    const res = await request(app).post('/api/v1/contact').send(VALID_BODY);

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.message).not.toMatch(/Message sent/);
    // Never leak the raw internal error (Resend config, API details) to the visitor.
    expect(res.body.message).not.toMatch(/Resend/i);
  });
});
