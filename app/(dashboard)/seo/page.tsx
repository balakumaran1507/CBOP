'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ExternalLink } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Connection {
  id: string
  company_id: string
  company_name: string
  site_url: string
  ga4_property_id: string | null
  connected_at: string
}

interface RankingRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface Sitemap {
  path: string
  lastSubmitted?: string
  isPending?: boolean
  errors?: number
  warnings?: number
}

interface CoreWebVitals {
  lcp_ms: number | null
  inp_ms: number | null
  cls: number | null
  performance_score: number | null
  strategy: 'mobile' | 'desktop'
}

interface IndexingResult {
  coverageState: string
  verdict: string
  lastCrawlTime?: string
}

interface Company { id: string; name: string }

type IssueSeverity = 'error' | 'warning' | 'info'
interface AuditIssue { severity: IssueSeverity; category: string; message: string }
interface Audit { id: string; url: string; score: number; issues: AuditIssue[]; audited_at: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: 'var(--font-ibm-plex-mono), monospace' }

const inputStyle: React.CSSProperties = {
  border: '1px solid #D5DBDB', borderRadius: 6, height: 34, padding: '0 10px',
  fontSize: 13, background: '#fff', outline: 'none', boxSizing: 'border-box',
}
const btnPrimary: React.CSSProperties = {
  background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6,
  height: 34, padding: '0 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
}

function fmtPct(n: number): string { return `${(n * 100).toFixed(1)}%` }
function fmtPos(n: number): string { return n.toFixed(1) }
function fmtMs(n: number | null): string { return n === null ? '-' : `${(n / 1000).toFixed(2)}s` }

function cwvColor(metric: 'lcp' | 'inp' | 'cls', value: number | null): string {
  if (value === null) return '#AAB5BB'
  if (metric === 'lcp') return value <= 2500 ? '#1D8102' : value <= 4000 ? '#E8820C' : '#D13212'
  if (metric === 'inp') return value <= 200 ? '#1D8102' : value <= 500 ? '#E8820C' : '#D13212'
  return value <= 0.1 ? '#1D8102' : value <= 0.25 ? '#E8820C' : '#D13212'
}

const INDEXING_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  SUBMITTED_AND_INDEXED: { bg: '#E6F4EA', color: '#1D8102', label: 'Indexed' },
  CRAWLED_NOT_INDEXED: { bg: '#FFF3E0', color: '#E8820C', label: 'Crawled, not indexed' },
  DISCOVERED_NOT_INDEXED: { bg: '#FFF3E0', color: '#E8820C', label: 'Discovered, not indexed' },
  URL_IS_UNKNOWN: { bg: '#FDECEA', color: '#D13212', label: 'Unknown to Google' },
}

function scoreColor(score: number): string {
  return score >= 90 ? '#1D8102' : score >= 70 ? '#E8820C' : '#D13212'
}

const SEVERITY_STYLE: Record<IssueSeverity, { color: string; label: string }> = {
  error: { color: '#D13212', label: 'Error' },
  warning: { color: '#E8820C', label: 'Warning' },
  info: { color: '#687078', label: 'Info' },
}

// ── Core Web Vitals card ──────────────────────────────────────────────────────

