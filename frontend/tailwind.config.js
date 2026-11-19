/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Legacy tokens now resolve through the PU palette CSS variables so
        // every screen (student, teacher, admin) follows the same theme as Ask.
        chalkboard: 'rgb(var(--pu-canvas-rgb) / <alpha-value>)',
        chalk: 'rgb(var(--pu-text-rgb) / <alpha-value>)',
        'amber-chalk': 'rgb(var(--pu-accent-rgb) / <alpha-value>)',
        'rule-line': 'rgb(var(--pu-line-rgb) / <alpha-value>)',
        sage: 'rgb(var(--pu-sage-rgb) / <alpha-value>)',
        rust: 'rgb(var(--pu-danger-rgb) / <alpha-value>)',
        // Light mode aliases (kept for existing class names)
        'paper-bg': 'rgb(var(--pu-canvas-rgb) / <alpha-value>)',
        'ink-dark': 'rgb(var(--pu-text-rgb) / <alpha-value>)',
        // PU-GPT Ask redesign (driven by CSS variables in globals.css)
        'pu-canvas': 'var(--pu-canvas)',
        'pu-panel': 'var(--pu-panel)',
        'pu-accent': 'var(--pu-accent)',
        'pu-cream': 'var(--pu-cream)',
        'pu-pill': 'var(--pu-pill)',
        'pu-composer': 'var(--pu-composer)',
        'pu-text': 'var(--pu-text)',
        'pu-surface': 'var(--pu-surface)',
      },
      fontFamily: {
        display: ['"Source Serif 4"', 'Lora', 'Georgia', 'serif'],
        body: ['Inter', 'IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'Menlo', 'Monaco', 'monospace'],
        poppins: ['Poppins', 'Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
};