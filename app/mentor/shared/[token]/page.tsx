'use client'

import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'

interface MentorMessage {
  role:    'user' | 'assistant'
  content: string
  ts:      string
}

interface SharedConv {
  persona:       string
  persona_label: string
  messages:      MentorMessage[]
  updated_at:    string
  expires_at:    string
}

export default function SharedMentorPage({ params }: { params: { token: string } }) {
  const { token } = params
  const [data, setData]   = useState<SharedConv | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/mentor/shared/${token}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error: string }) => Promise.reject(e.error)))
      .then(setData)
      .catch(setError)
  }, [token])

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F2F3F3' }}>
      <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 40, textAlign: 'center', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><Lock size={32} /></div>
        <h2 style={{ fontFamily: 'sans-serif', fontWeight: 600, marginBottom: 8 }}>{error === 'Link expired' ? 'Link expired' : 'Not found'}</h2>
        <p style={{ color: '#687078', fontSize: 14 }}>This link has {error === 'Link expired' ? 'expired (72 hour limit)' : 'already been used or does not exist'}</p>
      </div>
    </div>
  )

  if (!data) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F2F3F3', color: '#AAB5BB', fontSize: 14 }}>
      Loading…
    </div>
  )

  const mono: React.CSSProperties = { fontFamily: 'monospace' }

  return (
    <div style={{ minHeight: '100vh', background: '#F2F3F3', padding: '32px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ background: '#232F3E', borderRadius: '8px 8px 0 0', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ color: '#AAB5BB', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mentor Council - Read Only</span>
            <h1 style={{ color: '#fff', fontWeight: 600, fontSize: 16, margin: '4px 0 0', fontFamily: 'sans-serif' }}>{data.persona_label}</h1>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#AAB5BB', fontSize: 11 }}>Expires</div>
            <div style={{ ...mono, color: '#fff', fontSize: 12 }}>{new Date(data.expires_at).toLocaleString('en-IN')}</div>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '75%',
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                background: msg.role === 'user' ? '#0073BB' : '#F2F3F3',
                color: msg.role === 'user' ? '#fff' : '#16191F',
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4, opacity: 0.7, textTransform: 'uppercase' }}>
                  {msg.role === 'user' ? 'CEO' : data.persona_label}
                </div>
                {msg.content}
                <div style={{ fontSize: 10, marginTop: 6, opacity: 0.5, textAlign: 'right' }}>
                  {new Date(msg.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          {data.messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#AAB5BB', padding: 32 }}>No messages in this conversation</div>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#AAB5BB', marginTop: 16 }}>
          Shared via CBOP · This link expires {new Date(data.expires_at).toLocaleString('en-IN')}
        </p>
      </div>
    </div>
  )
}
