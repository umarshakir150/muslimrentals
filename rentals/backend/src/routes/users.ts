/**
 * Users routes
 * OWASP A01 – Broken Access Control / A03 – Injection
 *
 * Security measures:
 *  - /me routes require authentication
 *  - Public profile (:id) only exposes safe fields
 *  - UUID validated on :id param
 *  - .strict() schemas reject extra fields
 *  - writeRateLimiter on mutations
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { ListingStatus, ReportTargetType, ReportQualifyingInteraction } from '@prisma/client';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '../prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validateUuidParam } from '../middleware/validateUuid';
import { writeRateLimiter } from '../middleware/rateLimiter';
import { logger } from '../utils/logger';
import { sendEmail, emailChangeVerificationEmail, emailChangeVerificationEmailText } from '../utils/email';
import { userReportSchema } from '../validation/reportSchemas';
import { toPublicListingLocation } from '../utils/geo';

const router = Router();

// S3 is optional-with-warning, same guard as uploads.ts/listings.ts -- this
// route must still work (DB rows are the source of truth) even if AWS/R2
// isn't configured; avatar removal just skips the best-effort object cleanup.
const AWS_CONFIGURED = Boolean(
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET
);
const s3 = AWS_CONFIGURED
  ? new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    })
  : null;

// ─── Input schemas ────────────────────────────────────────────────────────────

// Deliberately permissive about formatting (spaces/hyphens/parens/leading +)
// since this app has no single target country for phone numbers, but still
// requires a plausible number of actual digits -- rejects obvious garbage
// ("abc", a single digit) without rejecting real international numbers.
const PHONE_RE = /^\+?[0-9\s().-]{7,20}$/;
const phoneSchema = z.string().trim().max(20).refine(
  v => PHONE_RE.test(v) && v.replace(/\D/g, '').length >= 7,
  { message: 'Enter a valid phone number.' }
);

const updateProfileSchema = z.object({
  name:  z.string().min(2).max(80).trim().optional(),
  phone: z.union([phoneSchema, z.literal('')]).optional(),
  bio:   z.string().max(500).trim().optional(),
}).strict();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword:     z.string().min(8).max(128),
}).strict();

const emailChangeRequestSchema = z.object({
  newEmail:        z.string().email().max(254).toLowerCase().trim(),
  currentPassword: z.string().max(128).optional(),
}).strict();

const emailChangeConfirmSchema = z.object({
  token: z.string().length(64), // 32 bytes = 64 hex chars, matches resetToken's format
}).strict();

const deleteAccountSchema = z.object({
  // Exactly one of these is required, depending on whether the account has
  // a password -- enforced in the handler once we know which, since Zod
  // alone can't see the DB. A Google-only account (no passwordHash) has
  // nothing else to re-check besides the caller already holding a valid
  // session, so it confirms by typing its own current email instead.
  currentPassword: z.string().max(128).optional(),
  confirmEmail:    z.string().email().max(254).optional(),
}).strict();

// ─── GET /users/:id — public profile ─────────────────────────────────────────
router.get('/:id', validateUuidParam('id'), async (req, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      // OWASP A01: only expose safe public fields — never email, phone, or passwordHash
      select: {
        id: true, name: true, avatarUrl: true, bio: true, createdAt: true,
        listings: {
          where:   { status: 'ACTIVE' },
          include: { images: { take: 1 } },
          orderBy: { createdAt: 'desc' },
          take: 12,
        },
      },
    });
    if (!user) throw new AppError('User not found.', 404);
    // Fully public, unauthenticated route -- never expose a listing's real
    // address/precise coordinates here, same privacy-safe approximate
    // location the public browse/map/detail responses already use.
    res.json({
      success: true,
      data: { ...user, listings: user.listings.map(toPublicListingLocation) },
    });
  } catch (err) { next(err); }
});

// ─── POST /users/:id/report ───────────────────────────────────────────────────
// Object-level authorization:
//  - Who can create it? Any authenticated user EXCEPT the target themselves
//    (self-report blocked), and only if a real prior marketplace
//    interaction exists (mandatory founder constraint, not optional
//    hardening -- see task record appr_ab411474-e4d4-4742-9ed8-f28a463d1d5d).
//    This is NOT an open report-any-user endpoint.
//  - Qualifying interaction (checked server-side against the DB, never
//    inferred from the request): (a) reporter and target already share a
//    Conversation as participants, OR (b) the target owns a Listing that
//    the reporter has a real interaction with -- an existing conversation
//    about that listing, or the reporter has saved it. Whichever path
//    passed is persisted on the Report row (`qualifyingInteraction`) as a
//    plain enum scalar -- evidence for moderators reviewing the report, see
//    GET /admin/reports and admin/page.tsx (which compares it directly, not
//    as a nested object -- keep both sides in sync if this shape changes).
//  - Who can read it? Nobody via this route -- {success, message} only,
//    matching the existing listing-report shape (no enumeration of
//    existing reports against a target).
//  - Ownership/manipulation: :id is UUID-validated; the target's existence
//    and every interaction check are re-verified server-side.
router.post('/:id/report', validateUuidParam('id'), authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reason, description } = userReportSchema.parse(req.body);
    const targetId = req.params.id;

    if (targetId === req.user!.id) {
      throw new AppError('You cannot report yourself.', 400);
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!targetUser) throw new AppError('User not found.', 404);

    const [sharedConversation, listingMessaged, listingSaved] = await Promise.all([
      // (a) reporter and target already share a conversation
      prisma.conversation.findFirst({
        where: {
          AND: [
            { participants: { some: { userId: req.user!.id } } },
            { participants: { some: { userId: targetId } } },
          ],
        },
        select: { id: true },
      }),
      // (b) target owns a listing the reporter messaged about
      prisma.listing.findFirst({
        where: {
          userId: targetId,
          conversations: { some: { participants: { some: { userId: req.user!.id } } } },
        },
        select: { id: true },
      }),
      // (c) target owns a listing the reporter saved
      prisma.listing.findFirst({
        where: {
          userId: targetId,
          savedBy: { some: { userId: req.user!.id } },
        },
        select: { id: true },
      }),
    ]);

    // Recorded as evidence for moderators reviewing the report -- which of
    // the three qualifying paths actually passed, in the same precedence
    // the gate itself uses below.
    const qualifyingInteraction = sharedConversation
      ? ReportQualifyingInteraction.SHARED_CONVERSATION
      : listingMessaged
      ? ReportQualifyingInteraction.LISTING_MESSAGED
      : listingSaved
      ? ReportQualifyingInteraction.LISTING_SAVED
      : null;

    if (!qualifyingInteraction) {
      throw new AppError(
        'You can only report a user you have interacted with on the marketplace (a shared conversation or a listing of theirs you messaged about or saved).',
        403
      );
    }

    await prisma.report.create({
      data: {
        reporterId:     req.user!.id,
        targetType:     ReportTargetType.USER,
        reportedUserId: targetId,
        reason,
        description,
        qualifyingInteraction,
      },
    });

    res.json({ success: true, message: 'Report submitted. Our team reviews reports as soon as possible.' });
  } catch (err) { next(err); }
});

// ─── PATCH /users/me — update profile ─────────────────────────────────────────
router.patch('/me', authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = updateProfileSchema.parse(req.body);

    const user = await prisma.user.update({
      where:  { id: req.user!.id },
      data,
      select: { id: true, name: true, email: true, phone: true, bio: true, avatarUrl: true, role: true },
    });

    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

// ─── POST /users/me/change-password ───────────────────────────────────────────
router.post('/me/change-password', authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where:  { id: req.user!.id },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash) throw new AppError('No password set (Google account).', 400);

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError('Current password is incorrect.', 400);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash } });

    res.json({ success: true, message: 'Password updated.' });
  } catch (err) { next(err); }
});

// ─── GET /users/me/saved ──────────────────────────────────────────────────────
router.get('/me/saved', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const saved = await prisma.savedListing.findMany({
      // Exclude listings that were later removed/deactivated so the saved list
      // never surfaces de-listed content or dead links (mirrors GET /listings).
      where:   { userId: req.user!.id, listing: { status: ListingStatus.ACTIVE } },
      include: {
        listing: {
          include: {
            images:    { take: 1 },
            amenities: { select: { name: true } },
            user:      { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({
      success: true,
      // Every row here is, by definition, saved by the current user — set isSaved
      // explicitly so ListingCard's heart toggle renders correctly on first paint.
      // Saving a listing doesn't make it "yours" (it's someone else's, browsed
      // and bookmarked) so, like GET /listings, its real address/coordinates
      // stay redacted here regardless of who's viewing.
      data: saved.map(s => ({
        ...toPublicListingLocation(s.listing),
        amenities: s.listing.amenities.map(a => a.name),
        thumbnailUrl: s.listing.images[0]?.url || null,
        isSaved: true,
      })),
    });
  } catch (err) { next(err); }
});

// ─── GET /users/me/listings ───────────────────────────────────────────────────
router.get('/me/listings', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listings = await prisma.listing.findMany({
      where:   { userId: req.user!.id },
      include: {
        images:    { take: 1 },
        amenities: { select: { name: true } },
        user:      { select: { id: true, name: true, avatarUrl: true } },
        _count:    { select: { savedBy: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      success: true,
      data: listings.map(l => ({
        ...l,
        amenities:    l.amenities.map(a => a.name),
        thumbnailUrl: l.images[0]?.url || null,
      })),
    });
  } catch (err) { next(err); }
});

// ─── GET /users/me/notifications ─────────────────────────────────────────────
router.get('/me/notifications', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const notifs = await prisma.notification.findMany({
      where:   { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: notifs });
  } catch (err) { next(err); }
});

// ─── DELETE /users/me/avatar — remove profile picture ─────────────────────────
router.delete('/me/avatar', authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { avatarKey: true } });

    // Best-effort R2/S3 cleanup, same pattern as listings' permanent delete --
    // never let a storage hiccup block the user from clearing their avatar.
    // avatarKey is only ever set for our own uploads (never a Google avatar),
    // so this never attempts to delete something we don't own.
    if (s3 && user?.avatarKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET!, Key: user.avatarKey }));
      } catch (e) {
        logger.warn(`Failed to delete S3 avatar object for user ${req.user!.id}: ${e}`);
      }
    }

    await prisma.user.update({ where: { id: req.user!.id }, data: { avatarUrl: null, avatarKey: null } });
    res.json({ success: true, message: 'Profile picture removed.' });
  } catch (err) { next(err); }
});

// ─── POST /users/me/email-change-request ───────────────────────────────────────
// Never changes `email` directly -- stores the request as pendingEmail and
// emails a confirmation link to the NEW address. The change only takes
// effect once that link is used (see /email-change-confirm), so a typo or a
// malicious request can never silently take over the login email.
router.post('/me/email-change-request', authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { newEmail, currentPassword } = emailChangeRequestSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where:  { id: req.user!.id },
      select: { email: true, passwordHash: true },
    });
    if (!user) throw new AppError('User not found.', 404);

    if (newEmail === user.email) throw new AppError('That is already your current email.', 400);

    // Re-authentication for a sensitive change. A Google-only account (no
    // passwordHash) has nothing else to check beyond the caller already
    // holding a valid session -- there is no separate "Google password" to
    // re-enter, and OAuth identity is anchored to googleId, not this field
    // (see the account-deletion section below for the same reasoning).
    if (user.passwordHash) {
      if (!currentPassword) throw new AppError('Current password is required.', 400);
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) throw new AppError('Current password is incorrect.', 400);
    }

    const [emailTaken, pendingTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } }),
      prisma.user.findFirst({ where: { pendingEmail: newEmail, pendingEmailTokenExpiry: { gt: new Date() } }, select: { id: true } }),
    ]);
    if (emailTaken || pendingTaken) throw new AppError('That email is already in use.', 409);

    const pendingEmailToken       = crypto.randomBytes(32).toString('hex');
    const pendingEmailTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour, matches password-reset tokens

    await prisma.user.update({
      where: { id: req.user!.id },
      data:  { pendingEmail: newEmail, pendingEmailToken, pendingEmailTokenExpiry },
    });

    const confirmUrl = `${process.env.FRONTEND_URL}/confirm-email?token=${pendingEmailToken}`;
    // Fire-and-forget, matching the rest of this codebase's email sends --
    // the pending request is already saved above regardless of delivery.
    sendEmail({
      to: newEmail,
      subject: 'Confirm your new email — Muslim Rentals',
      html: emailChangeVerificationEmail(req.user!.name, newEmail, confirmUrl),
      text: emailChangeVerificationEmailText(req.user!.name, newEmail, confirmUrl),
    }).catch(() => {});

    res.json({ success: true, message: `A confirmation link was sent to ${newEmail}.` });
  } catch (err) { next(err); }
});

// ─── POST /users/me/email-change-confirm ───────────────────────────────────────
// Deliberately NOT behind `authenticate`, unlike every other /me route: the
// confirmation link is opened from an email client, which is very often a
// different browser/device (or the same browser after the access token has
// since expired) than the one that requested the change. The token itself
// (32 random bytes, single-use, 1-hour expiry) is the credential here, same
// as /auth/reset-password's token-only lookup -- requiring a valid session
// on top of it would turn a normal cross-device click into a confusing
// "Session expired" error instead of a clean confirm-or-reject outcome.
router.post('/me/email-change-confirm', writeRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = emailChangeConfirmSchema.parse(req.body);

    const user = await prisma.user.findFirst({
      where: {
        pendingEmailToken:       token,
        pendingEmailTokenExpiry: { gt: new Date() },
      },
      select: { id: true, pendingEmail: true },
    });
    if (!user?.pendingEmail) throw new AppError('Invalid or expired confirmation link.', 400);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        email:                   user.pendingEmail,
        pendingEmail:            null,
        pendingEmailToken:       null,
        pendingEmailTokenExpiry: null,
      },
      select: { id: true, name: true, email: true, phone: true, bio: true, avatarUrl: true, role: true },
    });

    res.json({ success: true, data: updated, message: 'Email updated.' });
  } catch (err) {
    // A duplicate-email race (two confirmations for the same address) surfaces
    // as Prisma's unique-constraint error -- report it clearly rather than 500.
    if ((err as any)?.code === 'P2002') return next(new AppError('That email is already in use.', 409));
    next(err);
  }
});

// ─── DELETE /users/me — delete account ─────────────────────────────────────────
// Irreversible. Anonymizes rather than hard-deletes the User row: the schema
// cascades Message.senderId and ConversationParticipant on a real row
// delete, which would silently blow holes in *other* users' conversation
// history (their messages from this user would simply vanish). Instead:
//  - listings soft-removed (existing REMOVED status -- already excluded from
//    every public listing query, same as an owner-initiated removal)
//  - avatar's R2 object deleted (best-effort, only if we own it)
//  - purely private rows (saved listings, notifications) hard-deleted
//  - the User row itself is scrubbed, not deleted: passwordHash/refreshToken/
//    resetToken/pendingEmail* all cleared and isActive set false, which
//    (combined with authenticate's per-request isActive check and /auth's
//    isActive checks on login/refresh/google) blocks every future
//    authentication path for this account, immediately -- not just future
//    logins, but any still-valid access token this session already holds.
//  - googleId is deliberately left in place: nulling it would let whoever
//    holds that Google account silently register a brand-new account
//    instead of hitting a clear "this account is no longer available" error
//    on their next Google sign-in attempt.
//  - any currently-connected Socket.IO session for this user is force-
//    disconnected, so a real-time session already open before deletion
//    doesn't keep working after it.
//  - messages this user already sent are left untouched for the other
//    participant; their sender name is now "Deleted user" (the anonymized
//    name), so existing conversations render that instead of a stale name
//    with no code changes needed on the read side.
router.delete('/me', authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, confirmEmail } = deleteAccountSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where:  { id: req.user!.id },
      select: { email: true, passwordHash: true, avatarKey: true },
    });
    if (!user) throw new AppError('User not found.', 404);

    if (user.passwordHash) {
      if (!currentPassword) throw new AppError('Current password is required.', 400);
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) throw new AppError('Current password is incorrect.', 400);
    } else {
      if (!confirmEmail || confirmEmail.toLowerCase().trim() !== user.email.toLowerCase()) {
        throw new AppError('Type your account email exactly to confirm.', 400);
      }
    }

    if (s3 && user.avatarKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET!, Key: user.avatarKey }));
      } catch (e) {
        logger.warn(`Failed to delete S3 avatar object for user ${req.user!.id} during account deletion: ${e}`);
      }
    }

    // id is a UUID primary key, so this placeholder can never collide with
    // another account's email -- including another deleted account's.
    const placeholderEmail = `deleted-${req.user!.id}@deleted.invalid`;

    await prisma.$transaction([
      prisma.listing.updateMany({
        where: { userId: req.user!.id, status: { not: ListingStatus.REMOVED } },
        data:  { status: ListingStatus.REMOVED, isActive: false },
      }),
      prisma.savedListing.deleteMany({ where: { userId: req.user!.id } }),
      prisma.notification.deleteMany({ where: { userId: req.user!.id } }),
      prisma.user.update({
        where: { id: req.user!.id },
        data: {
          name:                    'Deleted user',
          email:                   placeholderEmail,
          passwordHash:            null,
          avatarUrl:               null,
          avatarKey:               null,
          phone:                   null,
          bio:                     null,
          isActive:                false,
          refreshToken:            null,
          resetToken:              null,
          resetTokenExpiry:        null,
          pendingEmail:            null,
          pendingEmailToken:       null,
          pendingEmailTokenExpiry: null,
        },
      }),
    ]);

    const io = req.app.get('io');
    io?.in(`user:${req.user!.id}`).disconnectSockets(true);

    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    res.json({ success: true, message: 'Your account has been deleted.' });
  } catch (err) { next(err); }
});

export default router;
