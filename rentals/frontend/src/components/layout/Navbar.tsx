'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Menu, X, LogOut, User, Settings, BookmarkIcon, Home } from 'lucide-react';
import { useAuthStore, useUser } from '@/store/authStore';
import { authApi, messagesApi } from '@/lib/api';
import { cn, initials } from '@/lib/utils';
import AuthModal from '@/components/auth/AuthModal';
import NotificationBell from '@/components/layout/NotificationBell';

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useUser();
  const { clearAuth } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  useEffect(() => {
    if (!user) return;
    messagesApi.getUnreadCount().then(r => setUnreadCount(r.data.count)).catch(() => {});
    const interval = setInterval(() => {
      messagesApi.getUnreadCount().then(r => setUnreadCount(r.data.count)).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // The account dropdown used to close on mere onMouseLeave, so simply
  // moving the mouse off it (not clicking anything) would dismiss it --
  // reported as unwanted. It now closes only on an explicit outside
  // click/tap, Escape, the trigger being clicked again (already handled by
  // its own onClick toggle below), or selecting a menu item (each item's
  // own onClick already calls setUserMenuOpen(false)). Scoped to only run
  // while the menu is actually open, and to the wrapping ref (trigger +
  // panel together) so clicking the trigger itself is never mistaken for
  // an "outside" click.
  useEffect(() => {
    if (!userMenuOpen) return;
    function handleOutsideClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [userMenuOpen]);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    clearAuth();
    setUserMenuOpen(false);
    router.push('/');
  };

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/browse', label: 'Browse' },
    { href: '/map', label: 'Map' },
    { href: '/safety', label: 'Safety' },
    { href: '/contact', label: 'Contact' },
  ];

  return (
    <>
      <header className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-200',
        scrolled ? 'bg-surface/95 backdrop-blur-xl border-b border-ink/8 shadow-card' : 'bg-surface/80 backdrop-blur-md'
      )}>
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 h-[72px] flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 font-serif text-xl font-normal tracking-tight shrink-0">
            <div className="w-10 h-10 rounded-[13px] bg-brand-gradient flex items-center justify-center shadow-lg shadow-brand-600/25">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm0 1.5a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm2.5 2a5.5 5.5 0 1 0 .5 9.5A6 6 0 0 1 14.5 5.5z"/>
                <circle cx="17" cy="4" r="1.5" fill="white" stroke="none"/>
              </svg>
            </div>
            <span className="hidden sm:block">muslimrentals.ca</span>
          </Link>

          {/* Desktop Nav Links */}
          <div className="hidden md:flex items-center gap-1 bg-white/60 border border-ink/8 rounded-full px-2 py-1.5">
            {navLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-semibold transition-all duration-150',
                  pathname === link.href ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-brand-50/60 hover:text-brand-700'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {user ? (
              <>
                {/* Messages */}
                <Link href="/messages" className="relative p-2.5 rounded-full hover:bg-brand-50 transition-colors">
                  <MessageSquare size={20} className="text-muted" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Link>

                {/* Notifications */}
                <NotificationBell />

                {/* Mobile menu toggle -- placed here (between Messages and the
                    account menu) so mobile's visible order is
                    Messages -> Notifications -> hamburger -> Profile/account,
                    not hidden by md:hidden on desktop where position doesn't
                    matter. */}
                <button
                  onClick={() => setMobileOpen(!mobileOpen)}
                  className="md:hidden p-2.5 rounded-full hover:bg-brand-50 transition-colors"
                >
                  {mobileOpen ? <X size={20} /> : <Menu size={20} />}
                </button>

                {/* User menu */}
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="flex items-center gap-2.5 bg-white border border-ink/10 rounded-full pl-2 pr-4 py-1.5 hover:border-brand-400 transition-colors shadow-card"
                  >
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt={user.name} className="w-7 h-7 rounded-full object-cover" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-brand-gradient flex items-center justify-center text-white text-xs font-bold">
                        {initials(user.name)}
                      </div>
                    )}
                    <span className="text-sm font-semibold hidden sm:block max-w-[100px] truncate">{user.name}</span>
                  </button>

                  <AnimatePresence>
                    {userMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.97 }}
                        transition={{ duration: 0.12 }}
                        className="absolute right-0 top-full mt-2 w-52 bg-white border border-ink/8 rounded-2xl shadow-elevated overflow-hidden z-50"
                      >
                        <div className="px-4 py-3 border-b border-ink/6">
                          <p className="font-semibold text-sm">{user.name}</p>
                          <p className="text-xs text-muted truncate">{user.email}</p>
                        </div>
                        {[
                          { icon: User, label: 'Profile', href: '/settings' },
                          { icon: Home, label: 'My listings', href: '/my-listings' },
                          { icon: BookmarkIcon, label: 'Saved listings', href: '/saved' },
                          { icon: MessageSquare, label: 'Messages', href: '/messages' },
                        ].map(item => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setUserMenuOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink hover:bg-brand-50 transition-colors"
                          >
                            <item.icon size={16} className="text-muted" />
                            {item.label}
                          </Link>
                        ))}
                        {user.role !== 'USER' && (
                          <Link href="/admin" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink hover:bg-brand-50">
                            <Settings size={16} className="text-muted" /> Admin panel
                          </Link>
                        )}
                        <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 w-full border-t border-ink/6">
                          <LogOut size={16} />Log out
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <Link href="/post" className="btn-brand text-sm px-5 py-2.5 hidden sm:flex">
                  Post rental
                </Link>
              </>
            ) : (
              <>
                <button onClick={() => setAuthOpen(true)} className="btn-ghost text-sm px-5 py-2.5 hidden sm:flex">
                  Log in
                </button>
                <Link href="/post" className="btn-brand text-sm px-5 py-2.5">
                  Post rental
                </Link>
                {/* Logged out: no account menu to order against, so the
                    toggle stays in its original trailing position. */}
                <button
                  onClick={() => setMobileOpen(!mobileOpen)}
                  className="md:hidden p-2.5 rounded-full hover:bg-brand-50 transition-colors"
                >
                  {mobileOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
              </>
            )}
          </div>
        </nav>

        {/* Mobile menu */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden border-t border-ink/8 bg-surface/98 backdrop-blur-xl"
            >
              <div className="px-4 py-4 flex flex-col gap-1">
                {navLinks.map(link => (
                  <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}
                    className="px-4 py-3 rounded-xl text-sm font-semibold text-muted hover:bg-brand-50 hover:text-brand-700 transition-colors">
                    {link.label}
                  </Link>
                ))}
                <div className="flex gap-2 mt-3 pt-3 border-t border-ink/8">
                  {!user && (
                    <button onClick={() => { setAuthOpen(true); setMobileOpen(false); }}
                      className="btn-ghost text-sm flex-1 py-2.5">Log in</button>
                  )}
                  <Link href="/post" onClick={() => setMobileOpen(false)}
                    className="btn-brand text-sm flex-1 py-2.5 text-center">Post rental</Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}
