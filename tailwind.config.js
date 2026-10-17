/** Tailwind build config for vCGE. Compiled CSS is committed so the app makes no runtime CDN request. */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.js'],
  theme: {
    extend: {
      // Redesign layouts (same numbers as mod01-shell/ui.css and ui.js): phone under 600 px, tablet 600-1199, desktop 1200+.
      screens: { phone: { max: '599.98px' }, tablet: '600px', desktop: '1200px' },
      // ...without changing what the default container widths have always been
      container: { screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' } },
      colors: {
        brand: { 50: '#f0fdf4', 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d', 900: '#14532d' }
      }
    }
  }
};
