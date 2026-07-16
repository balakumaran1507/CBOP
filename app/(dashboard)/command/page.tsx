'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'health' | 'holdings' | 'wealth' | 'mentor'
type Persona = 'ca' | 'mba' | 'marketing_advisor' | 'tech_consultant'

interface CompanyHealth {
  company_id:     string
  company_name:   string
  invoice_prefix: string
  month:          string | null
  revenue:        number
  expenses:       number
  profit:         number
  cash_position:  number
  runway_days:    number | null
}

interface Holding {
  id:           string
  company_name: string
  equity_pct:   number
  valuation:    number
  your_stake:   number
  updated_at:   string
}

interface WealthSnapshot {
  id:            string
  snapshot_date: string
  net_worth:     number
  cash:          number
  equity_stakes: number
  other_assets:  number
}

interface MentorMessage {
  role:    'user' | 'assistant'
  content: string
  ts:      string
}

interface Company {
  id:             string
  name:           string
  invoice_prefix: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function inr(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtMonth(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

const PERSONA_LABELS: Record<Persona, string> = {
  ca:                'CA',
  mba:               'MBA',
  marketing_advisor: 'Marketing',
  tech_consultant:   'Tech Consultant',
}

const PERSONA_FULL: Record<Persona, string> = {
  ca:                'Chartered Accountant',
  mba:               'MBA / Business Strategist',
  marketing_advisor: 'Marketing Advisor',
  tech_consultant:   'Tech Consultant',
}

const mono: React.CSSProperties = { fontFamily: 'var(--font-ibm-plex-mono), monospace' }

const inputStyle: React.CSSProperties = {
  border: '1px solid #D5DBDB',
  borderRadius: 6,
  height: 36,
  padding: '0 12px',
  fontSize: 13,
  width: '100%',
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
}

const btnPrimary: React.CSSProperties = {
  background: '#0073BB',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  height: 36,
  padding: '0 16px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: '#0073BB',
  border: '1px solid #D5DBDB',
  borderRadius: 6,
  height: 36,
  padding: '0 14px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: '12px 16px', background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8 }}>
      <p style={{ fontSize: 11, color: '#687078', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</p>
      <p style={{ ...mono, fontSize: 18, fontWeight: 700, color: color ?? '#16191F', margin: 0 }}>{value}</p>
    </div>
  )
}

// ── Slide-over ────────────────────────────────────────────────────────────────

function SlideOver({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 40 }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, background: '#fff', zIndex: 50, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #D5DBDB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 16 }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#687078', lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>{children}</div>
      </div>
    </>
  )
}

// ── Trend Chart (SVG) ─────────────────────────────────────────────────────────

function TrendChart({ snapshots }: { snapshots: WealthSnapshot[] }) {
  if (snapshots.length < 2) {
    return <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#AAB5BB', fontSize: 13 }}>Add more snapshots to see trend</div>
  }

  const data = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)).slice(-12)
  const values = data.map(d => d.net_worth)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const W = 600
  const H = 120
  const pad = { l: 8, r: 8, t: 8, b: 24 }
  const cw = W - pad.l - pad.r
  const ch = H - pad.t - pad.b

  const pts = data.map((d, i) => {
    const x = pad.l + (i / (data.length - 1)) * cw
    const y = pad.t + ch - ((d.net_worth - min) / range) * ch
    return `${x},${y}`
  })

  const area = `M ${pts[0]} ` + pts.slice(1).map(p => `L ${p}`).join(' ') +
    ` L ${pad.l + cw},${pad.t + ch} L ${pad.l},${pad.t + ch} Z`

  const line = `M ${pts[0]} ` + pts.slice(1).map(p => `L ${p}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 120 }}>
      <defs>
        <linearGradient id="tw-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0073BB" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#0073BB" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#tw-grad)" />
      <path d={line} fill="none" stroke="#0073BB" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => {
        const x = pad.l + (i / (data.length - 1)) * cw
        const y = pad.t + ch - ((d.net_worth - min) / range) * ch
        return (
          <g key={d.id}>
            <circle cx={x} cy={y} r={3} fill="#0073BB" />
            {i % Math.max(1, Math.floor(data.length / 5)) === 0 && (
              <text x={x} y={H - 4} textAnchor="middle" fontSize={9} fill="#AAB5BB">
                {new Date(d.snapshot_date).toLocaleDateString('en-IN', { month: 'short' })}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ── Company Health Tab ────────────────────────────────────────────────────────

function CompanyHealthTab() {
  const qc = useQueryClient()
  const [cashInputs, setCashInputs] = useState<Record<string, string>>({})
  const [savingCash, setSavingCash] = useState<Record<string, boolean>>({})

  const { data, isLoading } = useQuery<{ companies: CompanyHealth[] }>({
    queryKey: ['finance-health'],
    queryFn: async () => {
      const res = await fetch('/api/finance/company-health', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const companies = data?.companies ?? []
  const lowRunway = companies.filter(c => c.runway_days !== null && c.runway_days < 60)

  async function saveCash(companyId: string) {
    const amount = parseFloat(cashInputs[companyId] ?? '0')
    if (isNaN(amount)) return
    setSavingCash(prev => ({ ...prev, [companyId]: true }))
    await fetch('/api/finance/company-health/cash', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, amount }),
    })
    setSavingCash(prev => ({ ...prev, [companyId]: false }))
    setCashInputs(prev => ({ ...prev, [companyId]: '' }))
    qc.invalidateQueries({ queryKey: ['finance-health'] })
  }

  if (isLoading) return <div style={{ padding: 32, color: '#AAB5BB' }}>Loading…</div>

  return (
    <div>
      {lowRunway.length > 0 && (
        <div style={{ background: '#FEF8EE', border: '1px solid #E8820C', borderRadius: 8, padding: '12px 16px', marginBottom: 24, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span style={{ fontSize: 13, color: '#E8820C', fontWeight: 600 }}>
            Runway warning — {lowRunway.map(c => `${c.company_name}: ${c.runway_days}d`).join(' · ')}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {companies.map((co) => (
          <div key={co.company_id} style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', background: '#232F3E', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, color: '#fff', fontSize: 14 }}>{co.company_name}</span>
              {co.month && <span style={{ ...mono, fontSize: 11, color: '#AAB5BB' }}>{fmtMonth(co.month)}</span>}
              {co.runway_days !== null && (
                <span style={{ marginLeft: 'auto', ...mono, fontSize: 12, color: co.runway_days < 60 ? '#E8820C' : '#1D8102', fontWeight: 700 }}>
                  {co.runway_days}d runway
                </span>
              )}
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                <MiniStat label="Revenue" value={inr(co.revenue)} color="#1D8102" />
                <MiniStat label="Expenses" value={inr(co.expenses)} color="#D13212" />
                <MiniStat label="Net Profit" value={inr(co.profit)} color={co.profit >= 0 ? '#1D8102' : '#D13212'} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: '#687078', whiteSpace: 'nowrap' }}>Cash position</span>
                <span style={{ ...mono, fontSize: 14, fontWeight: 700, color: '#16191F', minWidth: 100 }}>{inr(co.cash_position)}</span>
                <input
                  style={{ ...inputStyle, width: 140, fontSize: 12 }}
                  placeholder="Update amount"
                  value={cashInputs[co.company_id] ?? ''}
                  onChange={e => setCashInputs(prev => ({ ...prev, [co.company_id]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && saveCash(co.company_id)}
                  type="number"
                />
                <button
                  onClick={() => saveCash(co.company_id)}
                  disabled={savingCash[co.company_id]}
                  style={{ ...btnPrimary, height: 32, fontSize: 12, padding: '0 12px' }}
                >
                  {savingCash[co.company_id] ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {companies.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: '#AAB5BB', fontSize: 14 }}>
          No P&L data yet. Financial data is updated automatically by the financial_calc automation every Sunday.
        </div>
      )}
    </div>
  )
}

// ── Holdings Tab ──────────────────────────────────────────────────────────────

function HoldingsTab() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [editItem, setEditItem] = useState<Holding | null>(null)
  const [form, setForm] = useState({ company_name: '', equity_pct: '', valuation: '' })
  const [saving, setSaving] = useState(false)

  const { data, isLoading } = useQuery<{ holdings: Holding[] }>({
    queryKey: ['finance-holdings'],
    queryFn: async () => {
      const res = await fetch('/api/finance/holdings', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const holdings = data?.holdings ?? []
  const totalStake = holdings.reduce((s, h) => s + h.your_stake, 0)

  function openEdit(h: Holding) {
    setEditItem(h)
    setForm({ company_name: h.company_name, equity_pct: String(h.equity_pct), valuation: String(h.valuation) })
    setShowNew(false)
  }

  function openNew() {
    setEditItem(null)
    setForm({ company_name: '', equity_pct: '', valuation: '' })
    setShowNew(true)
  }

  async function save() {
    setSaving(true)
    const payload = {
      company_name: form.company_name,
      equity_pct:   parseFloat(form.equity_pct),
      valuation:    parseFloat(form.valuation),
    }
    const url = editItem ? `/api/finance/holdings/${editItem.id}` : '/api/finance/holdings'
    const method = editItem ? 'PATCH' : 'POST'
    await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    setSaving(false)
    setShowNew(false)
    setEditItem(null)
    qc.invalidateQueries({ queryKey: ['finance-holdings'] })
  }

  async function remove(id: string) {
    if (!confirm('Delete this holding?')) return
    await fetch(`/api/finance/holdings/${id}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['finance-holdings'] })
  }

  const slideOpen = showNew || editItem !== null

  if (isLoading) return <div style={{ padding: 32, color: '#AAB5BB' }}>Loading…</div>

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <span style={{ fontSize: 13, color: '#687078' }}>Total equity stake: </span>
          <span style={{ ...mono, fontSize: 16, fontWeight: 700, color: '#16191F' }}>{inr(totalStake)}</span>
        </div>
        <button onClick={openNew} style={btnPrimary}>+ Add Holding</button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F2F3F3' }}>
              {['Company', 'Equity %', 'Valuation', 'Your Stake', 'Updated', ''].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#687078', borderBottom: '1px solid #D5DBDB', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.id} style={{ borderBottom: '1px solid #F2F3F3' }}>
                <td style={{ padding: '12px 16px', fontWeight: 500 }}>{h.company_name}</td>
                <td style={{ padding: '12px 16px', ...mono }}>{h.equity_pct.toFixed(2)}%</td>
                <td style={{ padding: '12px 16px', ...mono }}>{inr(h.valuation)}</td>
                <td style={{ padding: '12px 16px', ...mono, fontWeight: 700, color: '#1D8102' }}>{inr(h.your_stake)}</td>
                <td style={{ padding: '12px 16px', color: '#687078', fontSize: 12 }}>{fmtDate(h.updated_at)}</td>
                <td style={{ padding: '12px 16px' }}>
                  <button onClick={() => openEdit(h)} style={{ ...btnGhost, height: 28, fontSize: 12, padding: '0 10px', marginRight: 6 }}>Edit</button>
                  <button onClick={() => remove(h.id)} style={{ ...btnGhost, height: 28, fontSize: 12, padding: '0 10px', color: '#D13212' }}>Delete</button>
                </td>
              </tr>
            ))}
            {holdings.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#AAB5BB' }}>No holdings recorded yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <SlideOver open={slideOpen} onClose={() => { setShowNew(false); setEditItem(null) }} title={editItem ? 'Edit Holding' : 'Add Holding'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Company Name</label>
            <input style={inputStyle} value={form.company_name} onChange={e => setForm(p => ({ ...p, company_name: e.target.value }))} placeholder="e.g. Acme Corp" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Equity % (your stake)</label>
            <input style={inputStyle} type="number" value={form.equity_pct} onChange={e => setForm(p => ({ ...p, equity_pct: e.target.value }))} placeholder="e.g. 25.5" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Company Valuation (₹)</label>
            <input style={inputStyle} type="number" value={form.valuation} onChange={e => setForm(p => ({ ...p, valuation: e.target.value }))} placeholder="e.g. 50000000" />
          </div>
          {form.equity_pct && form.valuation && (
            <div style={{ background: '#F2F3F3', borderRadius: 6, padding: '10px 14px', fontSize: 13 }}>
              Your stake: <span style={{ ...mono, fontWeight: 700, color: '#1D8102' }}>
                {inr(parseFloat(form.valuation || '0') * parseFloat(form.equity_pct || '0') / 100)}
              </span>
            </div>
          )}
          <button onClick={save} disabled={saving || !form.company_name} style={{ ...btnPrimary, marginTop: 8 }}>
            {saving ? 'Saving…' : (editItem ? 'Update Holding' : 'Add Holding')}
          </button>
        </div>
      </SlideOver>
    </>
  )
}

