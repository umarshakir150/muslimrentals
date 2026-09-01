/**
 * Regression coverage for the transactional email templates: every template
 * must include a plain-text fallback (deliverability + accessibility) and,
 * in the HTML version, a copy-pasteable link alongside the button (so a
 * button that fails to render, or an email client that strips links, still
 * leaves the recipient a way to complete the flow).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({ emails: { send: sendMock } })),
}));

// vi.mock factories run once and are reused across vi.resetModules() calls
// within this file, so these vi.fn()s must be reset explicitly per test
// (like sendMock below) -- otherwise calls accumulate across tests and any
// assertion on "was logger.info called" reports stale results from an
// earlier test rather than the current one.
const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../src/utils/logger', () => ({ logger: loggerMock }));

async function loadEmailModule() {
  vi.resetModules();
  return import('../../src/utils/email');
}

beforeEach(() => {
  sendMock.mockReset();
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  loggerMock.debug.mockReset();
  delete process.env.RESEND_API_KEY;
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
  it('throws a clear error and never calls the Resend API when RESEND_API_KEY is not configured', async () => {
    const { sendEmail } = await loadEmailModule();
    await expect(sendEmail({ to: 'a@example.com', subject: 'x', html: '<p>x</p>', text: 'x' })).rejects.toThrow('Resend not configured');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends both html and text bodies once RESEND_API_KEY is configured', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'noreply@muslimrentals.ca';
    sendMock.mockResolvedValueOnce({ data: { id: 'email_123' }, error: null });

    const { sendEmail } = await loadEmailModule();
    await sendEmail({ to: 'a@example.com', subject: 'Subject', html: '<p>hi</p>', text: 'hi' });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      from: 'noreply@muslimrentals.ca', to: 'a@example.com', subject: 'Subject', html: '<p>hi</p>', text: 'hi',
    }));
  });

  it('throws with the Resend-reported error message when the API call itself fails (e.g. unverified domain)', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'noreply@muslimrentals.ca';
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'The muslimrentals.ca domain is not verified.' } });

    const { sendEmail } = await loadEmailModule();
    await expect(sendEmail({ to: 'a@example.com', subject: 'x', html: '<p>x</p>', text: 'x' }))
      .rejects.toThrow('The muslimrentals.ca domain is not verified.');
  });

  // Regression coverage for a real incident: Resend's SDK resolves (never
  // rejects) even when the API call fails -- it returns `{ data: null,
  // error }` instead of throwing. Code that only checks the resolved
  // promise, or checks `data` for truthiness instead of checking `error`,
  // would treat a rejected send as a success. Reproduces the exact error
  // shape Resend returned for an invalid API key against the live backend
  // (confirmed via Render logs: "Failed to send email: API key is invalid
  // {"statusCode":401,"name":"validation_error"}") to guard against this
  // specific case, not just a generic error object.
  it('never logs a successful send or resolves when Resend returns an error, even though the SDK call itself resolves', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'noreply@muslimrentals.ca';
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { statusCode: 401, name: 'validation_error', message: 'API key is invalid' },
    });

    const { sendEmail } = await loadEmailModule();

    await expect(sendEmail({ to: 'a@example.com', subject: 'x', html: '<p>x</p>', text: 'x' })).rejects.toThrow('API key is invalid');
    expect(loggerMock.info).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it('never treats a response with a non-null error as success even if data is also present', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'noreply@muslimrentals.ca';
    // Defensive case: Resend's contract is that `data` and `error` are
    // mutually exclusive, but the check must key off `error` alone --
    // never `if (data) succeed`, which this call would fool.
    sendMock.mockResolvedValueOnce({ data: { id: 'email_123' }, error: { message: 'Unexpected error' } });

    const { sendEmail } = await loadEmailModule();
    await expect(sendEmail({ to: 'a@example.com', subject: 'x', html: '<p>x</p>', text: 'x' })).rejects.toThrow('Unexpected error');
  });
});
