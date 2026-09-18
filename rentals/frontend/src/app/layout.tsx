import type { Metadata } from 'next';
import { DM_Serif_Display, Outfit } from 'next/font/google';
import { Toaster } from '@/components/ui/toaster';
import { Providers } from '@/components/layout/Providers';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

const dmSerif = DM_Serif_Display({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-dm-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Muslim Rentals — Muslim-Friendly Housing in Canada', template: '%s | Muslim Rentals' },
  description: 'Find and post halal-friendly rental housing across Canada for brothers, sisters, couples, and families.',
  keywords: ['Muslim rentals', 'halal housing', 'Canada rentals', 'Islamic community', 'brothers', 'sisters', 'families'],
  authors: [{ name: 'Muslim Rentals' }],
  openGraph: {
    title: 'Muslim Rentals — Muslim-Friendly Housing in Canada',
    description: 'Find halal-friendly rental housing across Canada.',
    type: 'website',
    locale: 'en_CA',
    siteName: 'Muslim Rentals',
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${dmSerif.variable}`} suppressHydrationWarning>
      <body className="bg-surface font-sans text-ink antialiased">
        <Providers>
          {/* Milestone 1: Navbar and Footer are rendered once here rather
              than by each page individually -- previously inconsistent
              (several pages had no footer at all, and two pages rendered
              Navbar twice across their loading/loaded states). Pages keep
              their own existing top-clearance padding for the fixed
              header, since some (e.g. /map) depend on an exact pixel
              value for real container measurements and shouldn't be
              touched incidentally by this change. */}
          <Navbar />
          {children}
          <Footer />
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
