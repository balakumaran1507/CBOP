'use client'
import { useEffect } from 'react'

export default function DocumentsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[Documents Error]', error)
  }, [error])

  return (
    <div style={{ padding: 32, maxWidth: 800 }}>
      <h2 style={{ fontFamily: 'Syne, sans-serif', color: '#D13212', marginBottom: 12 }}>
        Documents page error - share this with Bala
      </h2>
      <pre style={{
        background: '#FFF5F5', border: '1px solid #D13212', borderRadius: 8,
        padding: 16, fontSize: 12, fontFamily: 'IBM Plex Mono, monospace',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#D13212',
        marginBottom: 16
      }}>
        {error.message}
        {'\n\n'}
        {error.stack}
      </pre>
      <button
        onClick={reset}
        style={{ background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}
      >
        Try again
      </button>
    </div>
  )
}