function CwvCard({ url }: { url: string }) {
  const { data: mobile, isLoading: mLoading } = useQuery<CoreWebVitals>({
    queryKey: ['pagespeed', url, 'mobile'],
    queryFn: async () => { const res = await fetch(`/api/seo/pagespeed?url=${encodeURIComponent(url)}&strategy=mobile`, { credentials: 'include' }); if (!res.ok) throw new Error('Failed'); return res.json() },
  })
  const { data: desktop, isLoading: dLoading } = useQuery<CoreWebVitals>({
    queryKey: ['pagespeed', url, 'desktop'],
    queryFn: async () => { const res = await fetch(`/api/seo/pagespeed?url=${encodeURIComponent(url)}&strategy=desktop`, { credentials: 'include' }); if (!res.ok) throw new Error('Failed'); return res.json() },
  })

  return (
    <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 18 }}>
      <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 4px' }}>Core Web Vitals</p>
      <p style={{ fontSize: 11, color: '#687078', margin: '0 0 12px' }}>LCP &le;2.5s / INP &lt;200ms / CLS &lt;0.1 = good (Google&apos;s thresholds)</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {[{ label: 'Mobile', data: mobile, loading: mLoading }, { label: 'Desktop', data: desktop, loading: dLoading }].map(({ label, data, loading }) => (
          <div key={label}>
            <p style={{ fontSize: 11, color: '#687078', fontWeight: 600, textTransform: 'uppercase', margin: '0 0 8px' }}>{label}</p>
            {loading ? <p style={{ fontSize: 12, color: '#AAB5BB' }}>Loading…</p> : !data ? (
              <p style={{ fontSize: 12, color: '#AAB5BB' }}>Not configured</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#687078' }}>LCP</span>
                  <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: cwvColor('lcp', data.lcp_ms) }}>{fmtMs(data.lcp_ms)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#687078' }}>INP</span>
                  <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: cwvColor('inp', data.inp_ms) }}>{data.inp_ms === null ? '-' : `${data.inp_ms}ms`}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#687078' }}>CLS</span>
                  <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: cwvColor('cls', data.cls) }}>{data.cls === null ? '-' : data.cls.toFixed(3)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTop: '1px solid #F2F3F3' }}>
                  <span style={{ fontSize: 12, color: '#687078' }}>Performance</span>
                  <span style={{ ...mono, fontSize: 12, fontWeight: 700 }}>{data.performance_score ?? '-'}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Indexing checker ──────────────────────────────────────────────────────────

