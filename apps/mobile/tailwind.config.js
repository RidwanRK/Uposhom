/* eslint-disable */ // CommonJS config consumed by Metro and Tailwind
const { colorTokens } = require('./src/theme/colorTokens');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // Single light theme (design.md section 8): never follow the system dark mode.
  darkMode: 'class',
  theme: { extend: { colors: colorTokens } },
  plugins: [],
};
