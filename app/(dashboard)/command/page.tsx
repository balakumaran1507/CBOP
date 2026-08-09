'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CheckCircle2, TrendingUp, Users, Mail, FileText,
  UserCheck, Clock, ArrowUpRight, ShieldAlert, Search, Newspaper,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'pulse' | 'health' | 'models' | 'holdings' | 'wealth' | 'mentor'
type Persona = 'ca' | 'accountant' | 'tax_saving' | 'itr_filing' | 'auditor' | 'mba' | 'marketing_advisor' | 'tech_consultant' | 'legal'

interface PulseAlert {
  severity: 'critical' | 'warning'
  type:     string
  message:  string
  href:     string
}

interface PulseStats {
  companiesTracked?:      number
  revenueThisMonth?:      number
  overdueInvoices?:       number
  staleDeals?:            number
  hiringPendingReview?:   number
  hiringInterviewsToday?: number
  campaignsRunning?:      number
  campaignsPaused?:       number
  documentBatchesActive?: number
  documentBatchesFailed?: number
  subscribersActive?:     number
  subscribersSuppressed?: number
  seoAuditsLow?:            number
  blogPostsAwaitingPublish?: number
}

interface PulseActivity {
  id:     string
  label:  string
  type:   string
  status: 'pending' | 'running' | 'done' | 'failed'
  ts:     string
}

interface PulseData {
  companies: { id: string; name: string; invoice_prefix: string }[]
  alerts:    PulseAlert[]
  stats:     PulseStats
  activity:  PulseActivity[]
}

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
  accountant:        'Accountant',
  tax_saving:        'Tax Saving',
  itr_filing:        'ITR Filing',
  auditor:           'Auditor',
  mba:               'Business',
  marketing_advisor: 'Marketing',
  tech_consultant:   'Tech',
  legal:             'Legal',
}

const PERSONA_FULL: Record<Persona, string> = {
  ca:                'CA / Compliance',
  accountant:        'Accountant',
  tax_saving:        'Tax Saving Strategist',
  itr_filing:        'ITR Filing Specialist',
  auditor:           'Internal Auditor',
  mba:               'MBA / Business Strategist',
  marketing_advisor: 'Marketing Advisor',
  tech_consultant:   'Tech Consultant',
  legal:             'Legal',
}

const PERSONA_GROUPS: { label: string; personas: Persona[] }[] = [
  { label: 'Finance & Tax', personas: ['accountant', 'ca', 'tax_saving', 'itr_filing', 'auditor'] },
  { label: 'Strategy',      personas: ['mba', 'marketing_advisor', 'tech_consultant', 'legal'] },
]

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

// ── Pulse Tab ─────────────────────────────────────────────────────────────────

const SEVERITY_STYLE: Record<PulseAlert['severity'], { bg: string; border: string; color: string }> = {
  critical: { bg: '#FDECEA', border: '#F5C6C0', color: '#D13212' },
  warning:  { bg: '#FFF3E0', border: '#F5D9A8', color: '#E8820C' },
}

const JOB_STATUS_STYLE: Record<PulseActivity['status'], { bg: string; color: string; label: string }> = {
  done:    { bg: '#E6F4EA', color: '#1D8102', label: 'Done' },
  failed:  { bg: '#FDECEA', color: '#D13212', label: 'Failed' },
  running: { bg: '#FFF3E0', color: '#E8820C', label: 'Running' },
  pending: { bg: '#F2F3F3', color: '#687078', label: 'Pending' },
}

function PulseStatCard({ icon: Icon, label, value, sub, href, color }: {
  icon: LucideIcon
  label: string
  value: string | number
  sub?: string
  href: string
  color?: string
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: '14px 16px',
        background: '#fff',
        border: '1px solid #D5DBDB',
        borderRadius: 8,
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Icon size={16} color={color ?? '#687078'} />
        <ArrowUpRight size={13} color="#AAB5BB" />
      </div>
      <p style={{ ...mono, fontSize: 20, fontWeight: 700, color: '#16191F', margin: '0 0 2px' }}>{value}</p>
      <p style={{ fontSize: 11.5, color: '#687078', margin: 0 }}>{label}</p>
      {sub && <p style={{ fontSize: 10.5, color: '#AAB5BB', margin: '2px 0 0' }}>{sub}</p>}
    </Link>
  )
}

