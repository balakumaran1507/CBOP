import type { Config } from 'tailwindcss'

// Same tokens as the main CBOP app's tailwind.config.ts (CLAUDE.md "Design
// system") - the accounting app is its own SaaS shell, not a fork of CBOP's
// look, but it starts from the same palette/fonts so it doesn't clash when a
// user moves between cbop.etherence.com and accounting.etherence.com.
// Bala does UI visuals himself - this is scaffolding, not a finished design.
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
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
        // Space Grotesk, not Syne - this app's own display face. See app/layout.tsx.
        display: ['var(--font-display)', 'sans-serif'],
        inter: ['var(--font-inter)', 'sans-serif'],
        mono: ['var(--font-ibm-plex-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
