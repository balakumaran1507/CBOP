import type { Metadata } from 'next'
import { Inter, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google'
import './globals.css'

// CBOP's own convention is a dedicated display font for headings (Syne) plus
// Inter for UI/body and IBM Plex Mono for every number/amount/date/ID
// (CLAUDE.md "Design system"). This app follows the SAME pattern rather than
// the same fonts — Space Grotesk stands in for Syne as Accounting's own
// display face, giving it a visually distinct identity befitting a separate
// SaaS app, while keeping the numbers-are-always-mono rule (arguably more
// important here than anywhere else in CBOP) and Inter for everything else so
// moving between cbop.etherence.com and this app doesn't feel like a jolt.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const ibmPlexMono = IBM_Plex_Mono({ weight: ['400', '500', '600'], subsets: ['latin'], variable: '--font-ibm-plex-mono', display: 'swap' })
const spaceGrotesk = Space_Grotesk({ weight: ['500', '600', '700'], subsets: ['latin'], variable: '--font-display', display: 'swap' })

export const metadata: Metadata = {
  title: 'CBOP Accounting',
  description: 'Statutory-grade double-entry accounting, connected to CBOP.',
}

// Root layout. Deliberately thin and provider-free — the landing page (app/page.tsx)
// needs none of the authenticated app's plumbing (React Query, session context),
// and giving every route a session dependency would make an unauthenticated
// landing page unable to render if the main CBOP API is ever briefly down.
// The (app) route group below adds its own Providers scoped to itself.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${ibmPlexMono.variable} ${spaceGrotesk.variable} font-inter antialiased`}>
        {children}
      </body>
    </html>
  )
}
