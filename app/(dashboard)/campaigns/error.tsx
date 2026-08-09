'use client'
import { useEffect } from 'react'

export default function CampaignsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[/campaigns] client error:', error)
  }, [error])

  return (
    <div style={{ padding: '40px 32px', maxWidth: 600 }}>
      <div style={{ background: '#FFF5F5', border: '1px solid #D13212', borderRadius: 8, padding: '24px 28px' }}>
        <h2 style={{ fontFamily: 'Syne, sans-serif', color: '#D13212', margin: '0 0 12px', fontSize: 18 }}>
          Campaigns failed to load
        </h2>
        <p style={{ color: '#444', fontSize: 13, margin: '0 0 8px' }}>
          {error.message || 'An unexpected error occurred.'}
        </p>
        {error.digest && (
          <p style={{ color: '#888', fontSize: 11, fontFamily: 'IBM Plex Mono', margin: '0 0 16px' }}>
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          style={{
            background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6,
            padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
