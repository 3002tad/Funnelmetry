/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#818CF8',
        success: '#34D399',
        warning: '#FBBF24',
        danger: '#F87171',
        info: '#22D3EE',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'fade-up': 'fadeUp 0.5s ease-out forwards',
      },
      keyframes: {
        glow: {
          '0%':   { boxShadow: '0 0 20px rgba(129, 140, 248, 0.15)' },
          '100%': { boxShadow: '0 0 35px rgba(129, 140, 248, 0.35)' },
        },
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backgroundImage: {
        'gradient-mesh': 'radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(168, 85, 247, 0.10) 0px, transparent 50%), radial-gradient(at 50% 100%, rgba(34, 211, 238, 0.08) 0px, transparent 50%)',
      },
    },
  },
  plugins: [],
}
