'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/layout/Navbar';
import AuthModal from '@/components/auth/AuthModal';
import { useIsAuthenticated } from '@/store/authStore';

const PostListingModal = dynamic(() => import('@/components/listings/PostListingModal'), { ssr: false });

export default function PostPage() {
  const isAuth = useIsAuthenticated();
  const [authOpen, setAuthOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Auto-open the appropriate modal once auth state is known
    if (isAuth) {
      setPostOpen(true);
    } else {
      setAuthOpen(true);
    }
  }, [isAuth]);

  return (
    <div className="min-h-dvh">
      <Navbar />
      <div className="pt-[72px] flex items-center justify-center min-h-[calc(100dvh-72px)]">
        <div className="text-center px-4">
          <h1 className="section-title text-2xl mb-2">Post a listing</h1>
          <p className="text-muted text-sm">Please log in or sign up to post a rental listing.</p>
        </div>
      </div>

      <PostListingModal
        open={postOpen}
        onClose={() => { setPostOpen(false); router.push('/browse'); }}
      />
      <AuthModal
        open={authOpen}
        onClose={() => {
          setAuthOpen(false);
          if (isAuth) setPostOpen(true);
          else router.push('/');
        }}
      />
    </div>
  );
}
