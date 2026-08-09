'use client'

import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'

interface PdfViewerProps {
  url: string
  height?: string
  className?: string
}

export function PdfViewer({ url, height = '600px', className }: PdfViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    setLoading(true)
    setError(null)
    setBlobUrl(null)

    // Rewrite /uploads/resumes/... → /api/uploads/resumes/... so Next.js serves it
    const fetchUrl = url.startsWith('/uploads/') ? url.replace('/uploads/', '/api/uploads/') : url

    fetch(fetchUrl, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} - file not found`)
        return r.blob()
      })
      .then(blob => {
        objectUrl = URL.createObjectURL(blob)
        setBlobUrl(objectUrl)
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))

    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [url])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height, color: '#687078', fontSize: 13 }}>
        Loading resume…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: '#D13212', fontSize: 13, lineHeight: 1.6 }}>
        <div style={{ marginBottom: 8 }}>Could not load resume: {error}</div>
        <a href={url.replace('/uploads/', '/api/uploads/')} target="_blank" rel="noreferrer"
          style={{ color: '#0073BB', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Open in new tab <ExternalLink size={14} />
        </a>
      </div>
    )
  }

  return (
    <iframe
      src={`${blobUrl}#toolbar=1&navpanes=1&scrollbar=1`}
      style={{ width: '100%', height, border: 'none', borderRadius: 4 }}
      className={className}
      title="Resume PDF"
    />
  )
}
