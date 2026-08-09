'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'

interface Company    { id: string; name: string }
interface Subscriber { id: string; company_id: string; company_name: string; email: string; name: string | null; status: string; source: string | null; created_at: string }
interface Suppressed { id: string; email: string; reason: string; detail: string | null; created_at: string }

const STATUS_COLOR: Record<string, string> = {
  subscribed:   '#1D8102',
  pending:      '#E8820C',
  unsubscribed: '#888',
  bounced:      '#D13212',
  complained:   '#D13212',
}

export default function SubscribersPage() {
  const qc = useQueryClient()
  const [tab, setTab]         = useState<'subscribers' | 'suppression'>('subscribers')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch]   = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn:  () => fetch('/api/session').then(r => r.json()).then(d => d.companies ?? []),
  })

  const { data: subscribers = [], isLoading } = useQuery<Subscriber[]>({
    queryKey: ['subscribers'],
    queryFn:  () => fetch('/api/subscribers').then(r => { if (!r.ok) throw new Error('api'); return r.json() }),
  })

  const { data: stats } = useQuery<{ by_status: { status: string; n: number }[]; suppressed: number }>({
    queryKey: ['subscriber-stats'],
    queryFn:  () => fetch('/api/subscribers/stats').then(r => r.json()),
  })

  const { data: suppression = [] } = useQuery<Suppressed[]>({
    queryKey: ['suppression'],
    queryFn:  () => fetch('/api/suppression').then(r => r.json()),
    enabled:  tab === 'suppression',
  })

  const delSub = useMutation({
    mutationFn: (id: string) => fetch(`/api/subscribers/${id}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['subscribers'] }); qc.invalidateQueries({ queryKey: ['subscriber-stats'] }) },
  })

  const unsuppress = useMutation({
    mutationFn: (email: string) => fetch(`/api/suppression/${encodeURIComponent(email)}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['suppression'] }); qc.invalidateQueries({ queryKey: ['subscriber-stats'] }) },
  })

  const countFor = (s: string) => stats?.by_status.find(x => x.status === s)?.n ?? 0

  const filtered = subscribers.filter(s =>
    (statusFilter === 'all' || s.status === statusFilter) &&
    (!search || s.email.toLowerCase().includes(search.toLowerCase()) || (s.name ?? '').toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div style={{ padding: '24px 32px', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, color: '#16191F', margin: 0 }}>Subscribers</h1>
          <p style={{ color: '#666', fontSize: 13, margin: '4px 0 0' }}>
            Manage your mailing lists, opt-ins, and the suppression list. Unsubscribes and bounces are honored automatically.
          </p>
        </div>
        <button onClick={() => setAddOpen(true)} style={btnPrimary}>+ Add / Import</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Subscribed',  value: countFor('subscribed'), color: '#1D8102' },
          { label: 'Pending',     value: countFor('pending'),    color: '#E8820C' },
          { label: 'Unsubscribed', value: countFor('unsubscribed'), color: '#888' },
          { label: 'Suppressed',  value: stats?.suppressed ?? 0, color: '#D13212' },
        ].map(s => (
          <div key={s.label} style={card}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'IBM Plex Mono', color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['subscribers', 'suppression'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>
            {t === 'subscribers' ? 'Subscribers' : 'Suppression list'}
          </button>
        ))}
      </div>

      {tab === 'subscribers' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <input
              placeholder="Filter by email or name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...input, maxWidth: 280 }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              {['all', 'subscribed', 'pending', 'unsubscribed', 'bounced'].map(f => (
                <button key={f} onClick={() => setStatusFilter(f)} style={tabBtn(statusFilter === f)}>
                  {f === 'all' ? 'All' : f}
                </button>
              ))}
            </div>
          </div>

          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRow}>
                  {['Email', 'Name', 'Company', 'Status', 'Source', 'Added', ''].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={7} style={emptyCell}>Loading…</td></tr>}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={7} style={emptyCell}>No subscribers. Add or import some to get started.</td></tr>
                )}
                {filtered.map(s => (
                  <tr key={s.id} style={tr}>
                    <td style={{ ...td, fontFamily: 'IBM Plex Mono', fontSize: 12, color: '#16191F' }}>{s.email}</td>
                    <td style={td}>{s.name ?? '-'}</td>
                    <td style={td}>{s.company_name}</td>
                    <td style={td}>
                      <span style={badge(STATUS_COLOR[s.status] ?? '#888')}>{s.status}</span>
                    </td>
                    <td style={{ ...td, color: '#888', fontSize: 12 }}>{s.source ?? '-'}</td>
                    <td style={{ ...td, color: '#888', fontFamily: 'IBM Plex Mono', fontSize: 12 }}>{new Date(s.created_at).toLocaleDateString()}</td>
                    <td style={td}>
                      <button onClick={() => { if (confirm(`Delete ${s.email}?`)) delSub.mutate(s.id) }}
                        style={linkDanger}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'suppression' && (
        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRow}>{['Email', 'Reason', 'Detail', 'Since', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {suppression.length === 0 && <tr><td colSpan={5} style={emptyCell}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={16} style={{ verticalAlign: 'middle' }} /> No suppressed addresses.</span></td></tr>}
              {suppression.map(s => (
                <tr key={s.id} style={tr}>
                  <td style={{ ...td, fontFamily: 'IBM Plex Mono', fontSize: 12 }}>{s.email}</td>
                  <td style={td}><span style={badge(s.reason === 'unsubscribe' ? '#888' : '#D13212')}>{s.reason}</span></td>
                  <td style={{ ...td, color: '#888', fontSize: 12 }}>{s.detail ?? '-'}</td>
                  <td style={{ ...td, color: '#888', fontFamily: 'IBM Plex Mono', fontSize: 12 }}>{new Date(s.created_at).toLocaleDateString()}</td>
                  <td style={td}>
                    <button onClick={() => { if (confirm(`Re-allow ${s.email}? Only do this with explicit consent.`)) unsuppress.mutate(s.email) }}
                      style={{ ...linkDanger, color: '#0073BB' }}>Re-allow</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: '#888', padding: '10px 14px', margin: 0 }}>
            Re-allowing an address removes it from suppression. Only do this when the person has explicitly opted back in - re-emailing unsubscribed contacts damages domain reputation.
          </p>
        </div>
      )}

      {addOpen && <AddSlideOver companies={companies} onClose={() => setAddOpen(false)}
        onSaved={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ['subscribers'] }); qc.invalidateQueries({ queryKey: ['subscriber-stats'] }) }} />}
    </div>
  )
}

