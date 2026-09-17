'use client';

import { useRef, useState } from 'react';
import { Camera, Mail, Trash2, X } from 'lucide-react';
import { usersApi } from '@/lib/api';
import { useAuthStore, useUser } from '@/store/authStore';
import { useToast } from '@/components/ui/use-toast';
import { initials } from '@/lib/utils';
import { Input, Textarea } from '@/components/ui/Field';
import Button from '@/components/ui/Button';
import Surface from '@/components/ui/Surface';
import Spinner from '@/components/ui/Spinner';
import DeleteAccountDialog from './DeleteAccountDialog';

const MAX_AVATAR_MB = 5;

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Surface className="mb-5">
      <h2 className="font-semibold text-base mb-4">{title}</h2>
      {children}
    </Surface>
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

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [emailChangePassword, setEmailChangePassword] = useState('');
  const [requestingEmailChange, setRequestingEmailChange] = useState(false);
  const [emailChangeError, setEmailChangeError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

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
    setRequestingEmailChange(true);
    setEmailChangeError(null);
    try {
      await usersApi.requestEmailChange(newEmail.trim(), hasPassword ? emailChangePassword : undefined);
      setPendingEmail(newEmail.trim());
      setNewEmail('');
      setEmailChangePassword('');
      toast({ title: 'Confirmation link sent', description: `Check ${newEmail.trim()} to confirm the change.` });
    } catch (err: any) {
      setEmailChangeError(err.message || 'Could not request the email change.');
    } finally {
      setRequestingEmailChange(false);
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
              <div className="w-20 h-20 rounded-full bg-forest-600 flex items-center justify-center text-white text-2xl font-bold">
                {initials(user.name)}
              </div>
            )}
            {avatarUploading && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <Spinner size={20} className="text-white" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              className="w-fit"
            >
              <Camera size={15} /> {user.avatarUrl ? 'Change photo' : 'Upload photo'}
            </Button>
            {user.avatarUrl && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                disabled={avatarRemoving}
                className="text-sm text-destructive hover:text-destructive-hover font-medium flex items-center gap-1.5 w-fit"
              >
                {avatarRemoving ? <Spinner size={13} /> : <X size={13} />} Remove photo
              </button>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Display name, bio, phone */}
      <SectionCard title="Profile">
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <Input label="Display name" value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={80} required />
          <Input label="Phone number" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. +1 416 555 0100" maxLength={20} />
          <Textarea label="Bio" value={bio} onChange={e => setBio(e.target.value)} rows={3} maxLength={500} />
          {profileError && <p className="text-sm text-destructive bg-destructive/10 rounded-control px-3 py-2">{profileError}</p>}
          <Button type="submit" variant="primary" size="sm" loading={savingProfile}>
            {savingProfile ? 'Saving...' : 'Save changes'}
          </Button>
        </form>
      </SectionCard>

      {/* Email */}
      <SectionCard title="Email">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <Mail size={15} className="text-neutral-500" />
            <span>{user.email}</span>
          </div>
        </div>

        {pendingEmail && (
          <p className="text-sm text-forest-700 bg-forest-50 rounded-control px-3 py-2 mb-4">
            A confirmation link was sent to <strong>{pendingEmail}</strong>. Your login email won&apos;t change until you
            click it. The link expires in 1 hour.
          </p>
        )}

        <form onSubmit={handleRequestEmailChange} className="space-y-4">
          <Input
            label="New email address"
            type="email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            required
            placeholder="your-new-email@example.com"
          />
          {hasPassword && (
            <Input
              label="Current password"
              type="password"
              value={emailChangePassword}
              onChange={e => setEmailChangePassword(e.target.value)}
              required
              placeholder="Confirm it's you"
            />
          )}
          {emailChangeError && <p className="text-sm text-destructive bg-destructive/10 rounded-control px-3 py-2">{emailChangeError}</p>}
          <Button type="submit" variant="primary" size="sm" loading={requestingEmailChange}>
            {requestingEmailChange ? 'Sending...' : 'Send confirmation link'}
          </Button>
        </form>
      </SectionCard>

      {/* Password */}
      {hasPassword && (
        <SectionCard title="Password">
          <form onSubmit={handleChangePassword} className="space-y-4">
            <Input label="Current password" name="currentPassword" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
            <Input label="New password" name="newPassword" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} placeholder="Min. 8 characters" />
            {passwordError && <p className="text-sm text-destructive bg-destructive/10 rounded-control px-3 py-2">{passwordError}</p>}
            <Button type="submit" variant="primary" size="sm" loading={changingPassword}>
              {changingPassword ? 'Updating...' : 'Update password'}
            </Button>
          </form>
        </SectionCard>
      )}

      {/* Danger zone */}
      <section className="border border-destructive/30 rounded-surface p-6 bg-destructive/5">
        <h2 className="font-semibold text-base mb-1 text-destructive">Danger zone</h2>
        <p className="text-sm text-neutral-600 mb-4">Permanently delete your account and profile. This can&apos;t be undone.</p>
        <Button type="button" variant="destructive-ghost" size="sm" onClick={() => setDeleteOpen(true)}>
          <Trash2 size={15} /> Delete my account
        </Button>
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