function IndexingChecker({ connectionId }: { connectionId: string }) {
  const [url, setUrl] = useState('')
  const [checkedUrl, setCheckedUrl] = useState('')

  const { data, isLoading, isError } = useQuery<IndexingResult>({
    queryKey: ['indexing', connectionId, checkedUrl],
    queryFn: async () => {
      const res = await fetch(`/api/seo/indexing/${connectionId}?url=${encodeURIComponent(checkedUrl)}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!checkedUrl,
  })

  const style = data ? (INDEXING_STYLE[data.coverageState] ?? { bg: '#F2F3F3', color: '#687078', label: data.coverageState }) : null

  return (
    <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 18 }}>
      <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 12px' }}>Indexing Status Checker</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input style={{ ...inputStyle, flex: 1 }} placeholder="https://ouantum.com/blog/post" value={url} onChange={e => setUrl(e.target.value)} />
        <button onClick={() => setCheckedUrl(url)} disabled={!url} style={btnPrimary}>Check</button>
      </div>
      {isLoading && <p style={{ fontSize: 12, color: '#AAB5BB' }}>Checking…</p>}
      {isError && <p style={{ fontSize: 12, color: '#D13212' }}>Failed to check this URL</p>}
      {data && style && (
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: style.bg, color: style.color }}>{style.label}</span>
          {data.lastCrawlTime && <p style={{ fontSize: 11, color: '#687078', margin: '8px 0 0' }}>Last crawled {new Date(data.lastCrawlTime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>}
        </div>
      )}
    </div>
  )
}

// ── Sitemaps panel ────────────────────────────────────────────────────────────

function SitemapsPanel({ connectionId }: { connectionId: string }) {
  const qc = useQueryClient()
  const [newSitemap, setNewSitemap] = useState('')

  const { data, isLoading } = useQuery<{ sitemaps: Sitemap[] }>({
    queryKey: ['sitemaps', connectionId],
    queryFn: async () => { const res = await fetch(`/api/seo/sitemaps/${connectionId}`, { credentials: 'include' }); if (!res.ok) throw new Error('Failed'); return res.json() },
  })

  const submitMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/seo/sitemaps/${connectionId}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sitemap_url: newSitemap }),
      })
      if (!res.ok) throw new Error('Failed')
    },
    onSuccess: () => { setNewSitemap(''); qc.invalidateQueries({ queryKey: ['sitemaps', connectionId] }) },
  })

  return (
    <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 18 }}>
      <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 12px' }}>Sitemaps</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input style={{ ...inputStyle, flex: 1 }} placeholder="https://ouantum.com/sitemap.xml" value={newSitemap} onChange={e => setNewSitemap(e.target.value)} />
        <button onClick={() => submitMut.mutate()} disabled={!newSitemap || submitMut.isPending} style={btnPrimary}>{submitMut.isPending ? 'Submitting…' : 'Submit'}</button>
      </div>
      {isLoading ? <p style={{ fontSize: 12, color: '#AAB5BB' }}>Loading…</p> : (data?.sitemaps.length ?? 0) === 0 ? (
        <p style={{ fontSize: 12, color: '#AAB5BB' }}>No sitemaps submitted yet</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data!.sitemaps.map(s => (
            <div key={s.path} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #F2F3F3' }}>
              <span style={{ fontSize: 12, color: '#16191F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.path}</span>
              {s.errors ? <span style={{ fontSize: 11, color: '#D13212', marginLeft: 8 }}>{s.errors} errors</span> : s.isPending ? <span style={{ fontSize: 11, color: '#E8820C', marginLeft: 8 }}>Pending</span> : <span style={{ fontSize: 11, color: '#1D8102', marginLeft: 8 }}>OK</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Rankings table ────────────────────────────────────────────────────────────

function RankingsTable({ connectionId, days }: { connectionId: string; days: number }) {
  const [view, setView] = useState<'byQuery' | 'byPage'>('byQuery')

  const { data, isLoading, isError } = useQuery<{ byQuery: RankingRow[]; byPage: RankingRow[] }>({
    queryKey: ['rankings', connectionId, days],
    queryFn: async () => { const res = await fetch(`/api/seo/rankings/${connectionId}?days=${days}`, { credentials: 'include' }); if (!res.ok) throw new Error('Failed'); return res.json() },
  })

  const rows = (data?.[view] ?? []).slice().sort((a, b) => b.clicks - a.clicks).slice(0, 25)

  return (
    <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: 0 }}>Search Rankings</p>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['byQuery', 'byPage'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '4px 12px', borderRadius: 14, fontSize: 11.5, fontWeight: 500,
                border: view === v ? 'none' : '1px solid #D5DBDB',
                background: view === v ? '#0073BB' : '#fff',
                color: view === v ? '#fff' : '#16191F', cursor: 'pointer',
              }}
            >
              {v === 'byQuery' ? 'By Query' : 'By Page'}
            </button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <p style={{ padding: 24, textAlign: 'center', color: '#AAB5BB', fontSize: 13 }}>Loading…</p>
      ) : isError ? (
        <p style={{ padding: 24, textAlign: 'center', color: '#D13212', fontSize: 13 }}>Failed to load rankings - check the connection in Settings</p>
      ) : rows.length === 0 ? (
        <p style={{ padding: 24, textAlign: 'center', color: '#AAB5BB', fontSize: 13 }}>No data for this period yet</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: '#F2F3F3' }}>
              {[view === 'byQuery' ? 'Query' : 'Page', 'Clicks', 'Impressions', 'CTR', 'Avg. Position'].map(h => (
                <th key={h} style={{ padding: '8px 18px', textAlign: h === (view === 'byQuery' ? 'Query' : 'Page') ? 'left' : 'right', fontWeight: 600, color: '#687078' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid #F2F3F3' }}>
                <td style={{ padding: '8px 18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>{r.keys[0]}</td>
                <td style={{ padding: '8px 18px', textAlign: 'right', ...mono, fontWeight: 700 }}>{r.clicks}</td>
                <td style={{ padding: '8px 18px', textAlign: 'right', ...mono }}>{r.impressions}</td>
                <td style={{ padding: '8px 18px', textAlign: 'right', ...mono }}>{fmtPct(r.ctr)}</td>
                <td style={{ padding: '8px 18px', textAlign: 'right', ...mono }}>{fmtPos(r.position)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Traffic overview ──────────────────────────────────────────────────────────

function TrafficOverview({ connectionId, days }: { connectionId: string; days: number }) {
  const { data, isLoading } = useQuery<{ connected: boolean; message?: string; report?: { rows: { dimensionValues: string[]; metricValues: string[] }[] } }>({
    queryKey: ['traffic', connectionId, days],
    queryFn: async () => { const res = await fetch(`/api/seo/traffic/${connectionId}?days=${days}`, { credentials: 'include' }); if (!res.ok) throw new Error('Failed'); return res.json() },
  })

  const totals = data?.report?.rows.reduce((acc, r) => ({
    sessions: acc.sessions + (parseInt(r.metricValues[0]) || 0),
    users: acc.users + (parseInt(r.metricValues[1]) || 0),
    conversions: acc.conversions + (parseInt(r.metricValues[2]) || 0),
  }), { sessions: 0, users: 0, conversions: 0 })

  return (
    <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 18 }}>
      <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 12px' }}>Traffic</p>
      {isLoading ? (
        <p style={{ fontSize: 12, color: '#AAB5BB' }}>Loading…</p>
      ) : !data?.connected ? (
        <p style={{ fontSize: 12, color: '#AAB5BB' }}>{data?.message ?? 'GA4 not connected for this site - set the GA4 property ID in Settings > SEO Connections'}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div>
            <p style={{ fontSize: 11, color: '#687078', margin: '0 0 4px' }}>Sessions</p>
            <p style={{ ...mono, fontSize: 20, fontWeight: 700, margin: 0 }}>{totals?.sessions ?? 0}</p>
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#687078', margin: '0 0 4px' }}>Users</p>
            <p style={{ ...mono, fontSize: 20, fontWeight: 700, margin: 0 }}>{totals?.users ?? 0}</p>
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#687078', margin: '0 0 4px' }}>Conversions</p>
            <p style={{ ...mono, fontSize: 20, fontWeight: 700, margin: 0, color: '#1D8102' }}>{totals?.conversions ?? 0}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Technical Audit ───────────────────────────────────────────────────────────

function TechnicalAuditCard({ companies }: { companies: Company[] }) {
  const qc = useQueryClient()
  const [companyId, setCompanyId] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => { if (!companyId && companies.length > 0) setCompanyId(companies[0].id) }, [companies, companyId])

  const { data, isLoading } = useQuery<{ audits: Audit[] }>({
    queryKey: ['seo-audits', companyId],
    queryFn: async () => { const res = await fetch(`/api/seo/audits?company_id=${companyId}`, { credentials: 'include' }); if (!res.ok) throw new Error('Failed'); return res.json() },
    enabled: !!companyId,
  })
  const audits = data?.audits ?? []
  const latest = audits[0]

  const auditMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/seo/audit', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, url }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Audit failed') }
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seo-audits', companyId] }),
  })

  return (
    <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 18 }}>
      <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 4px' }}>Technical Audit</p>
      <p style={{ fontSize: 11, color: '#687078', margin: '0 0 12px' }}>CBOP&apos;s own crawler - title/meta/headings/alt-text/links/robots.txt, no external API</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select style={{ ...inputStyle, width: 160 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
          {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
        </select>
        <input style={{ ...inputStyle, flex: 1 }} placeholder="https://ouantum.com/blog/post" value={url} onChange={e => setUrl(e.target.value)} />
        <button onClick={() => auditMut.mutate()} disabled={!url || !companyId || auditMut.isPending} style={btnPrimary}>
          {auditMut.isPending ? 'Auditing…' : 'Run Audit'}
        </button>
      </div>

      {auditMut.isError && <p style={{ fontSize: 12, color: '#D13212', margin: '0 0 12px' }}>{(auditMut.error as Error).message}</p>}

      {isLoading ? (
        <p style={{ fontSize: 12, color: '#AAB5BB' }}>Loading…</p>
      ) : !latest ? (
        <p style={{ fontSize: 12, color: '#AAB5BB' }}>No audits run yet for this company</p>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ ...mono, fontSize: 28, fontWeight: 700, color: scoreColor(latest.score) }}>{latest.score}</span>
            <div>
              <p style={{ fontSize: 12, color: '#16191F', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 380 }}>{latest.url}</p>
              <p style={{ fontSize: 10.5, color: '#AAB5BB', margin: 0 }}>{new Date(latest.audited_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </div>

          {latest.issues.length === 0 ? (
            <p style={{ fontSize: 12, color: '#1D8102' }}>No issues found</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {latest.issues.map((issue, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: SEVERITY_STYLE[issue.severity].color, minWidth: 52 }}>{SEVERITY_STYLE[issue.severity].label}</span>
                  <span style={{ fontSize: 12, color: '#16191F' }}>{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          {audits.length > 1 && (
            <div style={{ borderTop: '1px solid #F2F3F3', paddingTop: 10 }}>
              <p style={{ fontSize: 11, color: '#687078', margin: '0 0 6px' }}>History</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {audits.slice(1, 6).map(a => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: '#687078', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{a.url}</span>
                    <span style={{ ...mono, color: scoreColor(a.score), fontWeight: 700 }}>{a.score}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SeoPage() {
  const [connectionId, setConnectionId] = useState('')
  const [days, setDays] = useState(28)

  const { data: connData, isLoading: connLoading } = useQuery<{ connections: Connection[]; google_configured: boolean }>({
    queryKey: ['seo-connections'],
    queryFn: async () => { const res = await fetch('/api/seo/connections', { credentials: 'include' }); if (!res.ok) throw new Error('Failed'); return res.json() },
  })
  const connections = (connData?.connections ?? []).filter(c => c.site_url !== 'pending-site-selection')

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies-list'],
    queryFn: async () => { const res = await fetch('/api/companies', { credentials: 'include' }); if (!res.ok) throw new Error('Failed'); return res.json() },
  })
  const companies = companiesData?.companies ?? []

  if (!connLoading && connections.length === 0) {
    return (
      <div style={{ padding: 24, maxWidth: 700 }}>
        <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700, fontSize: 22, color: '#16191F', margin: '0 0 4px' }}>SEO</h1>
        <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 32, textAlign: 'center', marginTop: 20, marginBottom: 20 }}>
          <Search size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: '#16191F', fontWeight: 600, margin: '0 0 6px' }}>No sites connected yet</p>
          <p style={{ fontSize: 13, color: '#687078', margin: '0 0 16px' }}>Connect a Google Search Console property in Settings to see rankings, traffic, and site health here.</p>
          <a href="/settings?tab=seo" style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            Go to Settings <ExternalLink size={14} />
          </a>
        </div>
        {companies.length > 0 && <TechnicalAuditCard companies={companies} />}
      </div>
    )
  }

  const activeId = connectionId || connections[0]?.id || ''
  const active = connections.find(c => c.id === activeId)

  return (
    <div style={{ padding: 24, maxWidth: 1300 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700, fontSize: 22, color: '#16191F', margin: '0 0 4px' }}>SEO</h1>
          <p style={{ fontSize: 13, color: '#687078', margin: 0 }}>Rankings, traffic, and site health - straight from Google Search Console, Analytics, and PageSpeed Insights</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={{ ...inputStyle, width: 220 }} value={activeId} onChange={e => setConnectionId(e.target.value)}>
            {connections.map(c => <option key={c.id} value={c.id}>{c.company_name} - {c.site_url}</option>)}
          </select>
          <select style={{ ...inputStyle, width: 130 }} value={days} onChange={e => setDays(parseInt(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={28}>Last 28 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      {active && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <RankingsTable connectionId={active.id} days={days} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <TrafficOverview connectionId={active.id} days={days} />
            <CwvCard url={active.site_url.replace('sc-domain:', 'https://')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <SitemapsPanel connectionId={active.id} />
            <IndexingChecker connectionId={active.id} />
          </div>
          {companies.length > 0 && <TechnicalAuditCard companies={companies} />}
        </div>
      )}
    </div>
  )
}
