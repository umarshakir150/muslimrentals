/**
 * Public contact-form endpoint.
 *
 * The frontend Contact page previously only built a mailto: link -- which
 * silently does nothing if the visitor has no default desktop email client
 * configured (confirmed as the actual cause of a founder-reported "nothing
 * arrived" test: it never touched the backend at all). This delivers the
 * submission via the same Resend/sendEmail() infrastructure already used
 * for password-reset/welcome/email-change emails -- no new provider, no
 * new credential, no env change.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { sendEmail, contactFormEmail, contactFormEmailText } from '../utils/email';
import { AppError } from '../middleware/errorHandler';
import { authRateLimiter } from '../middleware/rateLimiter';
import { contactSchema, CONTACT_SUBJECTS } from '../validation/contactSchemas';

const router = Router();

const CONTACT_INBOX = 'muslimrentals.ca@gmail.com';

const SUBJECT_LABELS: Record<(typeof CONTACT_SUBJECTS)[number], string> = {
  listing: 'Listing issue',
  account: 'Account help',
  safety: 'Safety concern',
  report: 'Report a user',
  other: 'Other',
};

// ─── POST /contact ─────────────────────────────────────────────────────────
router.post('/', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, subject, message } = contactSchema.parse(req.body);
    const subjectLabel = SUBJECT_LABELS[subject];

    // Unlike /auth/forgot-password's fire-and-forget send (which must never
    // reveal whether an account exists -- a secrecy concern that doesn't
    // apply here), this is awaited: the whole point of this endpoint is
    // telling the visitor honestly whether their message actually went
    // out, so a real delivery failure must surface as a real error rather
    // than a silently "successful" response.
    try {
      await sendEmail({
        to: CONTACT_INBOX,
        subject: `[${subjectLabel}] Muslim Rentals contact form`,
        html: contactFormEmail(name, email, subjectLabel, message),
        text: contactFormEmailText(name, email, subjectLabel, message),
      });
    } catch {
      throw new AppError('Could not send your message right now. Please try again in a moment, or email us directly.', 502);
    }

    res.json({ success: true, message: 'Message sent.' });
  } catch (err) { next(err); }
});

export default router;