// ── Personal Wealth Tab ───────────────────────────────────────────────────────

function WealthTab() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ snapshot_date: '', net_worth: '', cash: '', equity_stakes: '', other_assets: '' })

  const { data, isLoading } = useQuery<{ snapshots: WealthSnapshot[] }>({
    queryKey: ['finance-wealth'],
    queryFn: async () => {
      const res = await fetch('/api/finance/personal-wealth', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const snapshots = data?.snapshots ?? []
  const latest = snapshots[0]

  async function save() {
    setSaving(true)
    await fetch('/api/finance/personal-wealth', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshot_date: form.snapshot_date,
        net_worth:     parseFloat(form.net_worth),
        cash:          parseFloat(form.cash),
        equity_stakes: form.equity_stakes ? parseFloat(form.equity_stakes) : 0,
        other_assets:  form.other_assets  ? parseFloat(form.other_assets)  : 0,
      }),
    })
    setSaving(false)
    setShowNew(false)
    setForm({ snapshot_date: '', net_worth: '', cash: '', equity_stakes: '', other_assets: '' })
    qc.invalidateQueries({ queryKey: ['finance-wealth'] })
  }

  if (isLoading) return <div style={{ padding: 32, color: '#AAB5BB' }}>Loading…</div>

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 15, margin: 0 }}>Net Worth Snapshot</h3>
        <button onClick={() => setShowNew(true)} style={btnPrimary}>+ Add Snapshot</button>
      </div>

      {latest && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
          <MiniStat label="Net Worth" value={inr(latest.net_worth)} color="#0073BB" />
          <MiniStat label="Cash" value={inr(latest.cash)} />
          <MiniStat label="Equity Stakes" value={inr(latest.equity_stakes)} />
          <MiniStat label="Other Assets" value={inr(latest.other_assets)} />
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 20, marginBottom: 24 }}>
        <p style={{ fontSize: 12, color: '#687078', marginBottom: 12, marginTop: 0 }}>Net worth trend (last 12 snapshots)</p>
        <TrendChart snapshots={snapshots} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F2F3F3' }}>
              {['Date', 'Net Worth', 'Cash', 'Equity', 'Other'].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#687078', borderBottom: '1px solid #D5DBDB' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {snapshots.slice(0, 24).map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #F2F3F3' }}>
                <td style={{ padding: '10px 16px', ...mono, fontSize: 12 }}>{s.snapshot_date}</td>
                <td style={{ padding: '10px 16px', ...mono, fontWeight: 700 }}>{inr(s.net_worth)}</td>
                <td style={{ padding: '10px 16px', ...mono }}>{inr(s.cash)}</td>
                <td style={{ padding: '10px 16px', ...mono }}>{inr(s.equity_stakes)}</td>
                <td style={{ padding: '10px 16px', ...mono }}>{inr(s.other_assets)}</td>
              </tr>
            ))}
            {snapshots.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#AAB5BB' }}>No snapshots yet — add your first one</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <SlideOver open={showNew} onClose={() => setShowNew(false)} title="Add Wealth Snapshot">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Date</label>
            <input style={inputStyle} type="date" value={form.snapshot_date} onChange={e => setForm(p => ({ ...p, snapshot_date: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Net Worth (₹) *</label>
            <input style={inputStyle} type="number" value={form.net_worth} onChange={e => setForm(p => ({ ...p, net_worth: e.target.value }))} placeholder="Total net worth" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Cash (₹) *</label>
            <input style={inputStyle} type="number" value={form.cash} onChange={e => setForm(p => ({ ...p, cash: e.target.value }))} placeholder="Bank accounts + FD + cash" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Equity Stakes (₹)</label>
            <input style={inputStyle} type="number" value={form.equity_stakes} onChange={e => setForm(p => ({ ...p, equity_stakes: e.target.value }))} placeholder="Company equity + listed stocks" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Other Assets (₹)</label>
            <input style={inputStyle} type="number" value={form.other_assets} onChange={e => setForm(p => ({ ...p, other_assets: e.target.value }))} placeholder="Property, gold, other" />
          </div>
          <button onClick={save} disabled={saving || !form.snapshot_date || !form.net_worth || !form.cash} style={{ ...btnPrimary, marginTop: 8 }}>
            {saving ? 'Saving…' : 'Save Snapshot'}
          </button>
        </div>
      </SlideOver>
    </>
  )
}

// ── Mentor Council Tab ────────────────────────────────────────────────────────

function MentorTab() {
  const [persona, setPersona] = useState<Persona>('ca')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [copyDone, setCopyDone] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, refetch } = useQuery<{ messages: MentorMessage[] }>({
    queryKey: ['mentor-history', persona],
    queryFn: async () => {
      const res = await fetch(`/api/mentor/history/${persona}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const messages = data?.messages ?? []

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!input.trim() || sending) return
    setSending(true)
    setInput('')
    await fetch('/api/mentor/chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona, message: input.trim() }),
    })
    setSending(false)
    refetch()
  }

  async function generateShareLink() {
    const res = await fetch('/api/mentor/share', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona }),
    })
    if (res.ok) {
      const { token } = await res.json() as { token: string }
      const url = `${window.location.origin}/mentor/shared/${token}`
      setShareLink(url)
    }
  }

  async function copyLink() {
    if (!shareLink) return
    await navigator.clipboard.writeText(shareLink)
    setCopyDone(true)
    setTimeout(() => setCopyDone(false), 2000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '72vh', minHeight: 500 }}>
      {/* Persona selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(Object.keys(PERSONA_LABELS) as Persona[]).map(p => (
          <button
            key={p}
            onClick={() => { setPersona(p); setShareLink(null) }}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 500,
              border: persona === p ? 'none' : '1px solid #D5DBDB',
              background: persona === p ? '#0073BB' : '#fff',
              color: persona === p ? '#fff' : '#16191F',
              cursor: 'pointer',
            }}
          >
            {PERSONA_LABELS[p]}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {messages.length > 0 && !shareLink && (
            <button onClick={generateShareLink} style={{ ...btnGhost, height: 32, fontSize: 12, padding: '0 12px' }}>
              Share (72h link)
            </button>
          )}
          {shareLink && (
            <button onClick={copyLink} style={{ ...btnPrimary, height: 32, fontSize: 12, padding: '0 12px', background: copyDone ? '#1D8102' : '#0073BB' }}>
              {copyDone ? '✓ Copied!' : 'Copy link'}
            </button>
          )}
        </div>
      </div>

      {/* Persona label */}
      <div style={{ background: '#F2F3F3', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: 13 }}>
        <span style={{ color: '#687078' }}>Advisor: </span>
        <span style={{ fontWeight: 600, color: '#16191F' }}>{PERSONA_FULL[persona]}</span>
      </div>

      {/* Chat window */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {isLoading && <div style={{ color: '#AAB5BB', fontSize: 13, textAlign: 'center', marginTop: 32 }}>Loading conversation…</div>}
        {!isLoading && messages.length === 0 && (
          <div style={{ color: '#AAB5BB', fontSize: 13, textAlign: 'center', marginTop: 32 }}>
            Start a conversation with your {PERSONA_FULL[persona]}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '75%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              background: msg.role === 'user' ? '#0073BB' : '#F2F3F3',
              color: msg.role === 'user' ? '#fff' : '#16191F',
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content}
              <div style={{ fontSize: 10, marginTop: 4, opacity: 0.6, textAlign: 'right' }}>
                {new Date(msg.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ padding: '10px 14px', borderRadius: '12px 12px 12px 2px', background: '#F2F3F3', fontSize: 13, color: '#AAB5BB' }}>
              Thinking…
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
          placeholder={`Ask your ${PERSONA_LABELS[persona]}… (Enter to send, Shift+Enter for newline)`}
          rows={2}
          style={{
            flex: 1,
            border: '1px solid #D5DBDB',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 13,
            resize: 'none',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button onClick={send} disabled={sending || !input.trim()} style={{ ...btnPrimary, alignSelf: 'stretch', padding: '0 20px' }}>
          Send
        </button>
      </div>
    </div>
  )
}

// ── CEO Panel Page ────────────────────────────────────────────────────────────

export default function CeoPage() {
  const [activeTab, setActiveTab] = useState<Tab>('health')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'health',   label: 'Company Health' },
    { key: 'holdings', label: 'Holdings' },
    { key: 'wealth',   label: 'Personal Wealth' },
    { key: 'mentor',   label: 'Mentor Council' },
  ]

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700, fontSize: 22, color: '#16191F', margin: '0 0 4px' }}>
          CEO Panel
        </h1>
        <p style={{ fontSize: 13, color: '#687078', margin: 0 }}>Finance overview, equity holdings, personal wealth, and advisory AI</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #D5DBDB', marginBottom: 28 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 500,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === t.key ? '2px solid #0073BB' : '2px solid transparent',
              color: activeTab === t.key ? '#0073BB' : '#687078',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'health'   && <CompanyHealthTab />}
      {activeTab === 'holdings' && <HoldingsTab />}
      {activeTab === 'wealth'   && <WealthTab />}
      {activeTab === 'mentor'   && <MentorTab />}
    </div>
  )
}
