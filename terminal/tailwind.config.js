import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    join(__dirname, 'index.html'),
    join(__dirname, 'src/**/*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0a0e1a',
          panel: '#0f1629',
          card: '#141d35',
          border: '#1e2d4e',
          hover: '#1a2540',
        },
        up: '#00d4a4',
        down: '#ff4757',
        warn: '#ffa502',
        accent: '#3b82f6',
        muted: '#4a5568',
        dim: '#2d3748',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
}
