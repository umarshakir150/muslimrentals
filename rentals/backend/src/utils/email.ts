import nodemailer from 'nodemailer';
import { logger } from './logger';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: EmailOptions) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
    });
    logger.info(`Email sent to ${to}: ${subject}`);
  } catch (error) {
    logger.error('Failed to send email:', error);
    throw error;
  }
}

export function passwordResetEmail(name: string, resetUrl: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:linear-gradient(135deg,#0a5c42,#0f7a57);padding:30px;border-radius:12px;text-align:center;margin-bottom:24px">
        <h1 style="color:white;margin:0;font-size:24px">☾ Muslim Rentals</h1>
      </div>
      <h2 style="color:#12201a">Password Reset Request</h2>
      <p style="color:#5a6e63">Assalamu alaikum ${name},</p>
      <p style="color:#5a6e63">You requested a password reset. Click the button below to create a new password. This link expires in 1 hour.</p>
      <div style="text-align:center;margin:30px 0">
        <a href="${resetUrl}" style="background:#0a5c42;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700">Reset Password</a>
      </div>
      <p style="color:#5a6e63;font-size:14px">If you did not request this, please ignore this email. Your account is secure.</p>
      <hr style="border:none;border-top:1px solid #e0ece5;margin:24px 0"/>
      <p style="color:#aaa;font-size:12px;text-align:center">Muslim Rentals · support@muslimrentals.ca</p>
    </div>
  `;
}

export function welcomeEmail(name: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:linear-gradient(135deg,#0a5c42,#0f7a57);padding:30px;border-radius:12px;text-align:center;margin-bottom:24px">
        <h1 style="color:white;margin:0;font-size:24px">☾ Muslim Rentals</h1>
      </div>
      <h2 style="color:#12201a">Welcome to Muslim Rentals!</h2>
      <p style="color:#5a6e63">Assalamu alaikum ${name},</p>
      <p style="color:#5a6e63">Jazakallahu khayran for joining Muslim Rentals — Canada's Muslim-focused rental platform. You can now browse and post rentals, message landlords, and find housing near your local masjid.</p>
      <div style="text-align:center;margin:30px 0">
        <a href="${process.env.FRONTEND_URL}" style="background:#0a5c42;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700">Explore Listings</a>
      </div>
      <p style="color:#5a6e63;font-size:14px">May Allah grant you a blessed and comfortable home. آمين</p>
    </div>
  `;
}
