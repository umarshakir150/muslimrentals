import { Metadata } from 'next';
import Navbar from '@/components/layout/Navbar';

export const metadata: Metadata = { title: 'Terms of Service' };

export default function TermsPage() {
  return (
    <div className="min-h-dvh">
      <Navbar />
      <main className="pt-[72px]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 prose prose-sm max-w-none">
          <h1 className="font-serif text-4xl mb-2">Terms of Service</h1>
          <p className="text-muted">Last updated: January 1, 2025</p>

          <div className="space-y-8 mt-8">
            {[
              { h: '1. Acceptance of Terms', p: 'By accessing or using Muslim Rentals ("Platform"), you agree to be bound by these Terms of Service and all applicable laws and regulations in Canada. If you do not agree, you may not use the Platform.' },
              { h: '2. Platform Purpose', p: 'Muslim Rentals is a listing platform that connects landlords and tenants within the Muslim community in Canada. We do not act as a landlord, tenant, or party to any rental agreement. We are a technology intermediary only.' },
              { h: '3. User Accounts', p: 'You must be at least 18 years old to create an account. You are responsible for maintaining the security of your account credentials. You must provide accurate information when creating an account. One person may not maintain multiple accounts.' },
              { h: '4. Listing Rules', p: 'Listings must be for real, available properties in Canada. Listing fees (if applicable) are non-refundable once a listing goes live. We reserve the right to remove any listing that violates our Community Guidelines. Landlords are responsible for the accuracy of their listings.' },
              { h: '5. Prohibited Content', p: 'You may not post: fraudulent, misleading, or deceptive listings; content that discriminates on protected grounds under the Canadian Human Rights Act; content promoting illegal activities; spam or commercial solicitations unrelated to rental listings; content that is hateful, abusive, or violates our community standards.' },
              { h: '6. Messaging', p: 'Our messaging system is provided as a convenience. We may review messages for safety and compliance purposes. Do not share sensitive financial information through our platform. We are not responsible for communications that occur outside our platform.' },
              { h: '7. Limitation of Liability', p: 'Muslim Rentals is not liable for: the accuracy of any listing; the conduct of landlords or tenants; any rental agreements made; financial loss resulting from rental scams (though we work hard to prevent them). Use the Platform at your own risk and exercise due diligence.' },
              { h: '8. Intellectual Property', p: 'All Platform content, branding, and code remains the property of Muslim Rentals Inc. You grant us a non-exclusive license to display content you post on the Platform.' },
              { h: '9. Termination', p: 'We may suspend or terminate accounts that violate these Terms. You may delete your account at any time. Upon termination, your listings will be removed and your data handled per our Privacy Policy.' },
              { h: '10. Governing Law', p: 'These Terms are governed by the laws of the Province of Ontario and the federal laws of Canada. Any disputes shall be resolved in the courts of Ontario.' },
            ].map(s => (
              <section key={s.h} className="bg-white border border-ink/8 rounded-2xl p-6">
                <h2 className="font-semibold text-base mb-3">{s.h}</h2>
                <p className="text-sm text-muted leading-relaxed">{s.p}</p>
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
