'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import { authApi } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';

const resetSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, { message: "Passwords don't match", path: ['confirmPassword'] });

type ResetForm = z.infer<typeof resetSchema>;

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const token = params.get('token');

  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const form = useForm<ResetForm>({ resolver: zodResolver(resetSchema) });

  async function onSubmit(data: ResetForm) {
    if (!token) return;
    setLoading(true);
    try {
      await authApi.resetPassword(token, data.password);
      setDone(true);
      toast({ title: 'Password reset', description: 'You can now log in with your new password.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Reset failed', description: err.message || 'This link may be invalid or expired.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh">
      <Navbar />
      <main className="pt-[72px]">
        <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
          {!token ? (
            <div className="text-center">
              <h1 className="font-serif text-3xl mb-2">Invalid reset link</h1>
              <p className="text-muted mb-6">This password reset link is missing its token. Please request a new one.</p>
              <button onClick={() => router.push('/')} className="btn-brand">Back to home</button>
            </div>
          ) : done ? (
            <div className="text-center">
              <CheckCircle2 size={48} className="mx-auto mb-4 text-brand-600" />
              <h1 className="font-serif text-3xl mb-2">Password reset</h1>
              <p className="text-muted mb-6">Your password has been updated. Log in with your new password to continue.</p>
              <button onClick={() => router.push('/')} className="btn-brand">Go to log in</button>
            </div>
          ) : (
            <>
              <h1 className="font-serif text-3xl mb-2">Set a new password</h1>
              <p className="text-muted mb-8">Choose a new password for your account.</p>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">New password</label>
                  <div className="relative">
                    <input {...form.register('password')} type={showPass ? 'text' : 'password'} placeholder="Min. 8 characters" className="input-field pr-10" />
                    <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {form.formState.errors.password && <p className="text-red-500 text-xs mt-1">{form.formState.errors.password.message}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Confirm new password</label>
                  <input {...form.register('confirmPassword')} type="password" placeholder="Repeat password" className="input-field" />
                  {form.formState.errors.confirmPassword && <p className="text-red-500 text-xs mt-1">{form.formState.errors.confirmPassword.message}</p>}
                </div>
                <button type="submit" disabled={loading} className="btn-brand w-full justify-center py-3 mt-2">
                  {loading ? <Loader2 size={18} className="animate-spin" /> : 'Reset password'}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
