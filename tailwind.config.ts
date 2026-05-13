import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        topbar: '#232F3E',
        sidebar: '#16191F',
        bg: '#F2F3F3',
        card: '#FFFFFF',
        border: '#D5DBDB',
        text1: '#16191F',
        text2: '#687078',
        text3: '#AAB5BB',
        amber: '#E8820C',
        green: '#1D8102',
        red: '#D13212',
        blue: '#0073BB',
      },
      fontFamily: {
        syne: ['Syne', 'sans-serif'],
        inter: ['Inter', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
