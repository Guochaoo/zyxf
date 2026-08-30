/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Vercel neutral scale (docs/DESIGN.md §2). slate is remapped to neutral
        // grays so existing `text-slate-*`/`border-slate-*` classes render in
        // the achromatic system.
        slate: {
          50: '#FAFAFA', // gray-50  subtle surface tint
          100: '#F5F5F5', // soft fill
          200: '#EBEBEB', // gray-100 borders, card outlines
          300: '#D4D4D4',
          400: '#808080', // gray-400 placeholder, disabled
          500: '#666666', // gray-500 tertiary text
          600: '#4D4D4D', // gray-600 secondary text
          700: '#404040', // gray-700 hover text (sidebar toggle buttons)
          800: '#262626',
          900: '#171717', // gray-900 primary text (Vercel Black)
        },
        brand: {
          // docs/DESIGN.md §2 interaction palette (replaces legacy brand blue)
          500: '#0A72EF', // Develop Blue
          600: '#0072F5', // Link Blue (primary interactive)
          700: '#0068D6', // Badge Blue Text
        },
        // Insight card design system (liveline-style tokens, light theme)
        page: 'var(--page)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        surface: 'var(--surface)',
        inset: 'var(--inset)',
        field: 'var(--field)',
        hover: 'var(--hover)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        accent: 'var(--accent)',
        orange: 'var(--orange)',
        red: 'var(--red)',
        green: 'var(--green)',
      },
      boxShadow: {
        // Insight card design system — raised button
        btn: 'rgba(23, 23, 23, 0.12) 0px 1px 2px, rgba(23, 23, 23, 0.06) 0px 0px 0px 1px',
      },
      borderRadius: {
        card: '12px',
        control: '10px',
      },
      transitionDuration: {
        250: '250ms',
      },
      maxWidth: {
        95: '23.75rem',
      },
      minHeight: {
        4.5: '1.125rem',
      },
    },
  },
  plugins: [],
};
