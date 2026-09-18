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
import Button, { ButtonLink } from '@/components/ui/Button';

// Primary renter-facing destinations. "Home" was dropped deliberately --
// the logo already serves as Home by convention, and having both was
// redundant (Milestone 1 UX direction).
const NAV_LINKS = [
  { href: '/browse', label: 'Browse', primary: true },
  { href: '/map', label: 'Map' },
  { href: '/safety', label: 'Safety' },
  { href: '/contact', label: 'Contact' },
];

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

  // Mobile drawer: Escape closes it, and it stays closed across a route
  // change so it never reopens stale on the next page.
  useEffect(() => {
    if (!mobileOpen) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    clearAuth();
    setUserMenuOpen(false);
    router.push('/');
  };

  const accountMenuItems = [
    { icon: User, label: 'Profile', href: '/settings' },
    { icon: Home, label: 'My listings', href: '/my-listings' },
    { icon: BookmarkIcon, label: 'Saved listings', href: '/saved' },
    { icon: MessageSquare, label: 'Messages', href: '/messages' },
  ];

  return (
    <>
      <header
        className={cn(
          'fixed top-0 left-0 right-0 z-50 bg-white transition-shadow duration-150',
          scrolled ? 'border-b border-neutral-200 shadow-elevation1' : 'border-b border-transparent'
        )}
      >
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 h-16 md:h-[72px] flex items-center justify-between gap-4">
          {/* Logo -- flat forest mark, no gradient/glow */}
          <Link href="/" className="flex items-center gap-2.5 font-serif text-lg md:text-xl text-neutral-900 shrink-0">
            <div className="w-9 h-9 rounded-control bg-forest-600 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm0 1.5a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm2.5 2a5.5 5.5 0 1 0 .5 9.5A6 6 0 0 1 14.5 5.5z" />
              </svg>
            </div>
            <span className="hidden sm:block">muslimrentals.ca</span>
          </Link>

          {/* Desktop nav -- real hierarchy: Browse (semibold, primary renter
              destination) vs. Map/Safety/Contact (regular weight, lighter
              color). Active page gets an underline, not a background pill. */}
          <div className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map(link => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'relative py-1.5 text-sm transition-colors',
                    link.primary ? 'font-semibold' : 'font-normal',
                    active ? 'text-neutral-900' : link.primary ? 'text-neutral-900 hover:text-forest-700' : 'text-neutral-600 hover:text-neutral-900'
                  )}
                >
                  {link.label}
                  {active && <span className="absolute left-0 right-0 -bottom-[1px] h-[2px] bg-forest-600 rounded-full" />}
                </Link>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {user ? (
              <>
                {/* Messages */}
                <Link href="/messages" className="relative p-2.5 rounded-full hover:bg-neutral-100 transition-colors" aria-label="Messages">
                  <MessageSquare size={20} strokeWidth={1.75} className="text-neutral-600" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-forest-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Link>

                <ButtonLink href="/post" size="md" className="hidden sm:inline-flex">
                  Post a Rental
                </ButtonLink>

                {/* Mobile menu toggle -- placed here (between Messages and the
                    account menu) so mobile's visible order is
                    Messages -> hamburger -> Profile/account, not hidden by
                    md:hidden on desktop where position doesn't matter. */}
                <button
                  onClick={() => setMobileOpen(!mobileOpen)}
                  className="md:hidden p-2.5 rounded-full hover:bg-neutral-100 transition-colors"
                  aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                  aria-expanded={mobileOpen}
                >
                  {mobileOpen ? <X size={20} strokeWidth={1.75} /> : <Menu size={20} strokeWidth={1.75} />}
                </button>

                {/* User menu */}
                <div className="relative hidden md:block" ref={userMenuRef}>
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="flex items-center gap-2.5 border border-neutral-200 rounded-full pl-2 pr-3.5 py-1.5 hover:border-neutral-300 transition-colors"
                  >
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt={user.name} className="w-7 h-7 rounded-full object-cover" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-forest-600 flex items-center justify-center text-white text-xs font-bold">
                        {initials(user.name)}
                      </div>
                    )}
                    <span className="text-sm font-medium max-w-[100px] truncate">{user.name}</span>
                  </button>

                  <AnimatePresence>
                    {userMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.12 }}
                        className="absolute right-0 top-full mt-2 w-56 bg-white border border-neutral-200 rounded-surface shadow-elevation1 overflow-hidden z-50"
                      >
                        <div className="px-4 py-3 border-b border-neutral-100">
                          <p className="font-semibold text-sm text-neutral-900">{user.name}</p>
                          <p className="text-xs text-neutral-600 truncate">{user.email}</p>
                        </div>
                        {accountMenuItems.map(item => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setUserMenuOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-900 hover:bg-neutral-50 transition-colors"
                          >
                            <item.icon size={16} strokeWidth={1.75} className="text-neutral-500" />
                            {item.label}
                          </Link>
                        ))}
                        {user.role !== 'USER' && (
                          <Link href="/admin" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-900 hover:bg-neutral-50">
                            <Settings size={16} strokeWidth={1.75} className="text-neutral-500" /> Admin panel
                          </Link>
                        )}
                        {/* Logging out isn't a destructive action, so it isn't
                            styled as an alarm/red action the way a delete
                            confirmation would be. */}
                        <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 w-full border-t border-neutral-100">
                          <LogOut size={16} strokeWidth={1.75} className="text-neutral-500" />Log out
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            ) : (
              <>
                <Button variant="ghost" size="md" onClick={() => setAuthOpen(true)} className="hidden sm:inline-flex">
                  Log in
                </Button>
                <ButtonLink href="/post" size="md">
                  Post a Rental
                </ButtonLink>
                {/* Logged out: no account menu to order against, so the
                    toggle stays in its original trailing position. */}
                <button
                  onClick={() => setMobileOpen(!mobileOpen)}
                  className="md:hidden p-2.5 rounded-full hover:bg-neutral-100 transition-colors"
                  aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                  aria-expanded={mobileOpen}
                >
                  {mobileOpen ? <X size={20} strokeWidth={1.75} /> : <Menu size={20} strokeWidth={1.75} />}
                </button>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* Mobile nav -- an off-canvas drawer sliding in from the right,
          rather than a slide-down panel: gives real vertical room for the
          link list plus account actions with clear 44px+ touch targets,
          and reads as a calmer, more standard marketplace pattern than an
          accordion pushing page content down. */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 bg-neutral-900/40 z-40 md:hidden"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Site menu"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="fixed top-0 right-0 bottom-0 w-[85%] max-w-[360px] bg-white z-50 md:hidden flex flex-col overflow-y-auto"
            >
              <div className="flex items-center justify-between h-16 px-4 border-b border-neutral-200 shrink-0">
                <span className="font-serif text-lg text-neutral-900">Menu</span>
                <button onClick={() => setMobileOpen(false)} className="p-2.5 rounded-full hover:bg-neutral-100" aria-label="Close menu">
                  <X size={20} strokeWidth={1.75} />
                </button>
              </div>

              <div className="flex flex-col p-4 gap-1">
                {NAV_LINKS.map(link => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'px-3 py-3 rounded-control text-[15px] transition-colors min-h-[44px] flex items-center',
                      link.primary ? 'font-semibold text-neutral-900' : 'font-normal text-neutral-700',
                      pathname === link.href ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>

              <div className="px-4">
                <ButtonLink href="/post" size="lg" className="w-full" onClick={() => setMobileOpen(false)}>
                  Post a Rental
                </ButtonLink>
              </div>

              {user ? (
                <div className="flex flex-col p-4 gap-1 mt-2 border-t border-neutral-200 pt-4">
                  <div className="px-3 pb-2">
                    <p className="font-semibold text-sm text-neutral-900">{user.name}</p>
                    <p className="text-xs text-neutral-600 truncate">{user.email}</p>
                  </div>
                  {accountMenuItems.map(item => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-3 px-3 py-3 rounded-control text-[15px] text-neutral-900 hover:bg-neutral-50 min-h-[44px]"
                    >
                      <item.icon size={18} strokeWidth={1.75} className="text-neutral-500" />
                      {item.label}
                    </Link>
                  ))}
                  {user.role !== 'USER' && (
                    <Link href="/admin" className="flex items-center gap-3 px-3 py-3 rounded-control text-[15px] text-neutral-900 hover:bg-neutral-50 min-h-[44px]">
                      <Settings size={18} strokeWidth={1.75} className="text-neutral-500" /> Admin panel
                    </Link>
                  )}
                  <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-3 rounded-control text-[15px] text-neutral-700 hover:bg-neutral-50 min-h-[44px] mt-2 border-t border-neutral-100 pt-4">
                    <LogOut size={18} strokeWidth={1.75} className="text-neutral-500" />Log out
                  </button>
                </div>
              ) : (
                <div className="p-4 mt-2 border-t border-neutral-200">
                  <Button variant="secondary" size="lg" className="w-full" onClick={() => { setAuthOpen(true); setMobileOpen(false); }}>
                    Log in
                  </Button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}
