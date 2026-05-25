/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // ── Legacy brand palette (kept so existing pages don't break) ──
        primary: {
          50:  '#eef0f8', 100: '#d5d9ee', 200: '#aab3dd', 300: '#7f8ccc',
          400: '#4e62b8', 500: '#192250', 600: '#151c43', 700: '#111737',
          800: '#0d122b', 900: '#090d1f',
        },
        secondary: {
          50:  '#fff0f5', 100: '#ffd6e8', 200: '#ffadd1', 300: '#ff75b0',
          400: '#f54b90', 500: '#EE2770', 600: '#d11f62', 700: '#b01753',
          800: '#8d1043', 900: '#6a0a33',
        },
        // ── Material 3 semantic tokens (theme-aware via CSS variables) ──
        bg:                  'rgb(var(--bg) / <alpha-value>)',
        surface:             'rgb(var(--surface) / <alpha-value>)',
        'surface-2':         'rgb(var(--surface-2) / <alpha-value>)',
        'surface-3':         'rgb(var(--surface-3) / <alpha-value>)',
        'on-surface':        'rgb(var(--on-surface) / <alpha-value>)',
        'on-surface-muted':  'rgb(var(--on-surface-muted) / <alpha-value>)',
        'on-surface-subtle': 'rgb(var(--on-surface-subtle) / <alpha-value>)',
        brand:               'rgb(var(--primary) / <alpha-value>)',
        'on-brand':          'rgb(var(--on-primary) / <alpha-value>)',
        'brand-container':   'rgb(var(--primary-container) / <alpha-value>)',
        'on-brand-container':'rgb(var(--on-primary-container) / <alpha-value>)',
        accent:              'rgb(var(--accent) / <alpha-value>)',
        'on-accent':         'rgb(var(--on-accent) / <alpha-value>)',
        'accent-container':  'rgb(var(--accent-container) / <alpha-value>)',
        'on-accent-container':'rgb(var(--on-accent-container) / <alpha-value>)',
        success:             'rgb(var(--success) / <alpha-value>)',
        'success-container': 'rgb(var(--success-container) / <alpha-value>)',
        warning:             'rgb(var(--warning) / <alpha-value>)',
        'warning-container': 'rgb(var(--warning-container) / <alpha-value>)',
        danger:              'rgb(var(--error) / <alpha-value>)',
        'danger-container':  'rgb(var(--error-container) / <alpha-value>)',
        outline:             'rgb(var(--outline) / <alpha-value>)',
        'outline-strong':    'rgb(var(--outline-strong) / <alpha-value>)',
      },
      boxShadow: {
        'elev-1': 'var(--elev-1)',
        'elev-2': 'var(--elev-2)',
        'elev-3': 'var(--elev-3)',
        'elev-4': 'var(--elev-4)',
      },
      borderRadius: {
        'xl-2': '16px',
        'xl-3': '20px',
        'xl-4': '28px',
      },
    },
  },
  plugins: [],
}
