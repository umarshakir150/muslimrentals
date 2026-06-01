import { Metadata } from 'next';
import Navbar from '@/components/layout/Navbar';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh">
      <Navbar />
      <main className="pt-[72px]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
          <h1 className="font-serif text-4xl mb-2">Privacy Policy</h1>
          <p className="text-muted mb-8">Last updated: January 1, 2025 · Compliant with PIPEDA (Canada)</p>

          <div className="space-y-6">
            {[
              { h: '1. Information We Collect', p: 'We collect: Account information (name, email, optional phone/bio); Listing information (property details, photos, location); Messages sent via our platform; Usage data (pages visited, searches performed); Device and browser information for security.' },
              { h: '2. How We Use Your Information', p: 'We use your information to: Provide and improve our Platform; Connect landlords and tenants; Send transactional emails (account creation, password reset); Detect fraud and ensure platform safety; Comply with legal obligations. We never sell your personal data to third parties.' },
              { h: '3. Location Data', p: 'Listing coordinates are used to display properties on our map. We use OpenStreetMap (open source) and Nominatim for geocoding. We do not track your device location.' },
              { h: '4. Photo Uploads', p: 'Photos you upload are stored securely on cloud storage (AWS S3 or Cloudflare R2). Photos associated with a listing are publicly visible. You may delete your listing and its photos at any time. We do not claim ownership of your photos.' },
              { h: '5. Messaging', p: 'Messages are stored to enable the conversation history feature. We may review messages in response to abuse reports. Messages are encrypted at rest. We do not share message content with third parties except when required by law.' },
              { h: '6. Cookies', p: 'We use only functional cookies: authentication session cookies (httpOnly, secure) and preference cookies. We do not use advertising or tracking cookies. You may disable cookies in your browser, but this will affect Platform functionality.' },
              { h: '7. Data Retention', p: 'Account data: retained while your account is active, deleted within 30 days of account deletion. Listings: retained for 12 months after expiry for dispute resolution, then deleted. Messages: retained for 24 months. Logs: retained for 90 days.' },
              { h: '8. Your Rights (PIPEDA)', p: 'Under Canadian law, you have the right to: access your personal information; correct inaccurate information; withdraw consent; request deletion of your data; file a complaint with the Office of the Privacy Commissioner of Canada. Contact us at privacy@muslimrentals.ca to exercise these rights.' },
              { h: '9. Third-Party Services', p: 'We use: Google OAuth (optional, for login); AWS S3/Cloudflare R2 (file storage); Nodemailer/SMTP (transactional email). Each has their own privacy policies. We do not use Google Analytics or advertising SDKs.' },
              { h: '10. Contact', p: 'Privacy Officer: Muslim Rentals Inc. · privacy@muslimrentals.ca · Toronto, Ontario, Canada' },
            ].map(s => (
              <section key={s.h} className="bg-white border border-ink/8 rounded-2xl p-6">
                <h2 className="font-semibold text-base mb-2">{s.h}</h2>
                <p className="text-sm text-muted leading-relaxed">{s.p}</p>
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
