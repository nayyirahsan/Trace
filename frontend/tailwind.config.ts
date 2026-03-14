import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        trace: {
          bg: '#0A0E14',
          surface: '#0F141C',
          raised: '#141B25',
          border: '#1D2735',
          hairline: '#16202B',
          ink: '#DCE3EC',
          muted: '#67788C',
          faint: '#3D4C5F',
          accent: '#2DD4BF',
          success: '#34D399',
          failure: '#F87171',
          warning: '#FBBF24',
        },
      },
      fontFamily: {
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['var(--font-plex-sans)', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        marker: '0 0 0 3px rgba(10, 14, 20, 0.9)',
        'glow-red': '0 0 8px rgba(248, 113, 113, 0.55)',
        'glow-amber': '0 0 8px rgba(251, 191, 36, 0.45)',
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 32px -16px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
};

export default config;
