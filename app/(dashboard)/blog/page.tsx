'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, FileText, Clock, CheckCircle2 } from 'lucide-react'
import dynamic from 'next/dynamic'

import type { PostEditorProps } from './post-editor'

// Tiptap + its extensions are heavy - lazy-load the editor so the post list
// route stays light, same pattern as app/(dashboard)/templates/page.tsx.
const PostEditor = dynamic<PostEditorProps>(
  () => import('./post-editor'),
  { ssr: false, loading: () => null }
)

// ── Types ─────────────────────────────────────────────────────────────────────

type PostStatus = 'draft' | 'scheduled' | 'published'

interface Company { id: string; name: string }

interface Post {
  id: string
  company_id: string
  company_name: string
  title: string
  slug: string
  excerpt: string | null
  status: PostStatus
  scheduled_at: string | null
  published_at: string | null
  category: string | null
  tags: string[]
  updated_at: string
  author_name: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: 'var(--font-ibm-plex-mono), monospace' }

const btnPrimary: React.CSSProperties = {
  background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6,
  height: 36, padding: '0 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
}

const inputStyle: React.CSSProperties = {
  border: '1px solid #D5DBDB', borderRadius: 6, height: 34, padding: '0 10px',
  fontSize: 12.5, background: '#fff', outline: 'none', boxSizing: 'border-box',
}

const STATUS_STYLE: Record<PostStatus, { bg: string; color: string; icon: typeof FileText }> = {
  draft:     { bg: '#F2F3F3', color: '#687078', icon: FileText },
  scheduled: { bg: '#FFF3E0', color: '#E8820C', icon: Clock },
  published: { bg: '#E6F4EA', color: '#1D8102', icon: CheckCircle2 },
}

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BlogPage() {
  const qc = useQueryClient()
  const [companyFilter, setCompanyFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | PostStatus>('all')
  const [editingPostId, setEditingPostId] = useState<string | null | 'new'>(null)

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies-list'],
    queryFn: async () => { const res = await fetch('/api/companies', { credentials: 'include' }); return res.json() },
  })
  const companies = companiesData?.companies ?? []

  const { data: postsData, isLoading } = useQuery<{ posts: Post[] }>({
    queryKey: ['blog-posts', companyFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (companyFilter) params.set('company_id', companyFilter)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/blog/posts?${params}`, { credentials: 'include' })
      return res.json()
    },
  })
  const posts = postsData?.posts ?? []

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/blog/posts/${id}`, { method: 'DELETE', credentials: 'include' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blog-posts'] }),
  })

  if (editingPostId !== null) {
    return (
      <PostEditor
        postId={editingPostId === 'new' ? null : editingPostId}
        companies={companies}
        onClose={() => setEditingPostId(null)}
        onSaved={() => { setEditingPostId(null); qc.invalidateQueries({ queryKey: ['blog-posts'] }) }}
      />
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 1300 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700, fontSize: 22, color: '#16191F', margin: '0 0 4px' }}>Blog</h1>
          <p style={{ fontSize: 13, color: '#687078', margin: 0 }}>Write, schedule, and publish posts across all company sites</p>
        </div>
        <button onClick={() => setEditingPostId('new')} style={btnPrimary}><Plus size={14} /> New Post</button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <select style={{ ...inputStyle, width: 200 }} value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}>
          <option value="">All companies</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'draft', 'scheduled', 'published'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500, textTransform: 'capitalize',
                border: statusFilter === s ? 'none' : '1px solid #D5DBDB',
                background: statusFilter === s ? '#0073BB' : '#fff',
                color: statusFilter === s ? '#fff' : '#16191F', cursor: 'pointer',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#AAB5BB' }}>Loading…</div>
        ) : posts.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#AAB5BB' }}>No posts yet - click New Post to write your first one</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F2F3F3' }}>
                {['Title', 'Company', 'Category', 'Status', 'Updated', ''].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#687078' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {posts.map(p => {
                const s = STATUS_STYLE[p.status]
                const Icon = s.icon
                return (
                  <tr key={p.id} style={{ borderTop: '1px solid #F2F3F3' }}>
                    <td style={{ padding: '10px 16px', cursor: 'pointer' }} onClick={() => setEditingPostId(p.id)}>
                      <div style={{ fontWeight: 600, color: '#16191F' }}>{p.title}</div>
                      {p.excerpt && <div style={{ fontSize: 11.5, color: '#687078', marginTop: 2, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.excerpt}</div>}
                    </td>
                    <td style={{ padding: '10px 16px' }}>{p.company_name}</td>
                    <td style={{ padding: '10px 16px', color: '#687078' }}>{p.category ?? '-'}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 12, background: s.bg, color: s.color, textTransform: 'capitalize' }}>
                        <Icon size={11} /> {p.status}
                      </span>
                      {p.status === 'scheduled' && p.scheduled_at && (
                        <div style={{ fontSize: 10.5, color: '#687078', marginTop: 3, ...mono }}>{fmtDate(p.scheduled_at)}</div>
                      )}
                    </td>
                    <td style={{ padding: '10px 16px', ...mono, fontSize: 11.5, color: '#687078' }}>{fmtDate(p.updated_at)}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <button
                        onClick={() => { if (confirm('Delete this post?')) deleteMut.mutate(p.id) }}
                        style={{ background: 'none', border: 'none', color: '#D13212', fontSize: 11.5, cursor: 'pointer', padding: 0 }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
