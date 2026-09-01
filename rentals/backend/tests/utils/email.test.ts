/**
 * Regression coverage for the transactional email templates: every template
 * must include a plain-text fallback (deliverability + accessibility) and,
 * in the HTML version, a copy-pasteable link alongside the button (so a
 * button that fails to render, or an email client that strips links, still
 * leaves the recipient a way to complete the flow).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sendMailMock = vi.fn();
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function loadEmailModule() {
  vi.resetModules();
  return import('../../src/utils/email');
}

beforeEach(() => {
  sendMailMock.mockReset();
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

describe('passwordResetEmail / passwordResetEmailText', () => {
  it('the HTML version includes the reset URL both as a button and as a copy-pasteable link', async () => {
    const { passwordResetEmail } = await loadEmailModule();
    const html = passwordResetEmail('Amina', 'https://muslimrentals.ca/reset-password?token=abc123');
    const occurrences = html.split('https://muslimrentals.ca/reset-password?token=abc123').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('the plain-text version carries the same link and no HTML markup', async () => {
    const { passwordResetEmailText } = await loadEmailModule();
    const text = passwordResetEmailText('Amina', 'https://muslimrentals.ca/reset-password?token=abc123');
    expect(text).toContain('https://muslimrentals.ca/reset-password?token=abc123');
    expect(text).not.toMatch(/<[a-z][\s\S]*>/i);
  });
});

describe('emailChangeVerificationEmail / emailChangeVerificationEmailText', () => {
  it('the HTML version names the new email address and includes the confirm URL as both button and link', async () => {
    const { emailChangeVerificationEmail } = await loadEmailModule();
    const html = emailChangeVerificationEmail('Amina', 'new@example.com', 'https://muslimrentals.ca/confirm-email?token=xyz');
    expect(html).toContain('new@example.com');
    const occurrences = html.split('https://muslimrentals.ca/confirm-email?token=xyz').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('the plain-text version carries the same confirm link', async () => {
    const { emailChangeVerificationEmailText } = await loadEmailModule();
    const text = emailChangeVerificationEmailText('Amina', 'new@example.com', 'https://muslimrentals.ca/confirm-email?token=xyz');
    expect(text).toContain('https://muslimrentals.ca/confirm-email?token=xyz');
    expect(text).toContain('new@example.com');
  });
});

describe('sendEmail', () => {
  it('throws a clear error and never attempts a connection when SMTP is not configured', async () => {
    const { sendEmail } = await loadEmailModule();
    await expect(sendEmail({ to: 'a@example.com', subject: 'x', html: '<p>x</p>', text: 'x' })).rejects.toThrow('SMTP not configured');
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('sends both html and text bodies once SMTP is configured', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASS = 'pass';
    process.env.EMAIL_FROM = 'noreply@muslimrentals.ca';
    sendMailMock.mockResolvedValueOnce({});

    const { sendEmail } = await loadEmailModule();
    await sendEmail({ to: 'a@example.com', subject: 'Subject', html: '<p>hi</p>', text: 'hi' });

    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'a@example.com', subject: 'Subject', html: '<p>hi</p>', text: 'hi',
    }));
  });
});