// ── Add / Import slide-over ──────────────────────────────────────────────────
function AddSlideOver({ companies, onClose, onSaved }: { companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode]   = useState<'single' | 'import'>('single')
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const [email, setEmail] = useState('')
  const [name, setName]   = useState('')
  const [raw, setRaw]     = useState('')
  const [busy, setBusy]   = useState(false)
  const [msg, setMsg]     = useState('')

  async function submit() {
    if (!companyId) { setMsg('Pick a company.'); return }
    setBusy(true); setMsg('')
    try {
      if (mode === 'single') {
        const r = await fetch('/api/subscribers', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ company_id: companyId, email, name }) })
        if (!r.ok) throw new Error((await r.json()).error ?? 'Failed')
      } else {
        const r = await fetch('/api/subscribers/import', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ company_id: companyId, raw }) })
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? 'Failed')
        setMsg(`Imported ${d.added}, skipped ${d.skipped} of ${d.total}.`)
        setBusy(false)
        setTimeout(onSaved, 900)
        return
      }
      onSaved()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed') }
    setBusy(false)
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, margin: '0 0 4px', color: '#16191F' }}>Add subscribers</h2>
        <p style={{ color: '#888', fontSize: 12, margin: '0 0 16px' }}>New addresses are confirmed (single opt-in). Suppressed addresses won&apos;t be re-added unless they opt back in.</p>

        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {(['single', 'import'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={tabBtn(mode === m)}>{m === 'single' ? 'One address' : 'Bulk import'}</button>
          ))}
        </div>

        <label style={lbl}>Company</label>
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={{ ...input, marginBottom: 14 }}>
          <option value="">Select…</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {mode === 'single' ? (
          <>
            <label style={lbl}>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} style={{ ...input, marginBottom: 14 }} placeholder="person@example.com" />
            <label style={lbl}>Name (optional)</label>
            <input value={name} onChange={e => setName(e.target.value)} style={{ ...input, marginBottom: 14 }} placeholder="Jane Doe" />
          </>
        ) : (
          <>
            <label style={lbl}>Paste addresses - one per line</label>
            <textarea value={raw} onChange={e => setRaw(e.target.value)} rows={10}
              style={{ ...input, height: 'auto', fontFamily: 'IBM Plex Mono', fontSize: 12, marginBottom: 14 }}
              placeholder={'jane@example.com\nJohn Smith <john@example.com>\nMary,mary@example.com'} />
          </>
        )}

        {msg && <p style={{ fontSize: 12, color: msg.startsWith('Imported') ? '#1D8102' : '#D13212', margin: '0 0 12px' }}>{msg}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={submit} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save'}</button>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── styles ───────────────────────────────────────────────────────────────────
const btnPrimary: React.CSSProperties = { background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const btnGhost: React.CSSProperties   = { background: 'transparent', color: '#666', border: '1px solid #D5DBDB', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }
const card: React.CSSProperties       = { background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: '16px 20px' }
const input: React.CSSProperties      = { width: '100%', border: '1px solid #D5DBDB', borderRadius: 6, height: 36, padding: '0 10px', fontSize: 13, boxSizing: 'border-box' }
const lbl: React.CSSProperties        = { display: 'block', fontSize: 12, fontWeight: 600, color: '#444', marginBottom: 6 }
const tableWrap: React.CSSProperties  = { background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden' }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadRow: React.CSSProperties   = { background: '#F8F9FA', borderBottom: '1px solid #D5DBDB' }
const th: React.CSSProperties         = { padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#444', whiteSpace: 'nowrap' }
const td: React.CSSProperties         = { padding: '12px 14px', color: '#444' }
const tr: React.CSSProperties         = { borderBottom: '1px solid #F2F3F3' }
const emptyCell: React.CSSProperties  = { padding: 48, textAlign: 'center', color: '#888' }
const linkDanger: React.CSSProperties = { background: 'none', border: 'none', color: '#D13212', cursor: 'pointer', fontSize: 12 }
const overlay: React.CSSProperties    = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 50 }
const panel: React.CSSProperties      = { position: 'fixed', top: 0, right: 0, height: '100%', width: 440, background: '#fff', boxShadow: '-2px 0 12px rgba(0,0,0,0.12)', padding: '28px 28px', overflowY: 'auto', zIndex: 51 }
const badge  = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: color + '18', color, textTransform: 'capitalize' })
const tabBtn = (active: boolean): React.CSSProperties => ({ background: active ? '#0073BB' : 'transparent', color: active ? '#fff' : '#666', border: '1px solid', borderColor: active ? '#0073BB' : '#D5DBDB', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', textTransform: 'capitalize' })
