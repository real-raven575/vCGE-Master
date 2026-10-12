/** Tailwind build config for vCGE. Compiled CSS is committed so the app makes no runtime CDN request. */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.js'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#f0fdf4', 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d', 900: '#14532d' }
      }
    }
  }
};
