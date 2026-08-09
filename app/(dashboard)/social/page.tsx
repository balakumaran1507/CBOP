'use client'

import { Fragment, useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Video, Camera, Users as UsersIcon, Music2, Briefcase, TrendingUp, Users, MessageCircle, Eye, AlertTriangle, Sparkles, Plus, Send, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ComposeSlideOver } from './compose-slide-over'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string }

interface PlatformInfo {
  key: string
  label: string
  setup: string
  recommended: boolean
}

interface Connection {
  id: string
  company_id: string
  company_name: string
  platform: string
  connection_type: 'member' | 'organization' | null
  account_name: string | null
  connected_at: string
}

interface Post {
  id: string
  company_id: string
  content: string
  status: 'draft' | 'scheduled' | 'published' | 'failed'
  platform: string
  account_name: string | null
  ai_generated: boolean
  external_post_urn: string | null
  error_message: string | null
  created_at: string
}

const STATUS_COLOR: Record<Post['status'], string> = {
  draft: '#687078', scheduled: '#E8820C', published: '#1D8102', failed: '#D13212',
}

interface Snapshot {
  snapshot_date: string
  followers: number
  total_likes: number
  total_comments: number
  total_shares: number
  total_reach: number
  platform: string
  account_name: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: 'var(--font-ibm-plex-mono), monospace' }

const inputStyle: React.CSSProperties = {
  border: '1px solid #D5DBDB', borderRadius: 6, height: 34, padding: '0 10px',
  fontSize: 13, background: '#fff', outline: 'none', boxSizing: 'border-box',
}

const btnGhost: React.CSSProperties = {
  background: 'transparent', color: '#0073BB', border: '1px solid #D5DBDB', borderRadius: 6,
  height: 30, padding: '0 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
}

const PLATFORM_ICON: Record<string, LucideIcon> = {
  youtube: Video, instagram: Camera, facebook: UsersIcon, tiktok: Music2, x: Music2, linkedin: Briefcase,
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ── Sample data for the "preview" toggle - clearly labeled, never shown as real ─

const SAMPLE_SNAPSHOTS: Snapshot[] = Array.from({ length: 12 }, (_, i) => {
  const d = new Date()
  d.setDate(d.getDate() - (11 - i) * 7)
  return {
    snapshot_date: d.toISOString(),
    followers: 4200 + i * 85 + Math.round(Math.sin(i) * 40),
    total_likes: 1200 + i * 60,
    total_comments: 140 + i * 8,
    total_shares: 60 + i * 4,
    total_reach: 18000 + i * 900,
    platform: 'instagram',
    account_name: 'sample_account',
  }
})

// ── Trend chart (SVG, same pattern as Command Panel / Accounting charts) ─────

function TrendChart({ data, dataKey, color, label }: { data: Snapshot[]; dataKey: keyof Snapshot; color: string; label: string }) {
  if (data.length < 2) {
    return <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#AAB5BB', fontSize: 12 }}>Not enough history yet</div>
  }
  const W = 320, H = 100
  const pad = { l: 4, r: 4, t: 8, b: 18 }
  const cw = W - pad.l - pad.r
  const ch = H - pad.t - pad.b
  const values = data.map(d => Number(d[dataKey]))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const pts = data.map((d, i) => {
    const x = pad.l + (i / (data.length - 1)) * cw
    const y = pad.t + ch - ((Number(d[dataKey]) - min) / range) * ch
    return `${x},${y}`
  })
  const line = 'M ' + pts.join(' L ')

  return (
    <div>
      <p style={{ fontSize: 11, color: '#687078', margin: '0 0 4px' }}>{label}</p>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 100 }}>
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => {
          if (i % Math.max(1, Math.floor(data.length / 5)) !== 0) return null
          const x = pad.l + (i / (data.length - 1)) * cw
          return <text key={i} x={x} y={H - 4} textAnchor="middle" fontSize={9} fill="#AAB5BB">{fmtDate(d.snapshot_date)}</text>
        })}
      </svg>
    </div>
  )
}

// ── Best-time-to-post heatmap (illustrative shape - real data needed to populate) ─

