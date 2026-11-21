/* eslint-disable */ // CommonJS config consumed by Metro and Tailwind
const { colorTokens } = require('./src/theme/colorTokens');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: { extend: { colors: colorTokens } },
  plugins: [],
};
