'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, Mail, Trash2, X } from 'lucide-react';
import { usersApi } from '@/lib/api';
import { useAuthStore, useUser } from '@/store/authStore';
import { useToast } from '@/components/ui/use-toast';
import { cn, initials } from '@/lib/utils';
import DeleteAccountDialog from './DeleteAccountDialog';

const MAX_AVATAR_MB = 5;

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-ink/8 rounded-3xl p-6 shadow-card mb-5">
      <h2 className="font-semibold text-base mb-4">{title}</h2>
      {children}
    </section>
  );
}

export default function Settings() {
  const user = useUser();
  const setUser = useAuthStore(s => s.setUser);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarRemoving, setAvatarRemoving] = useState(false);

  const [name, setName] = useState(user?.name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [changingEmail, setChangingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailRequestSent, setEmailRequestSent] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!user) return null;
  const hasPassword = user.hasPassword !== false; // treat unknown as "has password" (safer default: don't hide the option)

  async function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'Please choose an image file' });
      return;
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      toast({ variant: 'destructive', title: `Image must be under ${MAX_AVATAR_MB}MB` });
      return;
    }

    setAvatarUploading(true);
    try {
      const res = await usersApi.uploadAvatar(file);
      setUser({ ...user!, avatarUrl: res.data.url });
      toast({ title: 'Profile picture updated' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: err.message });
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarRemoving(true);
    try {
      await usersApi.removeAvatar();
      setUser({ ...user!, avatarUrl: null });
      toast({ title: 'Profile picture removed' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not remove picture', description: err.message });
    } finally {
      setAvatarRemoving(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileError(null);
    try {
      const res = await usersApi.updateProfile({ name: name.trim(), bio: bio.trim(), phone: phone.trim() });
      setUser({ ...user!, ...res.data });
      toast({ title: 'Profile updated' });
    } catch (err: any) {
      setProfileError(err.message || 'Could not save changes.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleRequestEmailChange(e: React.FormEvent) {
    e.preventDefault();
    setEmailSubmitting(true);
    setEmailError(null);
    try {
      await usersApi.requestEmailChange(newEmail.trim().toLowerCase(), hasPassword ? emailPassword : undefined);
      setEmailRequestSent(newEmail.trim().toLowerCase());
      setChangingEmail(false);
      setEmailPassword('');
    } catch (err: any) {
      setEmailError(err.message || 'Could not request email change.');
    } finally {
      setEmailSubmitting(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setChangingPassword(true);
    setPasswordError(null);
    try {
      await usersApi.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      toast({ title: 'Password updated' });
    } catch (err: any) {
      setPasswordError(err.message || 'Could not change password.');
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <div>
      {/* Profile picture */}
      <SectionCard title="Profile picture">
        <div className="flex items-center gap-5">
          <div className="relative w-20 h-20 shrink-0">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name} className="w-20 h-20 rounded-full object-cover" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-brand-gradient flex items-center justify-center text-white text-2xl font-bold">
                {initials(user.name)}
              </div>
            )}
            {avatarUploading && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              className="btn-ghost text-sm px-4 py-2 flex items-center gap-2 w-fit"
            >
              <Camera size={15} /> {user.avatarUrl ? 'Change photo' : 'Upload photo'}
            </button>
            {user.avatarUrl && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                disabled={avatarRemoving}
                className="text-sm text-red-600 hover:text-red-700 font-medium flex items-center gap-1.5 w-fit"
              >
                {avatarRemoving ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Remove photo
              </button>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Display name, bio, phone */}
      <SectionCard title="Profile">
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Display name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="input-field" minLength={2} maxLength={80} required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Phone number</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} className="input-field" placeholder="e.g. +1 416 555 0100" maxLength={20} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Bio</label>
            <textarea value={bio} onChange={e => setBio(e.target.value)} className="input-field resize-none" rows={3} maxLength={500} />
          </div>
          {profileError && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{profileError}</p>}
          <button type="submit" disabled={savingProfile} className="btn-brand px-5 py-2.5 text-sm">
            {savingProfile ? <Loader2 size={15} className="animate-spin" /> : 'Save changes'}
          </button>
        </form>
      </SectionCard>

      {/* Email */}
      <SectionCard title="Email">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-2 text-sm">
            <Mail size={15} className="text-muted" />
            <span>{user.email}</span>
          </div>
          {!changingEmail && (
            <button type="button" onClick={() => setChangingEmail(true)} className="text-sm font-semibold text-brand-600 hover:underline shrink-0">
              Change email
            </button>
          )}
        </div>

        {emailRequestSent && (
          <p className="text-sm text-brand-700 bg-brand-50 rounded-xl px-3 py-2 mt-2">
            Check <strong>{emailRequestSent}</strong> for a confirmation link. Your login email won&apos;t change until you confirm it.
          </p>
        )}

        {changingEmail && (
          <form onSubmit={handleRequestEmailChange} className="space-y-3 mt-3 pt-3 border-t border-ink/8">
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">New email</label>
              <input name="newEmail" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required className="input-field" />
            </div>
            {hasPassword && (
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Current password</label>
                <input name="emailChangePassword" type="password" value={emailPassword} onChange={e => setEmailPassword(e.target.value)} required className="input-field" />
              </div>
            )}
            {emailError && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{emailError}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => { setChangingEmail(false); setEmailError(null); }} className="btn-ghost px-4 py-2 text-sm">
                Cancel
              </button>
              <button type="submit" disabled={emailSubmitting} className="btn-brand px-4 py-2 text-sm">
                {emailSubmitting ? <Loader2 size={15} className="animate-spin" /> : 'Send confirmation link'}
              </button>
            </div>
          </form>
        )}
      </SectionCard>

      {/* Password */}
      {hasPassword && (
        <SectionCard title="Password">
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Current password</label>
              <input name="currentPassword" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">New password</label>
              <input name="newPassword" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} className="input-field" placeholder="Min. 8 characters" />
            </div>
            {passwordError && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{passwordError}</p>}
            <button type="submit" disabled={changingPassword} className="btn-brand px-5 py-2.5 text-sm">
              {changingPassword ? <Loader2 size={15} className="animate-spin" /> : 'Update password'}
            </button>
          </form>
        </SectionCard>
      )}

      {/* Danger zone */}
      <section className={cn('border border-red-200 rounded-3xl p-6 bg-red-50/40')}>
        <h2 className="font-semibold text-base mb-1 text-red-700">Danger zone</h2>
        <p className="text-sm text-muted mb-4">Permanently delete your account and profile. This can&apos;t be undone.</p>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="flex items-center gap-2 text-sm font-semibold text-red-600 hover:text-red-700 px-4 py-2 rounded-xl border border-red-200 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={15} /> Delete my account
        </button>
      </section>

      <DeleteAccountDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        hasPassword={hasPassword}
        userEmail={user.email}
      />
    </div>
  );
}
