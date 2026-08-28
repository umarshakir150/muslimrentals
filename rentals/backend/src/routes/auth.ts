/**
 * Auth routes
 * OWASP A07 – Identification and Authentication Failures
 *
 * Security measures:
 *  - authRateLimiter on all mutation endpoints (brute-force protection)
 *  - Strict Zod schemas with exact field allowlists (no extra fields pass through)
 *  - bcrypt cost factor 12 (≈300ms on modern hardware — acceptable for auth)
 *  - Refresh tokens stored as httpOnly, Secure, SameSite=Strict cookies
 *  - Refresh token rotation: each /refresh issues a new token and invalidates the old
 *  - Forgot-password always returns 200 (prevents email enumeration)
 *  - Password reset tokens are 32-byte CSPRNG hex, expire in 1 hour
 *  - Google OAuth: token verified server-side against known audience
 */
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';

import { prisma } from '../prisma/client';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { sendEmail, passwordResetEmail, welcomeEmail } from '../utils/email';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimiter';
import { AppError } from '../middleware/errorHandler';
import { registerSchema, loginSchema, googleSchema, forgotSchema, resetSchema } from '../validation/authSchemas';

const router = Router();

// OWASP: GOOGLE_CLIENT_ID must come from env — never hardcoded
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Refresh-token cookie options
const COOKIE_OPTIONS = {
  httpOnly: true,                                          // not accessible via JS
  secure: process.env.NODE_ENV === 'production',          // HTTPS only in prod
  sameSite: 'strict' as const,                            // CSRF protection
  maxAge: 7 * 24 * 60 * 60 * 1000,                        // 7 days
  path: '/api/v1/auth',                                   // scope cookie to auth routes only
};

// ─── POST /auth/register ──────────────────────────────────────────────────────
router.post('/register', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('An account with this email already exists.', 409);

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true },
    });

    const accessToken  = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);
    sendEmail({ to: email, subject: 'Welcome to Muslim Rentals', html: welcomeEmail(name) }).catch(() => {});

    res.status(201).json({ success: true, data: { user, accessToken } });
  } catch (err) { next(err); }
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post('/login', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true, name: true, email: true, role: true, avatarUrl: true,
        passwordHash: true, isActive: true, isBanned: true, createdAt: true,
      },
    });

    // OWASP: same error message for "not found" and "wrong password" to prevent enumeration
    if (!user || !user.passwordHash) throw new AppError('Invalid email or password.', 401);
    if (!user.isActive)               throw new AppError('Account is inactive.', 401);
    if (user.isBanned)                throw new AppError('Account suspended. Contact support@muslimrentals.ca', 403);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError('Invalid email or password.', 401);

    const { passwordHash: _, ...safeUser } = user;
    const accessToken  = signAccessToken(safeUser);
    const refreshToken = signRefreshToken(safeUser);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);
    res.json({ success: true, data: { user: safeUser, accessToken } });
  } catch (err) { next(err); }
});

// ─── POST /auth/google ────────────────────────────────────────────────────────
router.post('/google', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { credential } = googleSchema.parse(req.body);

    // Verify the token server-side — never trust the client payload alone
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload?.email) throw new AppError('Invalid Google token.', 401);

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId: payload.sub }, { email: payload.email }] },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          name:       payload.name || payload.email.split('@')[0],
          email:      payload.email,
          googleId:   payload.sub,
          avatarUrl:  payload.picture,
          isVerified: true,
        },
        select: { id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true },
      });
      sendEmail({ to: payload.email, subject: 'Welcome to Muslim Rentals', html: welcomeEmail(user.name) }).catch(() => {});
    } else {
      await prisma.user.update({ where: { id: user.id }, data: { googleId: payload.sub, avatarUrl: payload.picture } });
    }

    const accessToken  = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);
    res.json({ success: true, data: { user, accessToken } });
  } catch (err) { next(err); }
});

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) throw new AppError('No refresh token.', 401);

    const payload = verifyRefreshToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true, name: true, email: true, role: true, avatarUrl: true,
        refreshToken: true, isActive: true, isBanned: true, createdAt: true,
      },
    });

    // Validate stored token matches — prevents reuse of rotated tokens
    if (!user || user.refreshToken !== token) throw new AppError('Invalid refresh token.', 401);
    if (!user.isActive || user.isBanned)      throw new AppError('Account suspended.', 403);

    const { refreshToken: _, ...safeUser } = user;
    const accessToken    = signAccessToken(safeUser);
    const newRefreshToken = signRefreshToken(safeUser);

    // Rotate: invalidate old token, issue new one
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: newRefreshToken } });

    res.cookie('refreshToken', newRefreshToken, COOKIE_OPTIONS);
    res.json({ success: true, data: { accessToken } });
  } catch (err) { next(err); }
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
router.post('/logout', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Invalidate stored refresh token so it cannot be reused
    await prisma.user.update({ where: { id: req.user!.id }, data: { refreshToken: null } });
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) { next(err); }
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true, name: true, email: true, role: true, avatarUrl: true,
        phone: true, bio: true, isVerified: true, createdAt: true,
      },
    });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

// ─── POST /auth/forgot-password ───────────────────────────────────────────────
router.post('/forgot-password', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = forgotSchema.parse(req.body);

    // Always return the same response to prevent email enumeration (OWASP A07)
    const SAFE_RESPONSE = { success: true, message: 'If an account exists, a reset link has been sent.' };

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json(SAFE_RESPONSE);

    const resetToken       = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({ where: { id: user.id }, data: { resetToken, resetTokenExpiry } });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    // Fire-and-forget, matching /register's welcome email: a real user's
    // reset token is already saved above regardless of email delivery, so
    // an SMTP failure (e.g. not configured yet) must never 500 this request
    // -- that would leak "this email has an account" via a different status
    // code, defeating SAFE_RESPONSE's anti-enumeration purpose, and would
    // break the flow for every real user until SMTP is configured.
    sendEmail({
      to: email,
      subject: 'Reset your Muslim Rentals password',
      html: passwordResetEmail(user.name, resetUrl),
    }).catch(() => {});

    res.json(SAFE_RESPONSE);
  } catch (err) { next(err); }
});

// ─── POST /auth/reset-password ────────────────────────────────────────────────
router.post('/reset-password', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, password } = resetSchema.parse(req.body);

    const user = await prisma.user.findFirst({
      where: { resetToken: token, resetTokenExpiry: { gt: new Date() } },
    });

    if (!user) throw new AppError('Invalid or expired reset token.', 400);

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpiry: null, refreshToken: null },
    });

    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    res.json({ success: true, message: 'Password reset successfully. Please log in.' });
  } catch (err) { next(err); }
});

export default router;
