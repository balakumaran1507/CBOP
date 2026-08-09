import type { Metadata } from 'next'
import { Inter, Syne, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google'
import { Providers } from './providers'
import { ServiceWorkerRegistration } from './components/ServiceWorkerRegistration'
import './globals.css'

// Design system fonts — all four must be loaded here; globals.css references
// all of them via CSS variables. Missing any one causes the whole app to fall
// back to system fonts for that role (body, headings, or mono numbers).
const inter       = Inter        ({ subsets: ['latin'], variable: '--font-inter',         display: 'swap' })
const syne        = Syne         ({ subsets: ['latin'], variable: '--font-syne',          display: 'swap' })
const ibmPlexMono = IBM_Plex_Mono({ subsets: ['latin'], variable: '--font-ibm-plex-mono', display: 'swap', weight: ['400', '500', '600', '700'] })
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk', display: 'swap' })

export const metadata: Metadata = {
  title: 'CBOP — Your company. One OS.',
  description: 'Internal business operations platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#232F3E" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="CBOP" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className={`${inter.variable} ${syne.variable} ${ibmPlexMono.variable} ${spaceGrotesk.variable} font-sans bg-bg text-text1`}>
        <ServiceWorkerRegistration />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
