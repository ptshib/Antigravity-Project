/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#0F172A',
          dark: '#1E293B',
          blue: '#1E40AF',
          sky: '#0284C7',
          skyLight: '#E0F2FE',
          accent: '#F59E0B',
          accentHover: '#D97706',
          success: '#10B981',
          danger: '#EF4444',
          bgLight: '#F8FAFC',
          card: '#FFFFFF'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
