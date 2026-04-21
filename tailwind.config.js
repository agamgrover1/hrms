/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0eeff',
          100: '#e4e0ff',
          200: '#ccc5ff',
          300: '#a99bff',
          400: '#8269ff',
          500: '#5C4BDA',
          600: '#4c3bbf',
          700: '#3d2d9e',
          800: '#332680',
          900: '#2c2268',
        },
      },
    },
  },
  plugins: [],
}
