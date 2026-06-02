'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Eye, EyeOff, Loader2 } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';

interface AuthModalProps { open: boolean; onClose: () => void; }

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, { message: "Passwords don't match", path: ['confirmPassword'] });

const forgotSchema = z.object({ email: z.string().email() });

type LoginForm = z.infer<typeof loginSchema>;
type RegisterForm = z.infer<typeof registerSchema>;

export default function AuthModal({ open, onClose }: AuthModalProps) {
  const [tab, setTab] = useState<'login' | 'register' | 'forgot'>('login');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const { toast } = useToast();

  const loginForm = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });
  const registerForm = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });
  const forgotForm = useForm<{ email: string }>({ resolver: zodResolver(forgotSchema) });

  async function handleLogin(data: LoginForm) {
    setLoading(true);
    try {
      const res = await authApi.login(data);
      setAuth(res.data.user, res.data.accessToken);
      toast({ title: 'Welcome back!', description: `Logged in as ${res.data.user.name}` });
      onClose();
    } catch (err: any) {
      const msg = err.message?.includes('<!DOCTYPE') || err.message?.includes('Unexpected token')
        ? 'Account not found. Please sign up first.'
        : err.message || 'Login failed. Please try again.';
      toast({ variant: 'destructive', title: 'Login failed', description: msg });
    } finally { setLoading(false); }
  }

  async function handleRegister(data: RegisterForm) {
    setLoading(true);
    try {
      const { confirmPassword: _, ...rest } = data;
      const res = await authApi.register(rest);
      setAuth(res.data.user, res.data.accessToken);
      toast({ title: 'Account created!', description: `Welcome, ${res.data.user.name}!` });
      onClose();
    } catch (err: any) {
      const msg = err.message?.includes('<!DOCTYPE') || err.message?.includes('Unexpected token')
        ? 'Sign up failed. Please try again or contact support.'
        : err.message || 'Sign up failed. Please try again.';
      toast({ variant: 'destructive', title: 'Sign up failed', description: msg });
    } finally { setLoading(false); }
  }

  async function handleForgot(data: { email: string }) {
    setLoading(true);
    try {
      await authApi.forgotPassword(data.email);
      toast({ title: 'Reset email sent', description: 'Check your inbox for the reset link.' });
      setTab('login');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally { setLoading(false); }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-md bg-white rounded-3xl shadow-elevated border border-ink/6 overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 pt-6 pb-0 flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-serif mb-1">
                  {tab === 'forgot' ? 'Reset password' : tab === 'login' ? 'Welcome back' : 'Create account'}
                </h2>
                <p className="text-sm text-muted">
                  {tab === 'login' ? 'Log in to access your listings and messages.' :
                   tab === 'register' ? 'Sign up to join the community.' :
                   'Enter your email to receive a reset link.'}
                </p>
              </div>
              <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors mt-1">
                <X size={18} />
              </button>
            </div>

            {/* Tabs */}
            {tab !== 'forgot' && (
              <div className="flex gap-1 mx-6 mt-5 bg-gray-100 rounded-xl p-1">
                {(['login', 'register'] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)}
                    className={cn('flex-1 py-2 text-sm font-semibold rounded-lg transition-all', tab === t ? 'bg-white shadow-sm text-brand-700' : 'text-muted hover:text-ink')}>
                    {t === 'login' ? 'Log in' : 'Sign up'}
                  </button>
                ))}
              </div>
            )}

            <div className="p-6">
              {/* Login Form */}
              {tab === 'login' && (
                <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Email</label>
                    <input {...loginForm.register('email')} type="email" placeholder="your@email.com" className="input-field" />
                    {loginForm.formState.errors.email && <p className="text-red-500 text-xs mt-1">{loginForm.formState.errors.email.message}</p>}
                  </div>
                  <div>
                    <div className="flex justify-between mb-1.5">
                      <label className="text-xs font-semibold text-muted uppercase tracking-wider">Password</label>
                      <button type="button" onClick={() => setTab('forgot')} className="text-xs text-brand-600 font-semibold hover:underline">Forgot password?</button>
                    </div>
                    <div className="relative">
                      <input {...loginForm.register('password')} type={showPass ? 'text' : 'password'} placeholder="••••••••" className="input-field pr-10" />
                      <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
                        {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <button type="submit" disabled={loading} className="btn-brand w-full justify-center py-3 mt-2">
                    {loading ? <Loader2 size={18} className="animate-spin" /> : 'Log in'}
                  </button>
                  <p className="text-sm text-center text-muted">
                    No account?{' '}
                    <button type="button" onClick={() => setTab('register')} className="text-brand-600 font-semibold hover:underline">Sign up</button>
                  </p>
                </form>
              )}

              {/* Register Form */}
              {tab === 'register' && (
                <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Full name</label>
                    <input {...registerForm.register('name')} placeholder="Your name" className="input-field" />
                    {registerForm.formState.errors.name && <p className="text-red-500 text-xs mt-1">{registerForm.formState.errors.name.message}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Email</label>
                    <input {...registerForm.register('email')} type="email" placeholder="your@email.com" className="input-field" />
                    {registerForm.formState.errors.email && <p className="text-red-500 text-xs mt-1">{registerForm.formState.errors.email.message}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Password</label>
                    <div className="relative">
                      <input {...registerForm.register('password')} type={showPass ? 'text' : 'password'} placeholder="Min. 8 characters" className="input-field pr-10" />
                      <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
                        {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {registerForm.formState.errors.password && <p className="text-red-500 text-xs mt-1">{registerForm.formState.errors.password.message}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Confirm password</label>
                    <input {...registerForm.register('confirmPassword')} type="password" placeholder="Repeat password" className="input-field" />
                    {registerForm.formState.errors.confirmPassword && <p className="text-red-500 text-xs mt-1">{registerForm.formState.errors.confirmPassword.message}</p>}
                  </div>
                  <button type="submit" disabled={loading} className="btn-brand w-full justify-center py-3 mt-2">
                    {loading ? <Loader2 size={18} className="animate-spin" /> : 'Sign up'}
                  </button>
                  <p className="text-sm text-center text-muted">
                    Already have an account?{' '}
                    <button type="button" onClick={() => setTab('login')} className="text-brand-600 font-semibold hover:underline">Log in</button>
                  </p>
                </form>
              )}

              {/* Forgot Form */}
              {tab === 'forgot' && (
                <form onSubmit={forgotForm.handleSubmit(handleForgot)} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Email address</label>
                    <input {...forgotForm.register('email')} type="email" placeholder="your@email.com" className="input-field" />
                  </div>
                  <button type="submit" disabled={loading} className="btn-brand w-full justify-center py-3">
                    {loading ? <Loader2 size={18} className="animate-spin" /> : 'Send reset link'}
                  </button>
                  <button type="button" onClick={() => setTab('login')} className="w-full text-sm text-muted text-center hover:text-brand-600 transition-colors">
                    Back to log in
                  </button>
                </form>
              )}

              <p className="text-xs text-muted text-center mt-4 leading-relaxed">
                By continuing, you agree to our{' '}
                <a href="/terms" className="text-brand-600 hover:underline">Terms of Use</a> and{' '}
                <a href="/privacy" className="text-brand-600 hover:underline">Privacy Policy</a>.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