function AlertRow({ alert }: { alert: PulseAlert }) {
  const s = SEVERITY_STYLE[alert.severity]
  return (
    <Link
      href={alert.href}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        background: s.bg, border: `1px solid ${s.border}`, borderRadius: 6,
        textDecoration: 'none', marginBottom: 8,
      }}
    >
      {alert.severity === 'critical' ? <ShieldAlert size={15} color={s.color} /> : <AlertTriangle size={15} color={s.color} />}
      <span style={{ fontSize: 12.5, color: s.color, fontWeight: 600, flex: 1 }}>{alert.message}</span>
      <ArrowUpRight size={13} color={s.color} style={{ opacity: 0.6 }} />
    </Link>
  )
}

function ActivityRow({ item }: { item: PulseActivity }) {
  const s = JOB_STATUS_STYLE[item.status] ?? JOB_STATUS_STYLE.pending
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F2F3F3' }}>
      <span style={{ fontSize: 12.5, color: '#16191F', flex: 1 }}>{item.label}</span>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px', color: '#AAB5BB' }}>{item.type}</span>
      <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.color }}>{s.label}</span>
      <span style={{ ...mono, fontSize: 10.5, color: '#AAB5BB', minWidth: 68, textAlign: 'right' }}>
        {new Date(item.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}

function PulseTab() {
  const { data, isLoading } = useQuery<PulseData>({
    queryKey: ['ceo-pulse'],
    queryFn: async () => {
      const res = await fetch('/api/ceo/pulse', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    refetchInterval: 60_000,
  })

  if (isLoading) return <div style={{ padding: 32, color: '#AAB5BB' }}>Loading…</div>

  const alerts = data?.alerts ?? []
  const stats = data?.stats ?? {}
  const activity = data?.activity ?? []
  const companyCount = data?.companies.length ?? 0

  return (
    <div>
      <p style={{ fontSize: 12, color: '#687078', marginBottom: 20 }}>
        Live across {companyCount} compan{companyCount === 1 ? 'y' : 'ies'} - refreshes every minute
      </p>

      {alerts.length > 0 ? (
        <div style={{ marginBottom: 28 }}>
          {alerts.map((a, i) => <AlertRow key={i} alert={a} />)}
        </div>
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', marginBottom: 28,
          background: '#E6F4EA', border: '1px solid #C8E6CE', borderRadius: 6,
        }}>
          <CheckCircle2 size={16} color="#1D8102" />
          <span style={{ fontSize: 13, color: '#1D8102', fontWeight: 600 }}>Nothing needs your attention right now</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        <PulseStatCard icon={TrendingUp} label="Revenue this month" value={inr(stats.revenueThisMonth ?? 0)} href="/command?tab=health" color="#1D8102" />
        <PulseStatCard icon={FileText} label="Invoices overdue" value={stats.overdueInvoices ?? 0} href="/sales" color={stats.overdueInvoices ? '#D13212' : undefined} />
        <PulseStatCard icon={TrendingUp} label="Deals gone stale" value={stats.staleDeals ?? 0} href="/sales" color={stats.staleDeals ? '#E8820C' : undefined} />
        <PulseStatCard icon={Users} label="Interviews today" value={stats.hiringInterviewsToday ?? 0} sub={`${stats.hiringPendingReview ?? 0} awaiting review`} href="/hiring" />
        <PulseStatCard icon={Mail} label="Campaigns running" value={stats.campaignsRunning ?? 0} sub={stats.campaignsPaused ? `${stats.campaignsPaused} paused` : undefined} href="/campaigns" />
        <PulseStatCard icon={FileText} label="Document batches active" value={stats.documentBatchesActive ?? 0} sub={stats.documentBatchesFailed ? `${stats.documentBatchesFailed} failed` : undefined} href="/documents" color={stats.documentBatchesFailed ? '#D13212' : undefined} />
        <PulseStatCard icon={UserCheck} label="Active subscribers" value={stats.subscribersActive ?? 0} sub={`${stats.subscribersSuppressed ?? 0} suppressed`} href="/subscribers" />
        <PulseStatCard icon={Clock} label="Companies tracked" value={stats.companiesTracked ?? 0} href="/command?tab=health" />
        <PulseStatCard icon={Search} label="SEO audits below 70" value={stats.seoAuditsLow ?? 0} href="/seo" color={stats.seoAuditsLow ? '#E8820C' : undefined} />
        <PulseStatCard icon={Newspaper} label="Posts awaiting publish" value={stats.blogPostsAwaitingPublish ?? 0} href="/blog" color={stats.blogPostsAwaitingPublish ? '#E8820C' : undefined} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: '16px 20px' }}>
        <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 12px' }}>Recent activity</p>
        {activity.length === 0 ? (
          <p style={{ fontSize: 13, color: '#AAB5BB', textAlign: 'center', padding: '16px 0' }}>No recent automation or agent activity</p>
        ) : (
          activity.map((item) => <ActivityRow key={item.id} item={item} />)
        )}
      </div>
    </div>
  )
}

// ── Financial Overview helpers ──────────────────────────────────────────────────

interface MonthlyPLRow {
  company_id:   string
  company_name: string
  month:        string
  revenue:      number
  expenses:     number
  profit:       number
}

interface ExpenseBreakdownRow {
  company_id:   string
  company_name: string
  category:     string
  total:        number
  count:        number
}

interface Expense {
  id:           string
  company_id:   string
  company_name: string
  category:     string
  amount:       number
  description:  string
  date:         string
  created_at:   string
}

function DualTrendChart({ data }: { data: MonthlyPLRow[] }) {
  if (data.length < 2) {
    return <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#AAB5BB', fontSize: 12 }}>Not enough months yet</div>
  }

  const W = 560, H = 90
  const pad = { l: 4, r: 4, t: 6, b: 18 }
  const cw = W - pad.l - pad.r
  const ch = H - pad.t - pad.b

  const allVals = data.flatMap(d => [d.revenue, d.expenses])
  const max = Math.max(...allVals, 1)

  const toPts = (key: 'revenue' | 'expenses') => data.map((d, i) => {
    const x = pad.l + (i / (data.length - 1)) * cw
    const y = pad.t + ch - (d[key] / max) * ch
    return `${x},${y}`
  })

  const revLine = 'M ' + toPts('revenue').join(' L ')
  const expLine = 'M ' + toPts('expenses').join(' L ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 90 }}>
      <path d={revLine} fill="none" stroke="#1D8102" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <path d={expLine} fill="none" stroke="#D13212" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => {
        if (i % Math.max(1, Math.floor(data.length / 6)) !== 0) return null
        const x = pad.l + (i / (data.length - 1)) * cw
        return (
          <text key={d.month} x={x} y={H - 4} textAnchor="middle" fontSize={8.5} fill="#AAB5BB">
            {new Date(d.month).toLocaleDateString('en-IN', { month: 'short' })}
          </text>
        )
      })}
    </svg>
  )
}

