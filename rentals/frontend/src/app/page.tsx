'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { MapIcon, Users, Shield, MessageSquare, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import AuthModal from '@/components/auth/AuthModal';

export default function Home() {
  const [authOpen, setAuthOpen] = useState(false);

  const features = [
    { icon: Shield, title: 'Trusted community', desc: 'Listings reviewed for safety. Report issues easily.' },
    { icon: MessageSquare, title: 'Real-time messaging', desc: 'Message landlords securely after creating a free account.' },
    { icon: MapIcon, title: 'Map view', desc: 'Find rentals near you across Canada.' },
    { icon: Users, title: 'Community-first', desc: "Built by and for Canada's Muslim community." },
  ];

  return (
    <div className="min-h-dvh">

      {/* Hero */}
      <section className="relative pt-[72px] overflow-hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col items-center text-center min-h-[calc(100dvh-72px)] justify-center py-20 gap-8">

            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}>
              <h1 className="section-title text-[clamp(2.6rem,5.5vw,4rem)] mb-5 leading-[1.05]">
                Find a home{' '}
                <em className="text-brand-600 not-italic">rooted</em> in your values
              </h1>
              <p className="text-lg text-muted mb-8 max-w-xl mx-auto leading-relaxed">
                Halal-friendly rentals across Canada, priced fairly and posted by your community.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/browse" className="btn-brand text-base px-8 py-4 flex items-center justify-center gap-2">
                  Browse listings <ArrowRight size={18} />
                </Link>
                <Link href="/post" className="btn-ghost text-base px-8 py-4 flex items-center justify-center">
                  Post a listing
                </Link>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.2 }}
              className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-2xl"
            >
              {[
                { label: 'Cities across Canada', value: '80+' },
                { label: 'Verified platform', value: 'Trusted' },
                { label: 'Community-first', value: 'Always' },
                { label: 'Free to browse', value: '100%' },
              ].map((s, i) => (
                <div key={i} className="bg-white border border-ink/8 rounded-2xl px-4 py-4 text-center shadow-card">
                  <div className="font-bold text-lg text-brand-700">{s.value}</div>
                  <div className="text-xs text-muted mt-0.5">{s.label}</div>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-brand-gradient">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center text-white">
          <h2 className="section-title text-3xl md:text-4xl mb-3 text-white">Built for the community</h2>
          <p className="text-white/70 text-base max-w-xl mx-auto mb-12">
            muslimrentals.ca is a community-first platform designed with Muslim values in mind.
          </p>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5">
            {features.map((f, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }} viewport={{ once: true }}
                className="bg-white/10 border border-white/15 rounded-2xl p-5 backdrop-blur-sm text-left">
                <f.icon size={22} className="text-white/80 mb-3" />
                <h3 className="font-semibold text-base mb-1.5">{f.title}</h3>
                <p className="text-white/65 text-sm leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer is now rendered globally from app/layout.tsx (Milestone 1) --
          this page no longer needs its own copy. */}

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
