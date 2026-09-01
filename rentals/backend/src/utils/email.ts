import { Resend } from 'resend';
import { logger } from './logger';

// Sent over Resend's HTTPS API rather than raw SMTP. Render (like many
// PaaS hosts) blocks outbound SMTP connections entirely as an anti-abuse
// measure -- confirmed directly against this app's own backend: Nodemailer
// timed out at the raw TCP connection stage (ETIMEDOUT/CONN) against Gmail's
// SMTP on both port 587 and 465, never even reaching STARTTLS/AUTH. An
// HTTPS API sidesteps that block entirely, since it's just a normal fetch.
const RESEND_CONFIGURED = Boolean(process.env.RESEND_API_KEY);

const resend = RESEND_CONFIGURED ? new Resend(process.env.RESEND_API_KEY) : null;

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail({ to, subject, html, text }: EmailOptions) {
  if (!resend) {
    // Do not attempt a doomed call -- log once per send with a clear,
    // actionable diagnosis instead of an opaque failure. Callers
    // (register/forgot-password) already treat email as best-effort and
    // never let this block the request.
    logger.warn(
      `Email not sent (RESEND_API_KEY not configured -- set it on the backend host): "${subject}" to ${to}`
    );
    throw new Error('Resend not configured');
  }
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to,
    subject,
    html,
    text,
  });
  if (error) {
    logger.error('Failed to send email:', error);
    throw new Error(error.message || 'Resend API error');
  }
  logger.info(`Email sent to ${to}: ${subject}`);
}

// ─── Shared template chrome ───────────────────────────────────────────────────
// Every transactional email uses the same branded header/footer -- centralised
// here so the three templates below only differ in their actual message.

function emailShell(bodyHtml: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:linear-gradient(135deg,#0a5c42,#0f7a57);padding:30px;border-radius:12px;text-align:center;margin-bottom:24px">
        <h1 style="color:white;margin:0;font-size:24px">☾ Muslim Rentals</h1>
      </div>
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #e0ece5;margin:24px 0"/>
      <p style="color:#aaa;font-size:12px;text-align:center">
        Muslim Rentals · <a href="mailto:support@muslimrentals.ca" style="color:#aaa">support@muslimrentals.ca</a><br/>
        This is an automated message. Please don't reply directly to this email.
      </p>
    </div>
  `;
}

function actionButton(url: string, label: string): string {
  return `
    <div style="text-align:center;margin:30px 0">
      <a href="${url}" style="background:#0a5c42;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">${label}</a>
    </div>
    <p style="color:#8a998f;font-size:13px;word-break:break-all">
      If that button doesn't work, copy and paste this link into your browser:<br/>
      <a href="${url}" style="color:#0a5c42">${url}</a>
    </p>
  `;
}

export function passwordResetEmail(name: string, resetUrl: string): string {
  return emailShell(`
    <h2 style="color:#12201a">Password Reset Request</h2>
    <p style="color:#5a6e63">Assalamu alaikum ${name},</p>
    <p style="color:#5a6e63">We received a request to reset the password on your Muslim Rentals account. Click the button below to create a new password. This link expires in 1 hour and can only be used once.</p>
    ${actionButton(resetUrl, 'Reset Password')}
    <p style="color:#5a6e63;font-size:14px">If you did not request this, no action is needed — your password has not been changed, and this link will simply expire.</p>
  `);
}

export function passwordResetEmailText(name: string, resetUrl: string): string {
  return `Assalamu alaikum ${name},

We received a request to reset the password on your Muslim Rentals account.

Reset your password here (expires in 1 hour, one-time use):
${resetUrl}

If you did not request this, no action is needed — your password has not been changed, and this link will simply expire.

— Muslim Rentals
support@muslimrentals.ca`;
}

export function emailChangeVerificationEmail(name: string, newEmail: string, confirmUrl: string): string {
  return emailShell(`
    <h2 style="color:#12201a">Confirm your new email</h2>
    <p style="color:#5a6e63">Assalamu alaikum ${name},</p>
    <p style="color:#5a6e63">A request was made to change the email on your Muslim Rentals account to <strong>${newEmail}</strong>. Click the button below to confirm this is your email address. This link expires in 1 hour and can only be used once.</p>
    ${actionButton(confirmUrl, 'Confirm new email')}
    <p style="color:#5a6e63;font-size:14px">Your login email will not change until you confirm. If you did not request this, no action is needed — your account is secure and this link will simply expire.</p>
  `);
}

export function emailChangeVerificationEmailText(name: string, newEmail: string, confirmUrl: string): string {
  return `Assalamu alaikum ${name},

A request was made to change the email on your Muslim Rentals account to ${newEmail}.

Confirm this is your email address here (expires in 1 hour, one-time use):
${confirmUrl}

Your login email will not change until you confirm. If you did not request this, no action is needed — your account is secure and this link will simply expire.

— Muslim Rentals
support@muslimrentals.ca`;
}

export function welcomeEmail(name: string): string {
  return emailShell(`
    <h2 style="color:#12201a">Welcome to Muslim Rentals!</h2>
    <p style="color:#5a6e63">Assalamu alaikum ${name},</p>
    <p style="color:#5a6e63">Jazakallahu khayran for joining Muslim Rentals — Canada's Muslim-focused rental platform. You can now browse and post rentals, message landlords, and find housing near your local masjid.</p>
    ${actionButton(process.env.FRONTEND_URL || '', 'Explore Listings')}
    <p style="color:#5a6e63;font-size:14px">May Allah grant you a blessed and comfortable home. آمين</p>
  `);
}

export function welcomeEmailText(name: string): string {
  return `Assalamu alaikum ${name},

Jazakallahu khayran for joining Muslim Rentals — Canada's Muslim-focused rental platform. You can now browse and post rentals, message landlords, and find housing near your local masjid.

Explore listings: ${process.env.FRONTEND_URL || ''}

May Allah grant you a blessed and comfortable home. Ameen.

— Muslim Rentals
support@muslimrentals.ca`;
}
