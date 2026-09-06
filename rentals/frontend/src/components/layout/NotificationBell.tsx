'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { usersApi } from '@/lib/api';
import { connectSocket } from '@/lib/socket';
import { useUser } from '@/store/authStore';
import { formatTimeAgo, cn } from '@/lib/utils';
import { Notification } from '@/types';

// Where clicking a notification should take the user, keyed by its `type`.
// Every current listing notification (LISTING_SAVED/REMOVED/RESTORED) is
// about the recipient's OWN listing, so My Listings is always the correct
// destination -- unlike /browse or /map, it's never filtered/paginated in a
// way that could hide the listing, and it works even for a REMOVED listing
// that no longer appears in any public listing query. ?listingId= there
// opens that one listing's detail (see app/my-listings/page.tsx), with the
// same "not found" graceful fallback /map's existing ?listingId= deep link
// already established.
function hrefFor(n: Notification): string | null {
  const data = n.data as Record<string, unknown> | undefined;
  switch (n.type) {
    case 'NEW_MESSAGE': {
      const conversationId = data?.conversationId;
      return typeof conversationId === 'string' ? `/messages?conv=${conversationId}` : '/messages';
    }
    case 'LISTING_SAVED':
    case 'LISTING_REMOVED':
    case 'LISTING_RESTORED': {
      const listingId = data?.listingId;
      return typeof listingId === 'string' ? `/my-listings?listingId=${listingId}` : '/my-listings';
    }
    default:
      // An unrecognized type (e.g. added server-side before the frontend
      // knows about it) still renders and is still markable-read -- it
      // just isn't clickable to anywhere in particular.
      return null;
  }
}

export default function NotificationBell() {
  const user = useUser();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const refreshUnreadCount = useCallback(() => {
    usersApi.getNotificationsUnreadCount().then(r => setUnreadCount(r.data.count)).catch(() => {});
  }, []);

  // Same polling pattern as the Messages icon's unread count in Navbar --
  // a fallback resync in case a live 'notification:new' event is ever
  // missed (e.g. briefly disconnected), not the primary update path.
  useEffect(() => {
    if (!user) return;
    refreshUnreadCount();
    const interval = setInterval(refreshUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [user, refreshUnreadCount]);

  // Live updates: every authenticated connection already joins its own
  // `user:${userId}` room (see socket/socketServer.ts) and every
  // createNotification() call server-side emits 'notification:new' there --
  // this just listens for it, the same socket Inbox.tsx also uses.
  useEffect(() => {
    if (!user) return;
    const socket = connectSocket();

    function handleNew(notification: Notification) {
      setNotifications(prev => (prev.some(n => n.id === notification.id) ? prev : [notification, ...prev]));
      setUnreadCount(prev => prev + 1);
    }

    socket.on('notification:new', handleNew);
    return () => { socket.off('notification:new', handleNew); };
  }, [user]);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !loadedOnce) {
      setLoading(true);
      usersApi.getNotifications()
        .then(r => { setNotifications(r.data); setLoadedOnce(true); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }

  function handleSelect(n: Notification) {
    setOpen(false);
    if (!n.isRead) {
      setNotifications(prev => prev.map(x => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnreadCount(prev => Math.max(0, prev - 1));
      usersApi.markNotificationRead(n.id).catch(() => {});
    }
    const href = hrefFor(n);
    if (href) router.push(href);
  }

  function handleMarkAllRead() {
    if (unreadCount === 0) return;
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnreadCount(0);
    usersApi.markAllNotificationsRead().catch(() => {});
  }

  if (!user) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={toggleOpen}
        aria-label="Notifications"
        className="relative p-2.5 rounded-full hover:bg-brand-50 transition-colors"
      >
        <Bell size={20} className="text-muted" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] bg-white border border-ink/8 rounded-2xl shadow-elevated overflow-hidden z-50"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-ink/6">
              <p className="font-semibold text-sm">Notifications</p>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800"
                >
                  <CheckCheck size={13} /> Mark all read
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={20} className="animate-spin text-muted" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="text-center py-10 px-4">
                  <Bell size={24} className="mx-auto mb-2 opacity-20" />
                  <p className="text-sm text-muted">No notifications yet.</p>
                </div>
              ) : (
                notifications.map(n => (
                  <button
                    key={n.id}
                    onClick={() => handleSelect(n)}
                    className={cn(
                      'w-full text-left px-4 py-3 border-b border-ink/6 last:border-b-0 hover:bg-brand-50/60 transition-colors',
                      !n.isRead && 'bg-brand-50/40'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!n.isRead && <span className="w-2 h-2 rounded-full bg-brand-600 mt-1.5 shrink-0" />}
                      <div className={cn('min-w-0 flex-1', n.isRead && 'pl-4')}>
                        <p className="text-sm font-semibold truncate">{n.title}</p>
                        <p className="text-xs text-muted line-clamp-2">{n.body}</p>
                        <p className="text-[11px] text-muted/70 mt-0.5">{formatTimeAgo(n.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
