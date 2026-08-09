'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AccountingSessionProvider } from './lib/session-context'
import type { CbopSession } from './lib/get-cbop-session'

export function Providers({ session, children }: { session: CbopSession; children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      <AccountingSessionProvider session={session}>{children}</AccountingSessionProvider>
    </QueryClientProvider>
  )
}
