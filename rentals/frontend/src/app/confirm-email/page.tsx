'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import { usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

function ConfirmEmailForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token');
  const user = useAuthStore(s => s.user);
  const setUser = useAuthStore(s => s.setUser);

  const [status, setStatus] = useState<'confirming' | 'success' | 'error'>('confirming');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setErrorMessage('This confirmation link is missing its token.'); return; }

    usersApi.confirmEmailChange(token)
      .then(res => {
        if (user) setUser({ ...user, ...res.data });
        setStatus('success');
      })
      .catch(err => {
        setStatus('error');
        setErrorMessage(err.message || 'This link may be invalid or expired.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="min-h-dvh">
      <Navbar />
      <main className="pt-[72px]">
        <div className="max-w-md mx-auto px-4 sm:px-6 py-16 text-center">
          {status === 'confirming' && (
            <>
              <Loader2 size={40} className="mx-auto mb-4 text-brand-600 animate-spin" />
              <h1 className="font-serif text-2xl mb-2">Confirming your email…</h1>
            </>
          )}
          {status === 'success' && (
            <>
              <CheckCircle2 size={48} className="mx-auto mb-4 text-brand-600" />
              <h1 className="font-serif text-3xl mb-2">Email confirmed</h1>
              <p className="text-muted mb-6">Your account email has been updated.</p>
              <button onClick={() => router.push('/settings')} className="btn-brand">Back to Settings</button>
            </>
          )}
          {status === 'error' && (
            <>
              <XCircle size={48} className="mx-auto mb-4 text-red-500" />
              <h1 className="font-serif text-3xl mb-2">Link invalid or expired</h1>
              <p className="text-muted mb-6">{errorMessage} You can request a new confirmation link from Settings.</p>
              <button onClick={() => router.push('/settings')} className="btn-brand">Go to Settings</button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmailForm />
    </Suspense>
  );
}