function BestTimeHeatmap({ sample }: { sample: boolean }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const hours = [6, 9, 12, 15, 18, 21]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `50px repeat(${hours.length}, 1fr)`, gap: 3 }}>
        <div />
        {hours.map(h => <div key={h} style={{ ...mono, fontSize: 9, color: '#AAB5BB', textAlign: 'center' }}>{h}:00</div>)}
        {days.map(day => (
          <Fragment key={day}>
            <div style={{ fontSize: 10.5, color: '#687078', display: 'flex', alignItems: 'center' }}>{day}</div>
            {hours.map(h => {
              const intensity = sample ? Math.abs(Math.sin(day.length + h)) : 0
              return (
                <div
                  key={`${day}-${h}`}
                  style={{
                    height: 20, borderRadius: 3,
                    background: sample ? `rgba(0,115,187,${0.15 + intensity * 0.6})` : '#F2F3F3',
                  }}
                />
              )
            })}
          </Fragment>
        ))}
      </div>
      {!sample && <p style={{ fontSize: 11, color: '#AAB5BB', marginTop: 8 }}>Connect an account and let it collect a few weeks of post history to populate this.</p>}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SocialPage() {
  const [companyId, setCompanyId] = useState('')
  const [showSample, setShowSample] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies-list'],
    queryFn: async () => { const res = await fetch('/api/companies', { credentials: 'include' }); return res.json() },
  })
  const companies = companiesData?.companies ?? []
  useEffect(() => { if (!companyId && companies.length > 0) setCompanyId(companies[0].id) }, [companies, companyId])

  const { data: platformsData } = useQuery<{ platforms: PlatformInfo[]; linkedin_configured: boolean }>({
    queryKey: ['social-platforms'],
    queryFn: async () => { const res = await fetch('/api/social/platforms', { credentials: 'include' }); return res.json() },
  })
  const platforms = platformsData?.platforms ?? []
  const linkedinConfigured = platformsData?.linkedin_configured ?? false

  const { data: connectionsData } = useQuery<{ connections: Connection[] }>({
    queryKey: ['social-connections'],
    queryFn: async () => { const res = await fetch('/api/social/connections', { credentials: 'include' }); return res.json() },
  })
  const connections = connectionsData?.connections ?? []
  const connectedByCompany = connections.filter(c => c.company_id === companyId)
  const linkedinConnections = connectedByCompany.filter(c => c.platform === 'linkedin' && !(c.connection_type === 'organization' && c.account_name === 'Pending organization URN'))

  const { data: postsData, refetch: refetchPosts } = useQuery<{ posts: Post[] }>({
    queryKey: ['social-posts', companyId],
    queryFn: async () => { const res = await fetch(`/api/social/posts?companyId=${companyId}`, { credentials: 'include' }); return res.json() },
    enabled: !!companyId,
  })
  const posts = postsData?.posts ?? []

  const publishPost = async (id: string) => {
    await fetch(`/api/social/posts/${id}/publish`, { method: 'POST', credentials: 'include' })
    refetchPosts()
  }
  const deletePost = async (id: string) => {
    await fetch(`/api/social/posts/${id}`, { method: 'DELETE', credentials: 'include' })
    refetchPosts()
  }

  const { data: trendsData } = useQuery<{ snapshots: Snapshot[]; has_data: boolean }>({
    queryKey: ['social-trends', companyId],
    queryFn: async () => { const res = await fetch(`/api/social/trends/${companyId}`, { credentials: 'include' }); return res.json() },
    enabled: !!companyId,
  })
  const realSnapshots = trendsData?.snapshots ?? []
  const snapshots = showSample ? SAMPLE_SNAPSHOTS : realSnapshots
  const hasRealData = trendsData?.has_data ?? false

  const latest = snapshots[snapshots.length - 1]
  const prior = snapshots[snapshots.length - 2]
  const followerDelta = latest && prior ? latest.followers - prior.followers : 0

  return (
    <div style={{ padding: 24, maxWidth: 1300 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700, fontSize: 22, color: '#16191F', margin: '0 0 4px' }}>Social Media Manager</h1>
          <p style={{ fontSize: 13, color: '#687078', margin: 0 }}>Owned-account publishing and engagement trends - not industry-wide listening</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select style={{ ...inputStyle, width: 180 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* Prototype disclosure - honest about build stage */}
      <div style={{ background: '#EBF4FB', border: '1px solid #BFE0F5', borderRadius: 6, padding: '10px 14px', margin: '16px 0', fontSize: 12.5, color: '#0073BB', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Sparkles size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          <strong>LinkedIn publishing is live</strong> - personal-profile posting works end-to-end below. Company-page posting is wired up too but stays
          disabled until LinkedIn actually grants Community Management API access (see the LinkedIn card). Other platforms&apos; OAuth flows aren&apos;t built yet.
          Toggle &quot;Preview with sample data&quot; to see the engagement charts populated.
        </span>
      </div>

      {/* Platform connection cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
        {platforms.map(p => {
          const Icon = PLATFORM_ICON[p.key] ?? Video
          const conn = connectedByCompany.find(c => c.platform === p.key && c.connection_type !== 'organization')
          const orgConn = connectedByCompany.find(c => c.platform === p.key && c.connection_type === 'organization')
          const isLinkedIn = p.key === 'linkedin'

          return (
            <div key={p.key} style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Icon size={16} color={p.recommended ? '#0073BB' : '#AAB5BB'} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</span>
                {!p.recommended && <AlertTriangle size={12} color="#E8820C" style={{ marginLeft: 'auto' }} />}
              </div>
              <p style={{ fontSize: 11, color: '#687078', margin: '0 0 10px', lineHeight: 1.4, minHeight: 44 }}>{p.setup}</p>

              {isLinkedIn ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {conn ? (
                    <span style={{ fontSize: 11, color: '#1D8102', fontWeight: 600 }}>Personal: {conn.account_name}</span>
                  ) : linkedinConfigured && companyId ? (
                    <a href={`/api/social/linkedin/auth?company_id=${companyId}&connection_type=member`} style={{ ...btnGhost, width: '100%', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box', display: 'block' }}>
                      Connect personal profile
                    </a>
                  ) : (
                    <button disabled style={{ ...btnGhost, opacity: 0.5, cursor: 'not-allowed', width: '100%' }} title="Set LINKEDIN_CLIENT_ID/SECRET in .env">
                      Not configured
                    </button>
                  )}
                  {orgConn ? (
                    <span style={{ fontSize: 11, color: '#1D8102', fontWeight: 600 }}>Company page: {orgConn.account_name}</span>
                  ) : linkedinConfigured && companyId ? (
                    <a href={`/api/social/linkedin/auth?company_id=${companyId}&connection_type=organization`} style={{ ...btnGhost, width: '100%', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box', display: 'block', fontSize: 11 }} title="Only works once LinkedIn has granted Community Management API Standard Tier access">
                      Connect company page
                    </a>
                  ) : null}
                </div>
              ) : conn ? (
                <span style={{ fontSize: 11, color: '#1D8102', fontWeight: 600 }}>Connected: {conn.account_name ?? conn.id}</span>
              ) : (
                <button disabled style={{ ...btnGhost, opacity: 0.5, cursor: 'not-allowed', width: '100%' }} title="OAuth flow not wired up yet">
                  Connect (coming soon)
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Publish queue */}
      <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 18, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: 0 }}>Posts</p>
            <p style={{ fontSize: 11, color: '#687078', margin: '2px 0 0' }}>AI-assisted drafts reviewed by a human before anything publishes</p>
          </div>
          <button
            onClick={() => setComposeOpen(true)}
            disabled={linkedinConnections.length === 0}
            style={{ ...btnGhost, opacity: linkedinConnections.length === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
            title={linkedinConnections.length === 0 ? 'Connect a LinkedIn profile first' : undefined}
          >
            <Plus size={14} /> New Post
          </button>
        </div>

        {posts.length === 0 ? (
          <p style={{ fontSize: 13, color: '#AAB5BB', textAlign: 'center', padding: '20px 0' }}>No posts yet</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {posts.map(post => (
              <div key={post.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid #F2F3F3', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: STATUS_COLOR[post.status], textTransform: 'uppercase', letterSpacing: 0.3 }}>{post.status}</span>
                    {post.ai_generated && <span style={{ fontSize: 10, color: '#0073BB', display: 'flex', alignItems: 'center', gap: 3 }}><Sparkles size={10} /> AI-assisted</span>}
                    <span style={{ ...mono, fontSize: 10.5, color: '#AAB5BB' }}>{fmtDate(post.created_at)}</span>
                  </div>
                  <p style={{ fontSize: 12.5, margin: 0, color: '#16191F', whiteSpace: 'pre-wrap' }}>{post.content.slice(0, 220)}{post.content.length > 220 ? '…' : ''}</p>
                  {post.error_message && <p style={{ fontSize: 11, color: '#D13212', margin: '4px 0 0' }}>{post.error_message}</p>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {post.status === 'draft' && (
                    <button onClick={() => publishPost(post.id)} title="Publish now" style={{ background: 'none', border: '1px solid #D5DBDB', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Send size={13} color="#0073BB" />
                    </button>
                  )}
                  {post.status !== 'published' && (
                    <button onClick={() => deletePost(post.id)} title="Delete" style={{ background: 'none', border: '1px solid #D5DBDB', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Trash2 size={13} color="#D13212" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ComposeSlideOver
        open={composeOpen}
        companyId={companyId}
        connections={linkedinConnections}
        onClose={() => setComposeOpen(false)}
        onSaved={() => { refetchPosts(); queryClient.invalidateQueries({ queryKey: ['social-connections'] }) }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#687078', cursor: 'pointer' }}>
          <input type="checkbox" checked={showSample} onChange={e => setShowSample(e.target.checked)} />
          Preview with sample data
        </label>
        {!hasRealData && !showSample && (
          <span style={{ fontSize: 11.5, color: '#AAB5BB' }}>No real data yet - connect an account or check the sample preview above</span>
        )}
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><Users size={13} color="#687078" /><span style={{ fontSize: 10.5, color: '#687078', textTransform: 'uppercase' }}>Followers</span></div>
          <p style={{ ...mono, fontSize: 20, fontWeight: 700, margin: 0 }}>{latest ? fmtNum(latest.followers) : '-'}</p>
          {followerDelta !== 0 && <p style={{ fontSize: 11, margin: '2px 0 0', color: followerDelta > 0 ? '#1D8102' : '#D13212' }}>{followerDelta > 0 ? '+' : ''}{followerDelta} this week</p>}
        </div>
        <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><MessageCircle size={13} color="#687078" /><span style={{ fontSize: 10.5, color: '#687078', textTransform: 'uppercase' }}>Comments</span></div>
          <p style={{ ...mono, fontSize: 20, fontWeight: 700, margin: 0 }}>{latest ? fmtNum(latest.total_comments) : '-'}</p>
        </div>
        <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><TrendingUp size={13} color="#687078" /><span style={{ fontSize: 10.5, color: '#687078', textTransform: 'uppercase' }}>Engagement rate</span></div>
          <p style={{ ...mono, fontSize: 20, fontWeight: 700, margin: 0 }}>
            {latest && latest.followers > 0 ? (((latest.total_likes + latest.total_comments + latest.total_shares) / latest.followers) * 100).toFixed(1) + '%' : '-'}
          </p>
        </div>
        <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><Eye size={13} color="#687078" /><span style={{ fontSize: 10.5, color: '#687078', textTransform: 'uppercase' }}>Reach</span></div>
          <p style={{ ...mono, fontSize: 20, fontWeight: 700, margin: 0 }}>{latest ? fmtNum(latest.total_reach) : '-'}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 18 }}>
          <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 12px' }}>Engagement Trend</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <TrendChart data={snapshots} dataKey="followers" color="#0073BB" label="Followers" />
            <TrendChart data={snapshots} dataKey="total_likes" color="#1D8102" label="Likes" />
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 18 }}>
          <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 4px' }}>Best Time to Post</p>
          <p style={{ fontSize: 11, color: '#687078', margin: '0 0 12px' }}>Derived from this account&apos;s own post history, not generic averages</p>
          <BestTimeHeatmap sample={showSample} />
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 18, marginTop: 20 }}>
        <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 4px' }}>Live Mentions &amp; Comments</p>
        <p style={{ fontSize: 11, color: '#687078', margin: '0 0 12px' }}>Real-time via Meta webhooks for Instagram/Facebook once connected; polled every 15-30 min for other platforms</p>
        {showSample ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { name: 'sample_user_1', text: 'Great post, really useful breakdown!', platform: 'Instagram', mins: 4 },
              { name: 'sample_user_2', text: 'When is the next batch open?', platform: 'Instagram', mins: 22 },
              { name: 'sample_channel', text: 'Shared this with the team', platform: 'YouTube', mins: 55 },
            ].map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: i < 2 ? '1px solid #F2F3F3' : 'none' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#EBF4FB', color: '#0073BB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                  {m.name[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12.5, margin: 0 }}><strong>{m.name}</strong> · <span style={{ color: '#687078' }}>{m.platform}</span></p>
                  <p style={{ fontSize: 12.5, color: '#16191F', margin: '2px 0 0' }}>{m.text}</p>
                </div>
                <span style={{ ...mono, fontSize: 10.5, color: '#AAB5BB', flexShrink: 0 }}>{m.mins}m ago</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: '#AAB5BB', textAlign: 'center', padding: '24px 0' }}>No connected accounts yet</p>
        )}
      </div>
    </div>
  )
}
