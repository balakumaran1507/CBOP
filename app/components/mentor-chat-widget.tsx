'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'

interface MentorMessage {
  role: 'user' | 'assistant'
  content: string
  ts: string
}

const btnPrimary: React.CSSProperties = {
  background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6,
  height: 32, padding: '0 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
}

// Reusable embedded Mentor Council chat panel - used on dedicated domain pages
// (Tax, Legal, Audit, Accounting) so the AI is one part of the page, not the whole page.

export function MentorChatWidget({ persona, title, placeholder, height = 380 }: {
  persona: string
  title: string
  placeholder?: string
  height?: number
}) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, refetch } = useQuery<{ messages: MentorMessage[] }>({
    queryKey: ['mentor-history', persona],
    queryFn: async () => {
      const res = await fetch(`/api/mentor/history/${persona}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const messages = data?.messages ?? []

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    if (!input.trim() || sending) return
    setSending(true)
    setInput('')
    await fetch('/api/mentor/chat', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona, message: input.trim() }),
    })
    setSending(false)
    refetch()
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, display: 'flex', flexDirection: 'column', height }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #D5DBDB' }}>
        <span style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14 }}>{title}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {isLoading && <div style={{ color: '#AAB5BB', fontSize: 12, textAlign: 'center', marginTop: 16 }}>Loading…</div>}
        {!isLoading && messages.length === 0 && (
          <div style={{ color: '#AAB5BB', fontSize: 12, textAlign: 'center', marginTop: 16 }}>{placeholder ?? 'Ask a question to get started'}</div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '85%', padding: '8px 12px', borderRadius: m.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
              background: m.role === 'user' ? '#0073BB' : '#F2F3F3', color: m.role === 'user' ? '#fff' : '#16191F',
              fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {sending && <div style={{ fontSize: 12, color: '#AAB5BB' }}>Thinking…</div>}
        <div ref={endRef} />
      </div>
      <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #D5DBDB' }}>
        <input
          style={{ flex: 1, border: '1px solid #D5DBDB', borderRadius: 6, padding: '0 10px', fontSize: 12.5, height: 32 }}
          placeholder="Type and press Enter…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
        />
        <button onClick={send} disabled={sending || !input.trim()} style={{ ...btnPrimary, height: 32 }}>Send</button>
      </div>
    </div>
  )
}
