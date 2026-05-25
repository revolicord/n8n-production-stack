import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        qc: {
          bg: '#0d0d0d',
          surface: '#111111',
          surface2: '#0a0a0a',
          border: '#1f2937',
          borderHover: '#374151',
          textPrimary: '#ffffff',
          textBody: '#d1d5db',
          textMuted: '#9ca3af',
          textSubtle: '#6b7280',
          textFaint: '#4b5563',
          teal50: '#5dcaa5',
          teal500: '#14b8a6',
          teal700: '#0f6e56',
          success: '#5dcaa5',
          danger: '#f87171',
          warning: '#fbbf24',
          info: '#60a5fa',
          ai: '#c084fc',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
