'use client';

import { useEffect } from 'react';

// Shared by every full-screen modal (AuthModal, PostListingModal,
// ListingDetail, ...) so Escape reliably closes whichever one is open -
// previously none of them supported this.
export function useEscapeKey(onEscape: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscape();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onEscape]);
}
