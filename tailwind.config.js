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
          50:  '#eef0f8',
          100: '#d5d9ee',
          200: '#aab3dd',
          300: '#7f8ccc',
          400: '#4e62b8',
          500: '#192250',
          600: '#151c43',
          700: '#111737',
          800: '#0d122b',
          900: '#090d1f',
        },
        secondary: {
          50:  '#fff0f5',
          100: '#ffd6e8',
          200: '#ffadd1',
          300: '#ff75b0',
          400: '#f54b90',
          500: '#EE2770',
          600: '#d11f62',
          700: '#b01753',
          800: '#8d1043',
          900: '#6a0a33',
        },
      },
    },
  },
  plugins: [],
}
