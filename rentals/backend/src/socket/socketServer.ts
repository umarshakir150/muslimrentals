/**
 * Socket.IO server
 * OWASP A01 – Broken Access Control / A07 – Authentication Failures
 *
 * Security measures:
 *  - Every socket connection requires a valid JWT (authentication middleware)
 *  - Banned/inactive accounts are disconnected on connect
 *  - Conversation room joins are DB-verified (participant check)
 *  - Input payloads are type-checked and length-bounded
 *  - Socket max buffer size capped in index.ts (100 kB)
 */
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../prisma/client';
import { logger } from '../utils/logger';

interface AuthSocket extends Socket {
  userId?:  string;
  userName?: string;
}

// Payload schemas for socket events
const convIdSchema      = z.string().uuid();
const typingSchema      = z.object({ conversationId: z.string().uuid() }).strict();
const msgsReadSchema    = z.object({ conversationId: z.string().uuid() }).strict();

export function setupSocketIO(io: Server) {
  // ─── Auth middleware ────────────────────────────────────────────────────────
  io.use(async (socket: AuthSocket, next) => {
    try {
      // Accept token from handshake auth object or Authorization header
      const rawToken =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

      if (!rawToken || typeof rawToken !== 'string') {
        return next(new Error('Authentication required.'));
      }

      const payload = verifyAccessToken(rawToken);

      const user = await prisma.user.findUnique({
        where:  { id: payload.userId },
        select: { id: true, name: true, isActive: true, isBanned: true },
      });

      if (!user || !user.isActive || user.isBanned) {
        return next(new Error('Account not available.'));
      }

      socket.userId   = user.id;
      socket.userName = user.name;
      next();
    } catch {
      next(new Error('Invalid or expired token.'));
    }
  });

  io.on('connection', (socket: AuthSocket) => {
    logger.info(`Socket connected: ${socket.userId} (${socket.id})`);

    // Join personal room for direct notifications
    socket.join(`user:${socket.userId}`);

    // ─── Join conversation room ─────────────────────────────────────────────
    socket.on('conversation:join', async (rawId: unknown) => {
      try {
        const conversationId = convIdSchema.parse(rawId);

        // Verify membership in DB before joining the room
        const participant = await prisma.conversationParticipant.findUnique({
          where: { conversationId_userId: { conversationId, userId: socket.userId! } },
        });
        if (!participant) {
          return socket.emit('error', { message: 'Not authorized.' });
        }

        socket.join(`conv:${conversationId}`);
      } catch {
        socket.emit('error', { message: 'Invalid conversation ID.' });
      }
    });

    // ─── Leave conversation room ────────────────────────────────────────────
    socket.on('conversation:leave', (rawId: unknown) => {
      try {
        const conversationId = convIdSchema.parse(rawId);
        socket.leave(`conv:${conversationId}`);
      } catch {} // Ignore invalid UUIDs silently
    });

    // ─── Typing indicators ──────────────────────────────────────────────────
    socket.on('typing:start', (raw: unknown) => {
      try {
        const { conversationId } = typingSchema.parse(raw);
        socket.to(`conv:${conversationId}`).emit('typing:start', {
          userId:   socket.userId,
          userName: socket.userName,
        });
      } catch {}
    });

    socket.on('typing:stop', (raw: unknown) => {
      try {
        const { conversationId } = typingSchema.parse(raw);
        socket.to(`conv:${conversationId}`).emit('typing:stop', { userId: socket.userId });
      } catch {}
    });

    // ─── Mark messages as read ──────────────────────────────────────────────
    socket.on('messages:read', async (raw: unknown) => {
      try {
        const { conversationId } = msgsReadSchema.parse(raw);

        // Verify the socket user is a participant before marking read
        const participant = await prisma.conversationParticipant.findUnique({
          where: { conversationId_userId: { conversationId, userId: socket.userId! } },
        });
        if (!participant) return;

        await prisma.message.updateMany({
          where: { conversationId, senderId: { not: socket.userId! }, isRead: false },
          data:  { isRead: true },
        });
        await prisma.conversationParticipant.updateMany({
          where: { conversationId, userId: socket.userId! },
          data:  { lastReadAt: new Date() },
        });

        socket.to(`conv:${conversationId}`).emit('messages:read', {
          userId: socket.userId,
          conversationId,
        });
      } catch {}
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.userId} (${socket.id})`);
    });
  });
}
