/**
 * Messages routes
 * OWASP A01 – Broken Access Control
 *
 * Security measures:
 *  - Participant membership verified on every conversation access
 *  - UUIDs validated before queries
 *  - Message body length bounded by Zod
 *  - writeRateLimiter on send-message endpoints
 */
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ReportTargetType } from '@prisma/client';
import { prisma } from '../prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validateUuidParam } from '../middleware/validateUuid';
import { writeRateLimiter } from '../middleware/rateLimiter';
import { messageReportSchema } from '../validation/reportSchemas';

const router = Router();

const startConvSchema = z.object({
  listingId: z.string().uuid(),
  body:      z.string().min(1).max(2000).trim(),
}).strict();

const sendMsgSchema = z.object({
  body: z.string().min(1).max(2000).trim(),
}).strict();

// ─── GET /messages/conversations ─────────────────────────────────────────────
router.get('/conversations', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { participants: { some: { userId: req.user!.id } } },
      include: {
        listing:      { select: { id: true, title: true, price: true, city: true, images: { take: 1 } } },
        participants: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
        messages:     { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { id: true, name: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100, // cap to prevent unbounded response
    });

    const result = await Promise.all(conversations.map(async (conv) => {
      const myParticipant = conv.participants.find(p => p.userId === req.user!.id);
      const unreadCount = await prisma.message.count({
        where: {
          conversationId: conv.id,
          senderId:       { not: req.user!.id },
          isRead:         false,
          ...(myParticipant?.lastReadAt && { createdAt: { gt: myParticipant.lastReadAt } }),
        },
      });
      return { ...conv, unreadCount };
    }));

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ─── GET /messages/conversations/:id ──────────────────────────────────────────
router.get('/conversations/:id', validateUuidParam('id'), authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        listing:      { select: { id: true, title: true, price: true, city: true, audience: true, images: { take: 1 } } },
        participants: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
          take: 500, // cap message history per load
        },
      },
    });

    if (!conv) throw new AppError('Conversation not found.', 404);

    // OWASP A01: verify the requester is a participant
    const isParticipant = conv.participants.some(p => p.userId === req.user!.id);
    if (!isParticipant) throw new AppError('Not authorized.', 403);

    await prisma.message.updateMany({
      where: { conversationId: conv.id, senderId: { not: req.user!.id }, isRead: false },
      data:  { isRead: true },
    });
    await prisma.conversationParticipant.updateMany({
      where: { conversationId: conv.id, userId: req.user!.id },
      data:  { lastReadAt: new Date() },
    });

    res.json({ success: true, data: conv });
  } catch (err) { next(err); }
});

// ─── POST /messages/conversations ─────────────────────────────────────────────
router.post('/conversations', authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { listingId, body } = startConvSchema.parse(req.body);

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, userId: true, title: true },
    });
    if (!listing) throw new AppError('Listing not found.', 404);
    if (listing.userId === req.user!.id) throw new AppError('You cannot message yourself.', 400);

    const existing = await prisma.conversation.findFirst({
      where: {
        listingId,
        participants: { every: { userId: { in: [req.user!.id, listing.userId] } } },
      },
    });

    if (existing) {
      const message = await prisma.message.create({
        data: { conversationId: existing.id, senderId: req.user!.id, body },
        include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
      });
      await prisma.conversation.update({ where: { id: existing.id }, data: { updatedAt: new Date() } });

      const io = req.app.get('io');
      io?.to(`conv:${existing.id}`).emit('message:new', message);

      return res.json({ success: true, data: { conversationId: existing.id, message } });
    }

    const conv = await prisma.conversation.create({
      data: {
        listingId,
        participants: { create: [{ userId: req.user!.id }, { userId: listing.userId }] },
        messages:     { create: { senderId: req.user!.id, body } },
      },
      include: {
        messages:     { include: { sender: { select: { id: true, name: true, avatarUrl: true } } } },
        participants: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
      },
    });

    const io = req.app.get('io');
    io?.to(`user:${listing.userId}`).emit('conversation:new', conv);

    await prisma.notification.create({
      data: {
        userId: listing.userId,
        type:   'NEW_MESSAGE',
        title:  'New message',
        body:   `Someone messaged about your listing: ${listing.title}`,
        data:   { conversationId: conv.id },
      },
    });

    res.status(201).json({ success: true, data: { conversationId: conv.id, message: conv.messages[0] } });
  } catch (err) { next(err); }
});

// ─── POST /messages/conversations/:id/messages ────────────────────────────────
router.post('/conversations/:id/messages', validateUuidParam('id'), authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { body } = sendMsgSchema.parse(req.body);

    const conv = await prisma.conversation.findUnique({
      where:   { id: req.params.id },
      include: { participants: true },
    });
    if (!conv) throw new AppError('Conversation not found.', 404);
    if (!conv.participants.some(p => p.userId === req.user!.id)) throw new AppError('Not authorized.', 403);

    const message = await prisma.message.create({
      data: { conversationId: conv.id, senderId: req.user!.id, body },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
    });

    await prisma.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });

    const io = req.app.get('io');
    io?.to(`conv:${conv.id}`).emit('message:new', message);

    res.status(201).json({ success: true, data: message });
  } catch (err) { next(err); }
});

// ─── POST /messages/:id/report ────────────────────────────────────────────────
// Object-level authorization:
//  - Who can create it? Any authenticated conversation participant, except
//    the message's own sender (self-report blocked below).
//  - Who can read it? Nobody via this route -- only {success, message} is
//    returned, matching the existing listing-report response shape so a
//    caller can never enumerate whether a report already exists.
//  - Ownership/manipulation: :id is validated as a UUID and looked up
//    server-side; participant membership is re-verified against the DB
//    (never trusted from the client), same pattern as every other
//    messages.ts route.
//  - Data integrity: body + senderId are snapshotted into the Report row at
//    creation time (not a live FK lookup done later), since the message can
//    be edited or deleted after the report is filed and messages have no
//    edit/delete audit trail of their own.
router.post('/:id/report', validateUuidParam('id'), authenticate, writeRateLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reason, description } = messageReportSchema.parse(req.body);

    const message = await prisma.message.findUnique({
      where:   { id: req.params.id },
      include: { conversation: { include: { participants: true } } },
    });
    if (!message) throw new AppError('Message not found.', 404);

    const isParticipant = message.conversation.participants.some(p => p.userId === req.user!.id);
    if (!isParticipant) throw new AppError('Not authorized.', 403);

    if (message.senderId === req.user!.id) {
      throw new AppError('You cannot report your own message.', 400);
    }

    await prisma.report.create({
      data: {
        reporterId:      req.user!.id,
        targetType:      ReportTargetType.MESSAGE,
        messageId:       message.id,
        messageSnapshot: message.body,
        reportedUserId:  message.senderId,
        reason,
        description,
      },
    });

    res.json({ success: true, message: 'Report submitted. We review all reports within 24 hours.' });
  } catch (err) { next(err); }
});

// ─── GET /messages/unread-count ───────────────────────────────────────────────
router.get('/unread-count', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const count = await prisma.message.count({
      where: {
        conversation: { participants: { some: { userId: req.user!.id } } },
        senderId:     { not: req.user!.id },
        isRead:       false,
      },
    });
    res.json({ success: true, data: { count } });
  } catch (err) { next(err); }
});

export default router;
