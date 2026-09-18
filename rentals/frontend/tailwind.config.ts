import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // Non-JSX files under src/lib (e.g. mapMarkers.ts) build HTML strings
    // containing class names for Leaflet's L.divIcon -- without this glob,
    // Tailwind's JIT content scanner never sees those literals and silently
    // drops any @layer rule targeting them from the production build (see
    // globals.css's "Leaflet / marker overrides" section for the incident
    // this caused). Defense in depth alongside keeping those specific rules
    // unlayered -- this doesn't help classes Leaflet itself assigns at
    // runtime (never a literal string in this codebase at all), which is
    // why the vendor overrides also stay outside @layer regardless.
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-outfit)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-dm-serif)', 'Georgia', 'serif'],
      },
      colors: {
        // ─── UX overhaul design system (Milestone 1) ───────────────────────
        // New tokens live alongside the legacy `brand`/`gold`/`surface`/
        // `paper`/`ink`/`muted` scale below rather than replacing it. Pages
        // migrate to these as each gets its own overhaul milestone; nothing
        // un-migrated should visually change because of this addition.
        // `forest` is the sole brand/accent color going forward -- no more
        // `gold` accent on new work. `neutral` is a warm, ivory-tinted ramp
        // for backgrounds/borders/text.
        forest: {
          50: '#EEF3F1',
          100: '#D7E6DF',
          200: '#B0CCC0',
          300: '#7FAC9B',
          400: '#4C8873',
          500: '#2C6B55',
          600: '#174C3C', // base brand color -- primary actions, links, active states, focus rings
          700: '#123D30', // hover on solid forest surfaces
          800: '#0D2E24', // active/pressed
          900: '#091F18', // reserved for rare deep-bg use, never a repeated section color
        },
        neutral: {
          0: '#FFFFFF',
          50: '#FAF9F6',  // page background (warm ivory)
          100: '#F2F0EA', // subtle surface fill (skeletons, disabled fields)
          200: '#E7E4DC', // default border (cards, dividers, header-on-scroll)
          300: '#D6D2C7', // default input border
          400: '#B8B3A4', // hover borders, disabled icon color
          500: '#8F8A7B', // placeholder / muted text
          600: '#6B6660', // secondary body text
          700: '#4A4744',
          800: '#2E2C2A',
          900: '#1C211F', // warm charcoal -- primary text, headings, footer background
        },
        destructive: {
          DEFAULT: '#B3261E',
          hover: '#8C1D17',
        },
        brand: {
          50: '#edf7f2',
          100: '#d0ece0',
          200: '#a3d9c2',
          300: '#6bbfa0',
          400: '#3aa37e',
          500: '#0f7a57',
          600: '#0a5c42',
          700: '#084a35',
          800: '#063829',
          900: '#03261c',
        },
        gold: {
          50: '#fdf7ed',
          100: '#faecd3',
          200: '#f5d69f',
          300: '#efba5e',
          400: '#e4a02a',
          500: '#c89734',
          600: '#a87c26',
          700: '#866219',
          800: '#644910',
          900: '#433108',
        },
        surface: '#f5f0e8',
        paper: '#ffffff',
        ink: '#12201a',
        muted: '#5a6e63',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // New scale (Milestone 1) -- distinct names so they don't collide
        // with the legacy sm/md/lg pill-radius values above.
        control: '6px', // buttons, inputs, dropdown/popover panels
        surface: '10px', // cards, modals
        panel: '14px', // large image containers
      },
      boxShadow: {
        card: '0 8px 32px rgba(18,32,26,0.10)',
        elevated: '0 24px 80px rgba(18,32,26,0.14)',
        'inner-sm': 'inset 0 1px 3px rgba(18,32,26,0.08)',
        // New restrained elevation scale (Milestone 1) -- no colored/brand
        // glow shadows. elevation-0 is the implicit default (no shadow).
        elevation1: '0 1px 2px rgba(28,33,31,0.06), 0 1px 1px rgba(28,33,31,0.04)',
        elevation2: '0 8px 24px rgba(28,33,31,0.08)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease forwards',
        'slide-up': 'slideUp 0.4s ease forwards',
        'scale-in': 'scaleIn 0.2s ease forwards',
        pulse: 'pulse 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(16px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        scaleIn: { from: { opacity: '0', transform: 'scale(0.95)' }, to: { opacity: '1', transform: 'scale(1)' } },
      },
      backgroundImage: {
        'hero-gradient': 'radial-gradient(circle at 20% 20%, rgba(10,92,66,0.12), transparent 50%), radial-gradient(circle at 80% 0%, rgba(200,151,52,0.10), transparent 50%)',
        'brand-gradient': 'linear-gradient(135deg, #0a5c42, #0f7a57)',
        'gold-gradient': 'linear-gradient(135deg, #a87c26, #e4b44a)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
