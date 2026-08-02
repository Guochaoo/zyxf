/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Vercel neutral scale (DESIGN.md §2). slate is remapped to neutral
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
          700: '#404040',
          800: '#262626',
          900: '#171717', // gray-900 primary text (Vercel Black)
        },
        brand: {
          // DESIGN.md §2 interaction palette (replaces legacy brand blue)
          50: '#EBF5FF', // Badge Blue Bg (tinted blue surface)
          100: '#EBF5FF', // tinted blue surface
          200: '#B8D6F6', // light ring / hover fill
          300: '#85B8EF',
          400: '#4C9CE8',
          500: '#0A72EF', // Develop Blue
          600: '#0072F5', // Link Blue (primary interactive)
          700: '#0068D6', // Badge Blue Text
        },
      },
      boxShadow: {
        // DESIGN.md §2 shadow system (shadow-as-border)
        ring: 'rgba(0, 0, 0, 0.08) 0px 0px 0px 1px',
        ringlight: 'rgb(235, 235, 235) 0px 0px 0px 1px',
        card: 'rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 2px, rgba(0,0,0,0.04) 0px 8px 8px -8px, #fafafa 0px 0px 0px 1px',
        'card-subtle': 'rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 2px, #fafafa 0px 0px 0px 1px',
      },
    },
  },
  plugins: [],
};
