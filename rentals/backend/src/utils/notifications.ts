/**
 * Server-side notification creation, shared across every event site that
 * needs it (listing saves, new messages, moderator remove/restore). The
 * Notification model, its GET /users/me/notifications read route, and the
 * per-user Socket.IO room (`user:${userId}`, joined by every authenticated
 * connection -- see socket/socketServer.ts) already existed; this is the
 * one place that actually writes a row and pushes it live, so every future
 * event type gets both halves (DB row + live push) automatically instead of
 * a call site remembering to do both separately.
 *
 * Deliberately server-only: nothing here is reachable from a client-supplied
 * payload. Every call site computes `userId`/`type`/`title`/`body`/`data`
 * itself from data it already trusts (its own DB reads, its own
 * authenticated req.user), never from request input.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client';

// Kept as a plain string union (matches Notification.type's actual column,
// a plain String, not a Prisma enum) rather than adding a schema enum for
// this -- the founder's ask ("do not make unrelated schema changes unless
// inspection proves necessary") and the existing model already being
// untyped `String` on this column both point the same way.
export type NotificationType = 'LISTING_SAVED' | 'NEW_MESSAGE' | 'LISTING_REMOVED' | 'LISTING_RESTORED';

export interface CreateNotificationInput {
  // Untyped to match every existing `req.app.get('io')` call site in this
  // codebase (index.ts sets it with `app.set('io', io)`, and nothing types
  // that getter) -- not worth introducing a stricter type here alone.
  io: any;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  // IDs only, for client-side deep-linking (e.g. { conversationId } or
  // { listingId }) -- never a private address, exact coordinate, email, or
  // moderation-internal detail. Callers are responsible for keeping to
  // that; this function does not (and cannot) inspect the shape.
  data?: Record<string, unknown>;
}

export async function createNotification({ io, userId, type, title, body, data }: CreateNotificationInput) {
  const notification = await prisma.notification.create({
    data: { userId, type, title, body, data: (data ?? undefined) as Prisma.InputJsonValue | undefined },
  });
  io?.to(`user:${userId}`).emit('notification:new', notification);
  return notification;
}

// True if any of `userId`'s currently-connected sockets are joined to the
// given conversation's Socket.IO room -- i.e. they already have that exact
// conversation open in real time. Backed entirely by the `conv:${id}` room
// Inbox.tsx already joins/leaves on opening/closing a conversation (see
// socket/socketServer.ts's 'conversation:join'/'conversation:leave'
// handlers, and Inbox.tsx's openConversation/cleanup) -- not a new
// presence-tracking mechanism, just reading the one that already exists
// for an unrelated purpose (join notifications, typing indicators).
//
// This is a real, direct check of live server state (Socket.IO's own room
// adapter), not a heuristic or a client-reported claim -- a client cannot
// spoof "I am viewing this conversation" to suppress someone else's
// notification, since room membership is entirely server-controlled by
// which authenticated socket actually joined it.
export function isUserViewingConversation(io: any, userId: string, conversationId: string): boolean {
  if (!io) return false;
  const room = io.sockets?.adapter?.rooms?.get(`conv:${conversationId}`);
  if (!room) return false;
  for (const socketId of room) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket?.userId === userId) return true;
  }
  return false;
}
