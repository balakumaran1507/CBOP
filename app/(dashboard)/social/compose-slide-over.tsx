'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles, Loader2 } from 'lucide-react'
import { SlideOver } from '@/app/components/slide-over'

interface Connection {
  id: string
  company_id: string
  platform: string
  account_name: string | null
}

interface BlogPost { id: string; title: string }
interface JobRole { id: string; title: string }

interface Props {
  open: boolean
  companyId: string
  connections: Connection[]
  onClose: () => void
  onSaved: () => void
}

const inputStyle: React.CSSProperties = {
  border: '1px solid #D5DBDB', borderRadius: 6, padding: '8px 10px',
  fontSize: 13, background: '#fff', outline: 'none', boxSizing: 'border-box', width: '100%',
}

const btnPrimary: React.CSSProperties = {
  background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6,
  height: 34, padding: '0 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

const btnGhost: React.CSSProperties = {
  background: 'transparent', color: '#0073BB', border: '1px solid #D5DBDB', borderRadius: 6,
  height: 34, padding: '0 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
}

export function ComposeSlideOver({ open, companyId, connections, onClose, onSaved }: Props) {
  const [connectionId, setConnectionId] = useState('')
  const [content, setContent]           = useState('')
  const [mediaUrl, setMediaUrl]         = useState('')
  const [sourceType, setSourceType]     = useState<'manual' | 'blog_post' | 'job_listing'>('manual')
  const [sourceId, setSourceId]         = useState('')
  const [freePrompt, setFreePrompt]     = useState('')
  const [generating, setGenerating]     = useState(false)
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState('')
  const [aiGenerated, setAiGenerated]   = useState(false)

  useEffect(() => {
    if (open) {
      setConnectionId(connections[0]?.id ?? '')
      setContent(''); setMediaUrl(''); setSourceType('manual'); setSourceId(''); setFreePrompt('')
      setError(''); setAiGenerated(false)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: blogPosts = [] } = useQuery<BlogPost[]>({
    queryKey: ['blog-posts-for-social', companyId],
    queryFn: async () => {
      const res = await fetch(`/api/blog/posts?company_id=${companyId}`, { credentials: 'include' })
      const data = await res.json()
      return data.posts ?? []
    },
    enabled: open && sourceType === 'blog_post',
  })

  const { data: jobRoles = [] } = useQuery<JobRole[]>({
    queryKey: ['job-roles-for-social', companyId],
    queryFn: async () => {
      const res = await fetch(`/api/hiring/roles?company_id=${companyId}`, { credentials: 'include' })
      const data = await res.json()
      return data.roles ?? []
    },
    enabled: open && sourceType === 'job_listing',
  })

  const generateDraft = async () => {
    setGenerating(true); setError('')
    try {
      const res = await fetch('/api/social/posts/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          source_type: sourceType,
          source_id: sourceType !== 'manual' ? sourceId : undefined,
          prompt: sourceType === 'manual' ? freePrompt : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Draft generation failed'); return }
      setContent(data.draft)
      setAiGenerated(true)
    } finally { setGenerating(false) }
  }

  const save = async (publish: boolean) => {
    if (!connectionId) { setError('Select a LinkedIn connection first'); return }
    if (!content.trim()) { setError('Post content is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/social/posts', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId, connection_id: connectionId, content,
          media_url: mediaUrl || undefined, ai_generated: aiGenerated,
          source_type: sourceType, source_id: sourceId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to save draft'); return }

      if (publish) {
        const pubRes = await fetch(`/api/social/posts/${data.post.id}/publish`, { method: 'POST', credentials: 'include' })
        const pubData = await pubRes.json()
        if (!pubRes.ok) { setError(pubData.error || 'Saved as draft, but publish failed'); onSaved(); return }
      }
      onSaved()
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <SlideOver isOpen={open} onClose={onClose} title="New Post" width="lg">
        <div style={{ flex: 1, overflowY: 'auto', padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#16191F', display: 'block', marginBottom: 6 }}>Post as</label>
            <select style={inputStyle} value={connectionId} onChange={e => setConnectionId(e.target.value)}>
              {connections.length === 0 && <option value="">No LinkedIn connections yet</option>}
              {connections.map(c => <option key={c.id} value={c.id}>{c.account_name ?? 'LinkedIn'} ({c.platform})</option>)}
            </select>
          </div>

          <div style={{ background: '#F9FAFB', border: '1px solid #E8EAED', borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Sparkles size={14} color="#0073BB" />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>AI-assist draft</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(['manual', 'blog_post', 'job_listing'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => { setSourceType(t); setSourceId('') }}
                  style={{
                    ...btnGhost, height: 28, fontSize: 11.5,
                    background: sourceType === t ? '#0073BB' : 'transparent',
                    color: sourceType === t ? '#fff' : '#0073BB',
                  }}
                >
                  {t === 'manual' ? 'Freeform' : t === 'blog_post' ? 'From blog post' : 'From job listing'}
                </button>
              ))}
            </div>

            {sourceType === 'manual' && (
              <textarea
                style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }}
                placeholder="What should the post be about?"
                value={freePrompt}
                onChange={e => setFreePrompt(e.target.value)}
              />
            )}
            {sourceType === 'blog_post' && (
              <select style={inputStyle} value={sourceId} onChange={e => setSourceId(e.target.value)}>
                <option value="">Select a blog post</option>
                {blogPosts.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            )}
            {sourceType === 'job_listing' && (
              <select style={inputStyle} value={sourceId} onChange={e => setSourceId(e.target.value)}>
                <option value="">Select an open role</option>
                {jobRoles.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            )}

            <button
              onClick={generateDraft}
              disabled={generating || (sourceType !== 'manual' && !sourceId)}
              style={{ ...btnGhost, marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: generating ? 0.6 : 1 }}
            >
              {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {generating ? 'Generating…' : 'Generate draft'}
            </button>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#16191F', display: 'block', marginBottom: 6 }}>Post content</label>
            <textarea
              style={{ ...inputStyle, minHeight: 160, resize: 'vertical', fontFamily: 'inherit' }}
              placeholder="Write or generate a post…"
              value={content}
              onChange={e => { setContent(e.target.value); setAiGenerated(false) }}
            />
            <p style={{ fontSize: 11, color: '#AAB5BB', margin: '4px 0 0', textAlign: 'right' }}>{content.length} characters</p>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#16191F', display: 'block', marginBottom: 6 }}>Link (optional)</label>
            <input style={inputStyle} placeholder="https://…" value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} />
          </div>

          {error && <p style={{ fontSize: 12.5, color: '#D13212', margin: 0 }}>{error}</p>}
        </div>

        <div style={{ padding: '16px 28px', borderTop: '1px solid #E8EAED', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
          <button style={btnGhost} onClick={() => save(false)} disabled={saving}>Save Draft</button>
          <button style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} onClick={() => save(true)} disabled={saving}>
            {saving ? 'Publishing…' : 'Publish Now'}
          </button>
        </div>
    </SlideOver>
  )
}
