import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-outfit)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-dm-serif)', 'Georgia', 'serif'],
      },
      colors: {
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
      },
      boxShadow: {
        card: '0 8px 32px rgba(18,32,26,0.10)',
        elevated: '0 24px 80px rgba(18,32,26,0.14)',
        'inner-sm': 'inset 0 1px 3px rgba(18,32,26,0.08)',
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
      // Single source of truth for stacking order across the app. Third-party
      // widgets (Leaflet in particular) ship their own internal z-indices that
      // can reach 1000+; anything embedding one MUST also get `isolate` so its
      // internal stacking is contained and can't escape above these layers.
      zIndex: {
        map: '10',       // embedded map (contained via `isolate`)
        header: '40',    // sticky site header / nav
        dropdown: '50',  // autocomplete lists, user menu, small popovers
        overlay: '100',  // modal backdrops + dialogs
        toast: '200',    // toast notifications - always on top
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