function CategoryBreakdownBars({ rows }: { rows: ExpenseBreakdownRow[] }) {
  if (rows.length === 0) {
    return <p style={{ fontSize: 12, color: '#AAB5BB', margin: '8px 0' }}>No expenses logged this month</p>
  }
  const max = Math.max(...rows.map(r => r.total), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {rows.map(r => (
        <div key={r.category} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11.5, color: '#16191F', width: 110, flexShrink: 0, textTransform: 'capitalize' }}>{r.category}</span>
          <div style={{ flex: 1, background: '#F2F3F3', borderRadius: 4, height: 14, overflow: 'hidden' }}>
            <div style={{ width: `${(r.total / max) * 100}%`, height: '100%', background: '#0073BB', borderRadius: 4 }} />
          </div>
          <span style={{ ...mono, fontSize: 11.5, color: '#687078', width: 90, textAlign: 'right', flexShrink: 0 }}>{inr(r.total)}</span>
        </div>
      ))}
    </div>
  )
}

function ExpenseLedger({ companies }: { companies: CompanyHealth[] }) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [editItem, setEditItem] = useState<Expense | null>(null)
  const [form, setForm] = useState({ company_id: '', category: '', amount: '', description: '', date: '' })
  const [saving, setSaving] = useState(false)

  const { data, isLoading } = useQuery<{ expenses: Expense[] }>({
    queryKey: ['finance-expenses'],
    queryFn: async () => {
      const res = await fetch('/api/finance/expenses', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const expenses = data?.expenses ?? []
  const filtered = filter.trim()
    ? expenses.filter(e =>
        e.company_name.toLowerCase().includes(filter.toLowerCase()) ||
        e.category.toLowerCase().includes(filter.toLowerCase()) ||
        e.description.toLowerCase().includes(filter.toLowerCase()))
    : expenses

  function openNew() {
    setEditItem(null)
    setForm({ company_id: companies[0]?.company_id ?? '', category: '', amount: '', description: '', date: new Date().toISOString().slice(0, 10) })
    setShowNew(true)
  }

  function openEdit(e: Expense) {
    setEditItem(e)
    setForm({ company_id: e.company_id, category: e.category, amount: String(e.amount), description: e.description, date: e.date.slice(0, 10) })
    setShowNew(false)
  }

  async function save() {
    setSaving(true)
    const payload = { company_id: form.company_id, category: form.category || 'general', amount: parseFloat(form.amount), description: form.description, date: form.date }
    const url = editItem ? `/api/finance/expenses/${editItem.id}` : '/api/finance/expenses'
    const method = editItem ? 'PATCH' : 'POST'
    await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    setSaving(false)
    setShowNew(false)
    setEditItem(null)
    qc.invalidateQueries({ queryKey: ['finance-expenses'] })
    qc.invalidateQueries({ queryKey: ['finance-expense-breakdown'] })
  }

  async function remove(id: string) {
    if (!confirm('Delete this expense?')) return
    await fetch(`/api/finance/expenses/${id}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['finance-expenses'] })
    qc.invalidateQueries({ queryKey: ['finance-expense-breakdown'] })
  }

  const slideOpen = showNew || editItem !== null

  if (isLoading) return <div style={{ padding: 32, color: '#AAB5BB' }}>Loading…</div>

  return (
    <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden', marginTop: 24 }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #D5DBDB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14 }}>Expense Ledger</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...inputStyle, width: 200, height: 32 }} placeholder="Filter by company, category…" value={filter} onChange={e => setFilter(e.target.value)} />
          <button onClick={openNew} style={{ ...btnPrimary, height: 32, fontSize: 12, padding: '0 12px' }}>+ Add Expense</button>
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#F2F3F3' }}>
            {['Date', 'Company', 'Category', 'Description', 'Amount', ''].map(h => (
              <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#687078', borderBottom: '1px solid #D5DBDB', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map(e => (
            <tr key={e.id} style={{ borderBottom: '1px solid #F2F3F3' }}>
              <td style={{ padding: '10px 16px', ...mono, fontSize: 12 }}>{fmtDate(e.date)}</td>
              <td style={{ padding: '10px 16px' }}>{e.company_name}</td>
              <td style={{ padding: '10px 16px', textTransform: 'capitalize' }}>{e.category}</td>
              <td style={{ padding: '10px 16px', color: '#687078' }}>{e.description || '-'}</td>
              <td style={{ padding: '10px 16px', ...mono, fontWeight: 600 }}>{inr(e.amount)}</td>
              <td style={{ padding: '10px 16px' }}>
                <button onClick={() => openEdit(e)} style={{ ...btnGhost, height: 26, fontSize: 11, padding: '0 8px', marginRight: 6 }}>Edit</button>
                <button onClick={() => remove(e.id)} style={{ ...btnGhost, height: 26, fontSize: 11, padding: '0 8px', color: '#D13212' }}>Delete</button>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#AAB5BB' }}>No expenses logged yet</td></tr>
          )}
        </tbody>
      </table>

      <SlideOver open={slideOpen} onClose={() => { setShowNew(false); setEditItem(null) }} title={editItem ? 'Edit Expense' : 'Add Expense'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Company</label>
            <select style={inputStyle} value={form.company_id} onChange={e => setForm(p => ({ ...p, company_id: e.target.value }))}>
              {companies.map(c => <option key={c.company_id} value={c.company_id}>{c.company_name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Category</label>
            <input style={inputStyle} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="e.g. software, payroll, travel" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Amount (₹)</label>
            <input style={inputStyle} type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Date</label>
            <input style={inputStyle} type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#687078', display: 'block', marginBottom: 6 }}>Description</label>
            <input style={inputStyle} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Optional" />
          </div>
          <button onClick={save} disabled={saving || !form.company_id || !form.amount || !form.date} style={{ ...btnPrimary, marginTop: 8 }}>
            {saving ? 'Saving…' : (editItem ? 'Update Expense' : 'Add Expense')}
          </button>
        </div>
      </SlideOver>
    </div>
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

  const { data: plData } = useQuery<{ pl: MonthlyPLRow[] }>({
    queryKey: ['finance-monthly-pl'],
    queryFn: async () => {
      const res = await fetch('/api/finance/monthly-pl', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: breakdownData } = useQuery<{ breakdown: ExpenseBreakdownRow[] }>({
    queryKey: ['finance-expense-breakdown'],
    queryFn: async () => {
      const res = await fetch('/api/finance/expenses/breakdown', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const companies = data?.companies ?? []
  const plRows = plData?.pl ?? []
  const breakdownRows = breakdownData?.breakdown ?? []
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
        <div style={{ background: '#F8F9FA', border: '1px solid #E5E7EB', borderRadius: 8, padding: '12px 16px', marginBottom: 24, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}><AlertTriangle size={18} color="#E8820C" /></span>
          <span style={{ fontSize: 13, color: '#E8820C', fontWeight: 600 }}>
            Runway warning - {lowRunway.map(c => `${c.company_name}: ${c.runway_days}d`).join(' · ')}
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

              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 24, marginTop: 20, paddingTop: 20, borderTop: '1px solid #F2F3F3' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
                    <p style={{ fontSize: 11, color: '#687078', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>Revenue vs Expenses (12mo)</p>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: '#1D8102' }}><span style={{ width: 8, height: 8, borderRadius: 4, background: '#1D8102', display: 'inline-block' }} />Revenue</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: '#D13212' }}><span style={{ width: 8, height: 8, borderRadius: 4, background: '#D13212', display: 'inline-block' }} />Expenses</span>
                  </div>
                  <DualTrendChart data={plRows.filter(r => r.company_id === co.company_id)} />
                </div>
                <div>
                  <p style={{ fontSize: 11, color: '#687078', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>This Month by Category</p>
                  <CategoryBreakdownBars rows={breakdownRows.filter(r => r.company_id === co.company_id).slice(0, 5)} />
                </div>
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

      {companies.length > 0 && <ExpenseLedger companies={companies} />}
    </div>
  )
}

// ── Financial Models Tab ─────────────────────────────────────────────────────

type ScenarioName = 'base' | 'optimistic' | 'conservative'

const SCENARIO_LABELS: Record<ScenarioName, string> = {
  base:         'Base Case',
  optimistic:   'Optimistic',
  conservative: 'Conservative',
}

interface Scenario {
  company_id:                  string
  starting_revenue:            number
  starting_expenses:           number
  starting_cash:                number
  monthly_revenue_growth_pct:  number
  monthly_expense_growth_pct:  number
  horizon_months:              number
  one_time_items:              { month_offset: number; amount: number; label: string }[]
}

interface ProjectionRow {
  month_offset: number
  revenue:      number
  expenses:     number
  profit:       number
  cash:         number
}

function CashForecastChart({ rows }: { rows: ProjectionRow[] }) {
  if (rows.length < 2) {
    return <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#AAB5BB', fontSize: 13 }}>Save assumptions to see the forecast</div>
  }

  const W = 700, H = 140
  const pad = { l: 8, r: 8, t: 10, b: 20 }
  const cw = W - pad.l - pad.r
  const ch = H - pad.t - pad.b

  const values = rows.map(r => r.cash)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 1)
  const range = max - min || 1

  const yOf = (v: number) => pad.t + ch - ((v - min) / range) * ch
  const pts = rows.map((r, i) => `${pad.l + (i / (rows.length - 1)) * cw},${yOf(r.cash)}`)
  const line = 'M ' + pts.join(' L ')
  const zeroY = yOf(0)

  const firstNegative = rows.findIndex(r => r.cash < 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 140 }}>
      {min < 0 && <line x1={pad.l} y1={zeroY} x2={pad.l + cw} y2={zeroY} stroke="#D5DBDB" strokeWidth="1" strokeDasharray="4 3" />}
      <path d={line} fill="none" stroke={firstNegative === -1 ? '#1D8102' : '#E8820C'} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {firstNegative !== -1 && (
        <circle cx={pad.l + (firstNegative / (rows.length - 1)) * cw} cy={yOf(rows[firstNegative].cash)} r={4} fill="#D13212" />
      )}
      {rows.map((r, i) => {
        if (i % Math.max(1, Math.floor(rows.length / 6)) !== 0) return null
        return (
          <text key={i} x={pad.l + (i / (rows.length - 1)) * cw} y={H - 4} textAnchor="middle" fontSize={9} fill="#AAB5BB">
            M{r.month_offset + 1}
          </text>
        )
      })}
    </svg>
  )
}

function FinancialModelsTab() {
  const qc = useQueryClient()
  const [companyId, setCompanyId] = useState<string>('')
  const [scenario, setScenario] = useState<ScenarioName>('base')
  const [form, setForm] = useState<Scenario | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies-list'],
    queryFn: async () => {
      const res = await fetch('/api/companies', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const companies = companiesData?.companies ?? []

  useEffect(() => {
    if (!companyId && companies.length > 0) setCompanyId(companies[0].id)
  }, [companies, companyId])

  const { data: scenarioData } = useQuery<{ scenario: Scenario }>({
    queryKey: ['finance-scenario', companyId],
    queryFn: async () => {
      const res = await fetch(`/api/finance/scenarios/${companyId}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!companyId,
  })

  useEffect(() => {
    if (scenarioData?.scenario) setForm(scenarioData.scenario)
  }, [scenarioData])

  const { data: projectionData, isLoading: projectionLoading } = useQuery<{ projection: ProjectionRow[]; runway_months: number | null }>({
    queryKey: ['finance-projection', companyId, scenario],
    queryFn: async () => {
      const res = await fetch(`/api/finance/scenarios/${companyId}/projection?scenario=${scenario}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!companyId,
  })

  const projection = projectionData?.projection ?? []
  const runwayMonths = projectionData?.runway_months ?? null

  async function save() {
    if (!form) return
    setSaving(true)
    await fetch(`/api/finance/scenarios/${companyId}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    qc.invalidateQueries({ queryKey: ['finance-scenario', companyId] })
    qc.invalidateQueries({ queryKey: ['finance-projection', companyId] })
  }

  function addOneTimeItem() {
    if (!form) return
    setForm({ ...form, one_time_items: [...form.one_time_items, { month_offset: 0, amount: 0, label: '' }] })
  }

  function updateOneTimeItem(i: number, patch: Partial<{ month_offset: number; amount: number; label: string }>) {
    if (!form) return
    const items = form.one_time_items.map((item, idx) => idx === i ? { ...item, ...patch } : item)
    setForm({ ...form, one_time_items: items })
  }

  function removeOneTimeItem(i: number) {
    if (!form) return
    setForm({ ...form, one_time_items: form.one_time_items.filter((_, idx) => idx !== i) })
  }

  if (!form) return <div style={{ padding: 32, color: '#AAB5BB' }}>Loading…</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <select style={{ ...inputStyle, width: 220 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8 }}>
          {(Object.keys(SCENARIO_LABELS) as ScenarioName[]).map(s => (
            <button
              key={s}
              onClick={() => setScenario(s)}
              style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                border: scenario === s ? 'none' : '1px solid #D5DBDB',
                background: scenario === s ? '#0073BB' : '#fff',
                color: scenario === s ? '#fff' : '#16191F', cursor: 'pointer',
              }}
            >
              {SCENARIO_LABELS[s]}
            </button>
          ))}
        </div>
        {runwayMonths !== null && (
          <span style={{ marginLeft: 'auto', ...mono, fontSize: 12, fontWeight: 700, color: runwayMonths < 6 ? '#D13212' : '#E8820C' }}>
            Cash runs out in month {runwayMonths + 1}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20 }}>
        {/* Assumptions form */}
        <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 20 }}>
          <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 16px' }}>Assumptions (base case)</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11.5, color: '#687078', display: 'block', marginBottom: 4 }}>Starting revenue (₹/mo)</label>
              <input style={{ ...inputStyle, height: 32 }} type="number" value={form.starting_revenue} onChange={e => setForm({ ...form, starting_revenue: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: '#687078', display: 'block', marginBottom: 4 }}>Starting expenses (₹/mo)</label>
              <input style={{ ...inputStyle, height: 32 }} type="number" value={form.starting_expenses} onChange={e => setForm({ ...form, starting_expenses: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: '#687078', display: 'block', marginBottom: 4 }}>Starting cash (₹)</label>
              <input style={{ ...inputStyle, height: 32 }} type="number" value={form.starting_cash} onChange={e => setForm({ ...form, starting_cash: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: '#687078', display: 'block', marginBottom: 4 }}>Monthly revenue growth (%)</label>
              <input style={{ ...inputStyle, height: 32 }} type="number" step="0.1" value={form.monthly_revenue_growth_pct} onChange={e => setForm({ ...form, monthly_revenue_growth_pct: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: '#687078', display: 'block', marginBottom: 4 }}>Monthly expense growth (%)</label>
              <input style={{ ...inputStyle, height: 32 }} type="number" step="0.1" value={form.monthly_expense_growth_pct} onChange={e => setForm({ ...form, monthly_expense_growth_pct: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: '#687078', display: 'block', marginBottom: 4 }}>Horizon (months)</label>
              <input style={{ ...inputStyle, height: 32 }} type="number" value={form.horizon_months} onChange={e => setForm({ ...form, horizon_months: parseInt(e.target.value) || 12 })} />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 11.5, color: '#687078' }}>One-time expenses</label>
                <button onClick={addOneTimeItem} style={{ ...btnGhost, height: 24, fontSize: 11, padding: '0 8px' }}>+ Add</button>
              </div>
              {form.one_time_items.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input style={{ ...inputStyle, height: 28, fontSize: 11, flex: 1 }} placeholder="Label" value={item.label} onChange={e => updateOneTimeItem(i, { label: e.target.value })} />
                  <input style={{ ...inputStyle, height: 28, fontSize: 11, width: 50 }} type="number" placeholder="Mo." value={item.month_offset} onChange={e => updateOneTimeItem(i, { month_offset: parseInt(e.target.value) || 0 })} />
                  <input style={{ ...inputStyle, height: 28, fontSize: 11, width: 80 }} type="number" placeholder="₹" value={item.amount} onChange={e => updateOneTimeItem(i, { amount: parseFloat(e.target.value) || 0 })} />
                  <button onClick={() => removeOneTimeItem(i)} style={{ ...btnGhost, height: 28, fontSize: 11, padding: '0 8px', color: '#D13212' }}>×</button>
                </div>
              ))}
            </div>

            <button onClick={save} disabled={saving} style={{ ...btnPrimary, marginTop: 4 }}>
              {saving ? 'Saving…' : 'Save & Recompute'}
            </button>
          </div>
        </div>

        {/* Forecast + grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 20 }}>
            <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 12px' }}>Cash forecast - {SCENARIO_LABELS[scenario]}</p>
            {projectionLoading ? <div style={{ padding: 32, color: '#AAB5BB' }}>Loading…</div> : <CashForecastChart rows={projection} />}
          </div>

          <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden' }}>
            <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: 0, padding: '16px 20px 0' }}>Projection grid</p>
            <div style={{ overflowX: 'auto', padding: '12px 20px 20px' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '6px 12px 6px 0', color: '#687078', fontWeight: 600, position: 'sticky', left: 0, background: '#fff' }}>Month</th>
                    {projection.map(r => <th key={r.month_offset} style={{ ...mono, textAlign: 'right', padding: '6px 12px', color: '#687078', fontWeight: 600, whiteSpace: 'nowrap' }}>M{r.month_offset + 1}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: 'revenue' as const, label: 'Revenue', color: '#1D8102' },
                    { key: 'expenses' as const, label: 'Expenses', color: '#D13212' },
                    { key: 'profit' as const, label: 'Profit', color: undefined },
                    { key: 'cash' as const, label: 'Cash', color: undefined },
                  ].map(row => (
                    <tr key={row.key} style={{ borderTop: '1px solid #F2F3F3' }}>
                      <td style={{ padding: '6px 12px 6px 0', fontWeight: 500, position: 'sticky', left: 0, background: '#fff', whiteSpace: 'nowrap' }}>{row.label}</td>
                      {projection.map(r => (
                        <td key={r.month_offset} style={{ ...mono, textAlign: 'right', padding: '6px 12px', whiteSpace: 'nowrap', color: row.color ?? (r[row.key] >= 0 ? '#16191F' : '#D13212') }}>
                          {inr(r[row.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {projection.length === 0 && !projectionLoading && (
                <p style={{ fontSize: 13, color: '#AAB5BB', textAlign: 'center', padding: 24 }}>Save assumptions above to generate a projection</p>
              )}
            </div>
          </div>
        </div>
      </div>
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
              <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#AAB5BB' }}>No snapshots yet - add your first one</td></tr>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PERSONA_GROUPS.map(group => (
            <div key={group.label} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#AAB5BB', minWidth: 78 }}>{group.label}</span>
              {group.personas.map(p => (
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
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {messages.length > 0 && !shareLink && (
            <button onClick={generateShareLink} style={{ ...btnGhost, height: 32, fontSize: 12, padding: '0 12px' }}>
              Share (72h link)
            </button>
          )}
          {shareLink && (
            <button onClick={copyLink} style={{ ...btnPrimary, height: 32, fontSize: 12, padding: '0 12px', background: copyDone ? '#1D8102' : '#0073BB', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {copyDone ? <><CheckCircle2 size={14} /> Copied!</> : 'Copy link'}
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
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as Tab | null
  const [activeTab, setActiveTab] = useState<Tab>(tabParam ?? 'pulse')

  useEffect(() => {
    if (tabParam) setActiveTab(tabParam)
  }, [tabParam])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'pulse',    label: 'Pulse' },
    { key: 'health',   label: 'Company Health' },
    { key: 'models',   label: 'Financial Models' },
    { key: 'holdings', label: 'Holdings' },
    { key: 'wealth',   label: 'Personal Wealth' },
    { key: 'mentor',   label: 'Mentor Council' },
  ]

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700, fontSize: 22, color: '#16191F', margin: '0 0 4px' }}>
          Command Panel
        </h1>
        <p style={{ fontSize: 13, color: '#687078', margin: 0 }}>Cross-company pulse, finance, equity holdings, personal wealth, and advisory AI</p>
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
      {activeTab === 'pulse'    && <PulseTab />}
      {activeTab === 'health'   && <CompanyHealthTab />}
      {activeTab === 'models'   && <FinancialModelsTab />}
      {activeTab === 'holdings' && <HoldingsTab />}
      {activeTab === 'wealth'   && <WealthTab />}
      {activeTab === 'mentor'   && <MentorTab />}
    </div>
  )
}
