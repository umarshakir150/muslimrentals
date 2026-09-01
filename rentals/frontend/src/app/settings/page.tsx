import { Metadata } from 'next';
import Navbar from '@/components/layout/Navbar';
import Settings from '@/components/settings/Settings';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <div className="min-h-dvh">
      <Navbar />
      <main className="pt-[72px]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
          <h1 className="font-serif text-3xl sm:text-4xl mb-2">Settings</h1>
          <p className="text-muted mb-8">Manage your account and profile.</p>
          <Settings />
        </div>
      </main>
    </div>
  );
}
