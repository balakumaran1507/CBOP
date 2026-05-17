import type { Metadata } from 'next'
import { Inter, IBM_Plex_Mono, Syne } from 'next/font/google'
import { Providers } from './providers'
import { ServiceWorkerRegistration } from './components/ServiceWorkerRegistration'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const ibmPlexMono = IBM_Plex_Mono({ weight: ['400', '500', '600'], subsets: ['latin'], variable: '--font-ibm-plex-mono', display: 'swap' })
const syne = Syne({ subsets: ['latin'], variable: '--font-syne', display: 'swap' })

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
      <body className={`${inter.variable} ${ibmPlexMono.variable} ${syne.variable} font-inter`}>
        <ServiceWorkerRegistration />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
