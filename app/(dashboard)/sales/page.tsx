'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

type DealStage    = 'lead' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost'
type ServiceType  = 'cybersecurity_event' | 'penetration_test' | 'it_consulting' | 'game_development' | 'other'
type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue'
type SalesTab     = 'pipeline' | 'invoices' | 'leads' | 'clients'

interface Invoice {
  id: string
  invoice_no: string
  amount: number | string
  gst_type: 'cgst_sgst' | 'igst'
  gst_amount: number | string
  total: number | string
  due_date: string | null
  paid_at: string | null
  status: InvoiceStatus
  created_at: string
  service_description: string | null
  notes: string | null
  deal_id: string | null
  client_id: string | null
  client_name: string | null
  client_org: string | null
  client_email: string | null
  client_phone: string | null
  company_name: string
  deal_name: string | null
}

interface Client {
  id: string
  name: string
  org_name: string | null
  email: string | null
  phone: string | null
  company_id: string
}

interface Deal {
  id: string
  name: string
  value: number | string | null
  stage: DealStage
  service_type: ServiceType | null
  company_id: string
  company_name: string
  owner_id: string | null
  owner_name: string | null
  lost_reason: string | null
  days_in_stage: number
  created_at: string
}

interface User { id: string; name: string; role: string }
interface Company { id: string; name: string; invoice_prefix: string }

type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost'
type LeadSource = 'inbound' | 'outbound' | 'referral' | 'event'
type LeadBadge  = 'hot' | 'warm' | 'cold'

interface Lead {
  id: string
  company_id: string
  company_name: string
  name: string
  email: string | null
  phone: string | null
  org_name: string | null
  source: LeadSource | null
  score: number
  badge: LeadBadge | null
  status: LeadStatus
  last_contact_at: string | null
  notes: string | null
  owner_id: string | null
  owner_name: string | null
  created_at: string
}

interface ClientFull extends Client {
  company_name: string
  gstin: string | null
  address: string | null
  deals_count: number | string
  total_billed: number | string
  last_active: string | null
  created_at: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGES: { key: DealStage; label: string }[] = [
  { key: 'lead',        label: 'Lead' },
  { key: 'proposal',    label: 'Proposal' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'closed_won',  label: 'Closed Won' },
  { key: 'closed_lost', label: 'Closed Lost' },
]

const SERVICE_LABELS: Record<ServiceType, string> = {
  cybersecurity_event: 'Cybersecurity Event',
  penetration_test:    'Penetration Test',
  it_consulting:       'IT Consulting',
  game_development:    'Game Development',
  other:               'Other',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatINR(amount: number | string | null): string {
  if (amount == null || amount === '') return '—'
  const n = parseFloat(String(amount))
  if (isNaN(n)) return '—'
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function totalValue(deals: Deal[]): number {
  return deals.reduce((sum, d) => sum + (d.value ? parseFloat(String(d.value)) : 0), 0)
}

// ── Deal Card ─────────────────────────────────────────────────────────────────

function DealCard({
  deal,
  onMoveStage,
  onMoveLost,
  movingId,
}: {
  deal: Deal
  onMoveStage: (dealId: string, stage: DealStage) => void
  onMoveLost: (deal: Deal) => void
  movingId: string | null
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isMoving = movingId === deal.id
  const isClosed = deal.stage === 'closed_won' || deal.stage === 'closed_lost'

  useEffect(() => {
    if (!dropdownOpen) return
    function close(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [dropdownOpen])

  return (
    <div
      className="bg-white rounded mb-2 p-3"
      style={{
        border: '1px solid var(--border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        opacity: isMoving ? 0.55 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {/* Name + value */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium leading-snug" style={{ color: 'var(--text1)' }}>
          {deal.name}
        </p>
        <p
          className="text-sm font-semibold flex-shrink-0"
          style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text1)' }}
        >
          {formatINR(deal.value)}
        </p>
      </div>

      {/* Company tag + service type */}
      <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ backgroundColor: '#E8F4FB', color: 'var(--blue)' }}
        >
          {deal.company_name}
        </span>
        {deal.service_type && (
          <span className="text-xs" style={{ color: 'var(--text3)' }}>
            {SERVICE_LABELS[deal.service_type]}
          </span>
        )}
      </div>

      {/* Footer: owner, days, move button */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {deal.owner_name ? (
            <span className="text-xs truncate" style={{ color: 'var(--text2)' }}>{deal.owner_name}</span>
          ) : (
            <span className="text-xs" style={{ color: 'var(--text3)' }}>Unassigned</span>
          )}
          <span
            className="text-xs flex-shrink-0"
            style={{
              fontFamily: 'var(--font-ibm-plex-mono), monospace',
              color: deal.days_in_stage >= 7 ? 'var(--amber)' : 'var(--text3)',
            }}
          >
            {deal.days_in_stage}d
          </span>
        </div>

        {/* Move dropdown (hidden for closed deals) */}
        {!isClosed && (
          <div className="relative flex-shrink-0" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="text-xs px-2 py-1 rounded hover:opacity-75 transition-opacity"
              style={{ backgroundColor: '#F2F3F3', color: 'var(--text2)', border: '1px solid var(--border)' }}
            >
              Move ▾
            </button>
            {dropdownOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-20 rounded py-1"
                style={{
                  backgroundColor: '#fff',
                  border: '1px solid var(--border)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                  minWidth: '160px',
                }}
              >
                {STAGES.filter((s) => s.key !== deal.stage).map((s) => (
                  <button
                    key={s.key}
                    onClick={() => {
                      setDropdownOpen(false)
                      if (s.key === 'closed_lost') {
                        onMoveLost(deal)
                      } else {
                        onMoveStage(deal.id, s.key)
                      }
                    }}
                    className="w-full text-left text-xs px-3 py-2 transition-colors hover:opacity-75"
                    style={{
                      backgroundColor: 'transparent',
                      color:
                        s.key === 'closed_won'
                          ? 'var(--green)'
                          : s.key === 'closed_lost'
                          ? 'var(--red)'
                          : 'var(--text1)',
                    }}
                  >
                    → {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Lost reason badge for closed_lost deals */}
        {deal.stage === 'closed_lost' && deal.lost_reason && (
          <span
            className="text-xs truncate"
            style={{ color: 'var(--red)', maxWidth: '120px' }}
            title={deal.lost_reason}
          >
            {deal.lost_reason}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  stage,
  label,
  deals,
  onMoveStage,
  onMoveLost,
  movingId,
}: {
  stage: DealStage
  label: string
  deals: Deal[]
  onMoveStage: (dealId: string, stage: DealStage) => void
  onMoveLost: (deal: Deal) => void
  movingId: string | null
}) {
  const colTotal = totalValue(deals)
  const isWon  = stage === 'closed_won'
  const isLost = stage === 'closed_lost'

  const headerColor  = isWon ? 'var(--green)' : isLost ? 'var(--red)' : 'var(--text2)'
  const colBg        = isWon ? '#F0FAF0'      : isLost ? '#FEF0EE'    : '#F2F3F3'

  return (
    <div
      className="flex flex-col flex-shrink-0 rounded"
      style={{ width: '240px', backgroundColor: colBg, border: '1px solid var(--border)' }}
    >
      {/* Column header */}
      <div className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: headerColor }}>
            {label}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor: 'rgba(0,0,0,0.06)',
              color: 'var(--text2)',
              fontFamily: 'var(--font-ibm-plex-mono), monospace',
            }}
          >
            {deals.length}
          </span>
        </div>
        {deals.length > 0 && (
          <p
            className="text-xs mt-1"
            style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)' }}
          >
            {formatINR(colTotal)}
          </p>
        )}
      </div>

      {/* Cards */}
      <div className="p-2">
        {deals.length === 0 ? (
          <p className="text-xs text-center py-5" style={{ color: 'var(--text3)' }}>
            No deals
          </p>
        ) : (
          deals.map((d) => (
            <DealCard
              key={d.id}
              deal={d}
              onMoveStage={onMoveStage}
              onMoveLost={onMoveLost}
              movingId={movingId}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── New Deal Slide-over ───────────────────────────────────────────────────────

function NewDealSlideOver({
  open,
  onClose,
  onCreated,
  companies,
  users,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  companies: Company[]
  users: User[]
}) {
  const [form, setForm] = useState({
    name:         '',
    company_id:   '',
    value:        '',
    stage:        'lead' as DealStage,
    service_type: '' as ServiceType | '',
    owner_id:     '',
  })
  const [error, setSaveError] = useState('')
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    if (open) {
      setForm({
        name:         '',
        company_id:   companies[0]?.id || '',
        value:        '',
        stage:        'lead',
        service_type: '',
        owner_id:     '',
      })
      setSaveError('')
    }
  }, [open, companies])

  // Keep company_id in sync if companies load after open
  useEffect(() => {
    if (open && !form.company_id && companies.length > 0) {
      setForm((f) => ({ ...f, company_id: companies[0].id }))
    }
  }, [companies, open, form.company_id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim())   { setSaveError('Deal name is required'); return }
    if (!form.company_id)    { setSaveError('Company is required'); return }
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/deals', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:         form.name.trim(),
          company_id:   form.company_id,
          value:        form.value ? parseFloat(form.value) : null,
          stage:        form.stage,
          service_type: form.service_type || null,
          owner_id:     form.owner_id || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setSaveError(d.error || 'Failed to create deal')
        return
      }
      onCreated()
      onClose()
    } catch {
      setSaveError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const inputStyle = {
    height:      '36px',
    border:      '1px solid var(--border)',
    borderRadius: '6px',
    outline:     'none',
    padding:     '0 12px',
    fontSize:    '0.875rem',
    width:       '100%',
    fontFamily:  'var(--font-inter), sans-serif',
    backgroundColor: '#fff',
  }

  const labelStyle = {
    display:     'block',
    fontSize:    '0.75rem',
    fontWeight:  500,
    marginBottom: '4px',
    color:       'var(--text2)',
    fontFamily:  'var(--font-inter), sans-serif',
  } as React.CSSProperties

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
        onClick={onClose}
      />
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{ width: '480px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2
            className="text-base font-semibold"
            style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}
          >
            New Deal
          </h2>
          <button
            onClick={onClose}
            style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">

            <div>
              <label style={labelStyle}>Deal / Client Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Cyberdyne Systems Pentest"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Company *</label>
              <select
                value={form.company_id}
                onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
                style={{ ...inputStyle, height: '36px' }}
              >
                {companies.length === 0 && <option value="">Loading…</option>}
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Value (₹)</label>
              <input
                type="number"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                placeholder="0"
                min="0"
                step="1"
                style={{ ...inputStyle, fontFamily: 'var(--font-ibm-plex-mono), monospace' }}
              />
            </div>

            <div>
              <label style={labelStyle}>Stage *</label>
              <select
                value={form.stage}
                onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value as DealStage }))}
                style={{ ...inputStyle, height: '36px' }}
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Service Type</label>
              <select
                value={form.service_type}
                onChange={(e) => setForm((f) => ({ ...f, service_type: e.target.value as ServiceType | '' }))}
                style={{ ...inputStyle, height: '36px' }}
              >
                <option value="">— Select —</option>
                {(Object.entries(SERVICE_LABELS) as [ServiceType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Owner</label>
              <select
                value={form.owner_id}
                onChange={(e) => setForm((f) => ({ ...f, owner_id: e.target.value }))}
                style={{ ...inputStyle, height: '36px' }}
              >
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex gap-3 px-6 py-4 flex-shrink-0"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--blue)', color: '#fff', fontFamily: 'var(--font-inter), sans-serif', border: 'none', cursor: 'pointer' }}
            >
              {saving ? 'Creating…' : 'Create Deal'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded"
              style={{ backgroundColor: '#F2F3F3', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Lost Reason Slide-over ────────────────────────────────────────────────────

function LostReasonSlideOver({
  deal,
  onClose,
  onConfirm,
  saving,
}: {
  deal: Deal | null
  onClose: () => void
  onConfirm: (dealId: string, reason: string) => void
  saving: boolean
}) {
  const [reason, setReason]   = useState('')
  const [error, setError]     = useState('')

  useEffect(() => {
    if (deal) { setReason(''); setError('') }
  }, [deal])

  if (!deal) return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason.trim()) { setError('A reason is required'); return }
    onConfirm(deal!.id, reason.trim())
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
        onClick={onClose}
      />
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{ width: '440px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}
      >
        {/* Red-accented header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)', borderLeft: '4px solid var(--red)' }}
        >
          <div>
            <h2
              className="text-base font-semibold"
              style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--red)' }}
            >
              Mark as Lost
            </h2>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text2)', maxWidth: '300px' }}>
              {deal.name}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <p className="text-sm" style={{ color: 'var(--text2)' }}>
              This will move <strong style={{ color: 'var(--text1)' }}>{deal.name}</strong> to Closed/Lost.
              This cannot be undone from the pipeline view.
            </p>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  marginBottom: '4px',
                  color: 'var(--text2)',
                }}
              >
                Why was this deal lost? *
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Budget cut, chose competitor, no response after proposal..."
                rows={5}
                className="w-full resize-none"
                style={{
                  border:       '1px solid var(--border)',
                  borderRadius: '6px',
                  padding:      '8px 12px',
                  fontSize:     '0.875rem',
                  fontFamily:   'var(--font-inter), sans-serif',
                  outline:      'none',
                  width:        '100%',
                }}
              />
              {error && (
                <p className="text-xs mt-1" style={{ color: 'var(--red)' }}>{error}</p>
              )}
            </div>
          </div>

          <div
            className="flex gap-3 px-6 py-4 flex-shrink-0"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              {saving ? 'Saving…' : 'Confirm Lost'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded"
              style={{ backgroundColor: '#F2F3F3', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Pipeline Tab ──────────────────────────────────────────────────────────────

function PipelineTab() {
  const qc = useQueryClient()
  const [newDealOpen, setNewDealOpen] = useState(false)
  const [lostDeal,    setLostDeal]    = useState<Deal | null>(null)
  const [movingId,    setMovingId]    = useState<string | null>(null)

  const { data: dealsData, isLoading: dealsLoading, isError: dealsError } = useQuery<{ deals: Deal[] }>({
    queryKey: ['deals'],
    queryFn: async () => {
      const res = await fetch('/api/deals', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load deals')
      return res.json()
    },
  })

  const { data: usersData } = useQuery<{ users: User[] }>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load users')
      return res.json()
    },
  })

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies'],
    queryFn: async () => {
      const res = await fetch('/api/companies', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load companies')
      return res.json()
    },
  })

  const moveStage = useMutation({
    mutationFn: async ({
      dealId,
      stage,
      lostReason,
    }: {
      dealId: string
      stage: DealStage
      lostReason?: string
    }) => {
      const res = await fetch(`/api/deals/${dealId}/stage`, {
        method:      'PATCH',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, lost_reason: lostReason }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to move deal')
      }
      return res.json()
    },
    onMutate: ({ dealId }) => setMovingId(dealId),
    onSettled: () => {
      setMovingId(null)
      qc.invalidateQueries({ queryKey: ['deals'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  function handleMoveStage(dealId: string, stage: DealStage) {
    moveStage.mutate({ dealId, stage })
  }

  function handleConfirmLost(dealId: string, lostReason: string) {
    moveStage.mutate(
      { dealId, stage: 'closed_lost', lostReason },
      { onSettled: () => setLostDeal(null) }
    )
  }

  const deals = dealsData?.deals || []
  const dealsByStage = STAGES.reduce((acc, s) => {
    acc[s.key] = deals.filter((d) => d.stage === s.key)
    return acc
  }, {} as Record<DealStage, Deal[]>)

  const openDeals    = deals.filter((d) => !['closed_won', 'closed_lost'].includes(d.stage))
  const pipelineTotal = totalValue(openDeals)

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-6 py-4 flex-shrink-0 bg-white"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-5">
          {dealsLoading ? (
            <div className="h-4 w-32 rounded animate-pulse" style={{ backgroundColor: '#E0E3E3' }} />
          ) : dealsError ? (
            <p className="text-xs" style={{ color: 'var(--red)' }}>Failed to load deals</p>
          ) : (
            <>
              <p className="text-sm" style={{ color: 'var(--text2)' }}>
                <span
                  style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text1)', fontWeight: 600 }}
                >
                  {openDeals.length}
                </span>
                {' '}open deal{openDeals.length !== 1 ? 's' : ''}
              </p>
              <p className="text-sm" style={{ color: 'var(--text2)' }}>
                <span
                  style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--blue)', fontWeight: 600 }}
                >
                  {formatINR(pipelineTotal)}
                </span>
                {' '}pipeline
              </p>
            </>
          )}
        </div>

        <button
          onClick={() => setNewDealOpen(true)}
          className="text-sm px-4 py-2 rounded font-medium"
          style={{ backgroundColor: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}
        >
          + New Deal
        </button>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--bg)' }}>
        {dealsLoading ? (
          <div className="flex gap-4 p-6">
            {STAGES.map((s) => (
              <div
                key={s.key}
                className="flex-shrink-0 rounded animate-pulse"
                style={{ width: '240px', height: '280px', backgroundColor: '#E0E3E3' }}
              />
            ))}
          </div>
        ) : (
          <div className="flex gap-4 p-6 items-start" style={{ minWidth: 'max-content' }}>
            {STAGES.map((s) => (
              <KanbanColumn
                key={s.key}
                stage={s.key}
                label={s.label}
                deals={dealsByStage[s.key]}
                onMoveStage={handleMoveStage}
                onMoveLost={setLostDeal}
                movingId={movingId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Slide-overs */}
      <NewDealSlideOver
        open={newDealOpen}
        onClose={() => setNewDealOpen(false)}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ['deals'] })
          qc.invalidateQueries({ queryKey: ['dashboard'] })
        }}
        companies={companiesData?.companies || []}
        users={usersData?.users || []}
      />
      <LostReasonSlideOver
        deal={lostDeal}
        onClose={() => setLostDeal(null)}
        onConfirm={handleConfirmLost}
        saving={moveStage.isPending}
      />
    </div>
  )
}

// ── Shared style helpers ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  height: '36px',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  outline: 'none',
  padding: '0 12px',
  fontSize: '0.875rem',
  width: '100%',
  fontFamily: 'var(--font-inter), sans-serif',
  backgroundColor: '#fff',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 500,
  marginBottom: '4px',
  color: 'var(--text2)',
  fontFamily: 'var(--font-inter), sans-serif',
}

// ── Invoice helpers ───────────────────────────────────────────────────────────

function formatInvoiceAmount(amount: number | string | null): string {
  if (amount == null || amount === '') return '—'
  const n = parseFloat(String(amount))
  if (isNaN(n)) return '—'
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function effectiveStatus(inv: Invoice): InvoiceStatus {
  if (inv.status === 'sent' && inv.due_date) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (new Date(inv.due_date) < today) return 'overdue'
  }
  return inv.status
}

const STATUS_STYLE: Record<InvoiceStatus, React.CSSProperties> = {
  draft:   { backgroundColor: '#F2F3F3', color: '#687078' },
  sent:    { backgroundColor: '#E8F4FB', color: '#0073BB' },
  paid:    { backgroundColor: '#EBF5E8', color: '#1D8102' },
  overdue: { backgroundColor: '#FEF0EE', color: '#D13212' },
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft:   'Draft',
  sent:    'Sent',
  paid:    'Paid',
  overdue: 'Overdue',
}

// ── New Invoice Slide-over ────────────────────────────────────────────────────

function NewInvoiceSlideOver({
  open,
  onClose,
  onCreated,
  clients,
  companies,
  deals,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  clients: Client[]
  companies: Company[]
  deals: Deal[]
}) {
  const [form, setForm] = useState({
    company_id:          '',
    client_id:           '',
    deal_id:             '',
    amount:              '',
    gst_type:            'cgst_sgst' as 'cgst_sgst' | 'igst',
    due_date:            '',
    service_description: '',
    notes:               '',
  })
  const [error, setSaveError] = useState('')
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    if (open) {
      setForm({
        company_id:          companies[0]?.id || '',
        client_id:           '',
        deal_id:             '',
        amount:              '',
        gst_type:            'cgst_sgst',
        due_date:            '',
        service_description: '',
        notes:               '',
      })
      setSaveError('')
    }
  }, [open, companies])

  // Default due_date to today + 14 days
  useEffect(() => {
    if (open && !form.due_date) {
      const d = new Date()
      d.setDate(d.getDate() + 14)
      setForm((f) => ({ ...f, due_date: d.toISOString().split('T')[0] }))
    }
  }, [open, form.due_date])

  const amt    = parseFloat(form.amount) || 0
  const gst    = Math.round(amt * 0.18 * 100) / 100
  const total  = Math.round((amt + gst) * 100) / 100
  const cgst   = form.gst_type === 'cgst_sgst' ? gst / 2 : 0
  const sgst   = form.gst_type === 'cgst_sgst' ? gst / 2 : 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.company_id)   { setSaveError('Company is required'); return }
    if (!form.client_id)    { setSaveError('Client is required'); return }
    if (!form.amount || amt <= 0) { setSaveError('Amount must be greater than 0'); return }
    if (!form.due_date)     { setSaveError('Due date is required'); return }

    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/invoices', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id:          form.company_id,
          client_id:           form.client_id,
          deal_id:             form.deal_id || null,
          amount:              amt,
          gst_type:            form.gst_type,
          due_date:            form.due_date,
          service_description: form.service_description.trim() || null,
          notes:               form.notes.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setSaveError(d.error || 'Failed to create invoice')
        return
      }
      onCreated()
      onClose()
    } catch {
      setSaveError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const filteredClients = form.company_id
    ? clients.filter((cl) => cl.company_id === form.company_id)
    : clients

  const filteredDeals = form.company_id
    ? deals.filter((d) => d.company_id === form.company_id && d.stage === 'closed_won')
    : deals.filter((d) => d.stage === 'closed_won')

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{ width: '520px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>
            New Invoice
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">

            <div>
              <label style={labelStyle}>Company *</label>
              <select
                value={form.company_id}
                onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value, client_id: '', deal_id: '' }))}
                style={inputStyle}
              >
                {companies.length === 0 && <option value="">Loading…</option>}
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Client *</label>
              {filteredClients.length === 0
                ? <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
                    No clients for this company yet. Add one in the Clients tab.
                  </p>
                : <select
                    value={form.client_id}
                    onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}
                    style={inputStyle}
                  >
                    <option value="">— Select client —</option>
                    {filteredClients.map((cl) => (
                      <option key={cl.id} value={cl.id}>
                        {cl.name}{cl.org_name ? ` (${cl.org_name})` : ''}
                      </option>
                    ))}
                  </select>
              }
            </div>

            <div>
              <label style={labelStyle}>Linked Deal (optional)</label>
              <select
                value={form.deal_id}
                onChange={(e) => setForm((f) => ({ ...f, deal_id: e.target.value }))}
                style={inputStyle}
              >
                <option value="">— No deal —</option>
                {filteredDeals.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Amount (₹, excl. GST) *</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                min="0"
                step="0.01"
                style={{ ...inputStyle, fontFamily: 'var(--font-ibm-plex-mono), monospace' }}
              />
            </div>

            {amt > 0 && (
              <div
                className="rounded px-4 py-3 text-xs"
                style={{ backgroundColor: '#FFF9F5', border: '1px solid #E8820C', fontFamily: 'var(--font-ibm-plex-mono), monospace' }}
              >
                {form.gst_type === 'cgst_sgst'
                  ? <>Subtotal: {formatInvoiceAmount(amt)} | CGST 9%: {formatInvoiceAmount(cgst)} | SGST 9%: {formatInvoiceAmount(sgst)}</>
                  : <>Subtotal: {formatInvoiceAmount(amt)} | IGST 18%: {formatInvoiceAmount(gst)}</>
                }
                <span className="font-semibold ml-2" style={{ color: 'var(--amber)' }}>
                  Total: {formatInvoiceAmount(total)}
                </span>
              </div>
            )}

            <div>
              <label style={labelStyle}>GST Type *</label>
              <select
                value={form.gst_type}
                onChange={(e) => setForm((f) => ({ ...f, gst_type: e.target.value as 'cgst_sgst' | 'igst' }))}
                style={inputStyle}
              >
                <option value="cgst_sgst">CGST + SGST (Intra-state)</option>
                <option value="igst">IGST (Inter-state)</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Due Date *</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                style={{ ...inputStyle, fontFamily: 'var(--font-ibm-plex-mono), monospace' }}
              />
            </div>

            <div>
              <label style={labelStyle}>Service Description</label>
              <input
                type="text"
                value={form.service_description}
                onChange={(e) => setForm((f) => ({ ...f, service_description: e.target.value }))}
                placeholder="e.g. Penetration Testing Services — Scope: Internal Network"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Notes (appears on invoice)</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Any additional notes or payment instructions..."
                rows={3}
                className="resize-none"
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '0.875rem',
                  fontFamily: 'var(--font-inter), sans-serif',
                  outline: 'none',
                  width: '100%',
                }}
              />
            </div>

            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>

          <div className="flex gap-3 px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}
            >
              {saving ? 'Creating…' : 'Create Invoice'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded"
              style={{ backgroundColor: '#F2F3F3', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Mark Paid / Change Status inline ─────────────────────────────────────────
// Uses position:fixed so the menu escapes the table's overflow:hidden container.

function StatusDropdown({
  invoice,
  onStatusChange,
}: {
  invoice: Invoice
  onStatusChange: (id: string, status: InvoiceStatus) => void
}) {
  const [open, setOpen]   = useState(false)
  const [pos, setPos]     = useState({ top: 0, left: 0 })
  const buttonRef         = useRef<HTMLButtonElement>(null)
  const menuRef           = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (
        menuRef.current   && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function handleOpen() {
    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen((v) => !v)
  }

  const eff = effectiveStatus(invoice)
  const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue']

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="text-xs px-2 py-0.5 rounded font-medium"
        style={{ ...STATUS_STYLE[eff], border: 'none', cursor: 'pointer' }}
      >
        {STATUS_LABEL[eff]} ▾
      </button>
      {open && (
        <div
          ref={menuRef}
          style={{
            position:        'fixed',
            top:             pos.top,
            left:            pos.left,
            zIndex:          9999,
            backgroundColor: '#fff',
            border:          '1px solid var(--border)',
            boxShadow:       '0 4px 16px rgba(0,0,0,0.14)',
            borderRadius:    '6px',
            minWidth:        '110px',
            padding:         '4px 0',
          }}
        >
          {STATUSES.filter((s) => s !== invoice.status).map((s) => (
            <button
              key={s}
              onClick={() => { setOpen(false); onStatusChange(invoice.id, s) }}
              className="w-full text-left text-xs px-3 py-1.5 hover:opacity-75 transition-opacity"
              style={{ backgroundColor: 'transparent', color: STATUS_STYLE[s].color as string, cursor: 'pointer' }}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

// ── Invoices Tab ──────────────────────────────────────────────────────────────

function InvoicesTab() {
  const qc = useQueryClient()
  const [showAll, setShowAll]       = useState(false)
  const [newOpen, setNewOpen]       = useState(false)
  const [reminding, setReminding]   = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const { data: invoicesData, isLoading, isError } = useQuery<{ invoices: Invoice[] }>({
    queryKey: ['invoices', showAll],
    queryFn: async () => {
      const res = await fetch(`/api/invoices${showAll ? '?all=true' : ''}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load invoices')
      return res.json()
    },
  })

  const { data: clientsData } = useQuery<{ clients: Client[] }>({
    queryKey: ['clients'],
    queryFn: async () => {
      const res = await fetch('/api/clients', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load clients')
      return res.json()
    },
  })

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies'],
    queryFn: async () => {
      const res = await fetch('/api/companies', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load companies')
      return res.json()
    },
  })

  const { data: dealsData } = useQuery<{ deals: Deal[] }>({
    queryKey: ['deals'],
    queryFn: async () => {
      const res = await fetch('/api/deals', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load deals')
      return res.json()
    },
  })

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: InvoiceStatus }) => {
      const res = await fetch(`/api/invoices/${id}`, {
        method:      'PATCH',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Failed to update status')
      return res.json()
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  async function downloadPdf(id: string, invoiceNo: string) {
    setDownloadingId(id)
    try {
      const res = await fetch(`/api/invoices/${id}/pdf`, { credentials: 'include' })
      if (!res.ok) { alert('Failed to generate PDF'); return }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${invoiceNo}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('PDF download failed')
    } finally {
      setDownloadingId(null)
    }
  }

  async function sendReminder(id: string) {
    setReminding(id)
    try {
      const res = await fetch(`/api/invoices/${id}/remind`, {
        method:      'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const d = await res.json()
        alert(d.error || 'Failed to send reminder')
        return
      }
      alert('Reminder sent via WhatsApp')
    } catch {
      alert('Network error — could not send reminder')
    } finally {
      setReminding(null)
    }
  }

  const invoices = invoicesData?.invoices || []

  const overdueCount = invoices.filter((inv) => effectiveStatus(inv) === 'overdue').length
  const totalOutstanding = invoices
    .filter((inv) => inv.status !== 'paid')
    .reduce((sum, inv) => sum + parseFloat(String(inv.total) || '0'), 0)

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-6 py-4 flex-shrink-0 bg-white"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-5">
          {isLoading ? (
            <div className="h-4 w-40 rounded animate-pulse" style={{ backgroundColor: '#E0E3E3' }} />
          ) : isError ? (
            <p className="text-xs" style={{ color: 'var(--red)' }}>Failed to load invoices</p>
          ) : (
            <>
              {overdueCount > 0 && (
                <p className="text-sm" style={{ color: 'var(--red)' }}>
                  <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontWeight: 600 }}>{overdueCount}</span>
                  {' '}overdue
                </p>
              )}
              <p className="text-sm" style={{ color: 'var(--text2)' }}>
                <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--blue)', fontWeight: 600 }}>
                  {formatInvoiceAmount(totalOutstanding)}
                </span>
                {' '}outstanding
              </p>
              <button
                onClick={() => setShowAll((v) => !v)}
                className="text-xs px-2.5 py-1 rounded"
                style={{
                  backgroundColor: showAll ? '#E8F4FB' : '#F2F3F3',
                  color:           showAll ? 'var(--blue)' : 'var(--text2)',
                  border:          `1px solid ${showAll ? 'var(--blue)' : 'var(--border)'}`,
                  cursor:          'pointer',
                }}
              >
                {showAll ? 'Showing all' : 'Due this week + overdue'}
              </button>
            </>
          )}
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="text-sm px-4 py-2 rounded font-medium"
          style={{ backgroundColor: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}
        >
          + New Invoice
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-6" style={{ backgroundColor: 'var(--bg)' }}>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 rounded animate-pulse" style={{ backgroundColor: '#E0E3E3' }} />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center rounded"
            style={{ height: '200px', backgroundColor: '#fff', border: '1px solid var(--border)' }}
          >
            <p className="text-sm" style={{ color: 'var(--text3)' }}>
              {showAll ? 'No invoices yet' : 'No overdue or upcoming invoices'}
            </p>
            {!showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="text-xs mt-2 underline"
                style={{ color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Show all invoices
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded" style={{ border: '1px solid var(--border)', overflow: 'hidden' }}>
            <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#F2F3F3', borderBottom: '1px solid var(--border)' }}>
                  <th className="text-left px-4 py-3" style={{ color: 'var(--text2)', fontWeight: 600, fontSize: '0.75rem' }}>REF</th>
                  <th className="text-left px-4 py-3" style={{ color: 'var(--text2)', fontWeight: 600, fontSize: '0.75rem' }}>CLIENT</th>
                  <th className="text-right px-4 py-3" style={{ color: 'var(--text2)', fontWeight: 600, fontSize: '0.75rem' }}>AMOUNT</th>
                  <th className="text-left px-4 py-3" style={{ color: 'var(--text2)', fontWeight: 600, fontSize: '0.75rem' }}>DUE DATE</th>
                  <th className="text-left px-4 py-3" style={{ color: 'var(--text2)', fontWeight: 600, fontSize: '0.75rem' }}>STATUS</th>
                  <th className="text-right px-4 py-3" style={{ color: 'var(--text2)', fontWeight: 600, fontSize: '0.75rem' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, idx) => {
                  const eff      = effectiveStatus(inv)
                  const isDl     = downloadingId === inv.id
                  const isRmd    = reminding === inv.id
                  const canRemind = (eff === 'sent' || eff === 'overdue') && !!inv.client_phone

                  return (
                    <tr
                      key={inv.id}
                      style={{
                        borderBottom: idx < invoices.length - 1 ? '1px solid var(--border)' : 'none',
                        backgroundColor: '#fff',
                      }}
                    >
                      <td className="px-4 py-3">
                        <span
                          style={{
                            fontFamily: 'var(--font-ibm-plex-mono), monospace',
                            fontSize: '0.8125rem',
                            color: 'var(--text1)',
                            fontWeight: 500,
                          }}
                        >
                          {inv.invoice_no}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <p className="font-medium" style={{ color: 'var(--text1)' }}>{inv.client_name || '—'}</p>
                        {inv.client_org && (
                          <p className="text-xs" style={{ color: 'var(--text3)' }}>{inv.client_org}</p>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <span
                          style={{
                            fontFamily: 'var(--font-ibm-plex-mono), monospace',
                            fontWeight: 600,
                            color: eff === 'overdue' ? 'var(--red)' : 'var(--text1)',
                          }}
                        >
                          {formatInvoiceAmount(inv.total)}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          style={{
                            fontFamily: 'var(--font-ibm-plex-mono), monospace',
                            color: eff === 'overdue' ? 'var(--red)' : 'var(--text2)',
                          }}
                        >
                          {fmtDate(inv.due_date)}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <StatusDropdown
                          invoice={inv}
                          onStatusChange={(id, status) => statusMutation.mutate({ id, status })}
                        />
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => downloadPdf(inv.id, inv.invoice_no)}
                            disabled={isDl}
                            className="text-xs px-2.5 py-1 rounded disabled:opacity-50"
                            style={{
                              backgroundColor: '#F2F3F3',
                              color: 'var(--text1)',
                              border: '1px solid var(--border)',
                              cursor: isDl ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {isDl ? 'Generating…' : 'PDF'}
                          </button>

                          {canRemind && (
                            <button
                              onClick={() => sendReminder(inv.id)}
                              disabled={isRmd}
                              className="text-xs px-2.5 py-1 rounded disabled:opacity-50"
                              style={{
                                backgroundColor: '#FFF9F5',
                                color: 'var(--amber)',
                                border: '1px solid #E8820C',
                                cursor: isRmd ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {isRmd ? 'Sending…' : 'Remind'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewInvoiceSlideOver
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ['invoices'] })
          qc.invalidateQueries({ queryKey: ['dashboard'] })
        }}
        clients={clientsData?.clients || []}
        companies={companiesData?.companies || []}
        deals={dealsData?.deals || []}
      />
    </div>
  )
}

// ── Coming Soon Placeholder ───────────────────────────────────────────────────

// ── Lead badge + status chips ─────────────────────────────────────────────────

function BadgeChip({ badge }: { badge: LeadBadge | null }) {
  if (!badge) return <span style={{ color: 'var(--text3)' }}>—</span>
  const s: Record<LeadBadge, React.CSSProperties> = {
    hot:  { backgroundColor: '#FEF0EE', color: '#D13212' },
    warm: { backgroundColor: '#FEF8EE', color: '#E8820C' },
    cold: { backgroundColor: '#F2F3F3', color: '#687078' },
  }
  return (
    <span
      className="text-xs px-2 py-0.5 font-semibold uppercase"
      style={{ ...s[badge], borderRadius: '3px', letterSpacing: '0.06em', fontFamily: 'var(--font-ibm-plex-mono), monospace' }}
    >
      {badge}
    </span>
  )
}

const LEAD_STATUS_STYLE: Record<LeadStatus, React.CSSProperties> = {
  new:       { backgroundColor: '#E8F4FB', color: '#0073BB' },
  contacted: { backgroundColor: '#EEF4FF', color: '#5850EC' },
  qualified: { backgroundColor: '#EBF5E8', color: '#1D8102' },
  converted: { backgroundColor: '#ECFDF5', color: '#065F46' },
  lost:      { backgroundColor: '#FEF0EE', color: '#D13212' },
}

function LeadStatusChip({ status }: { status: LeadStatus }) {
  return (
    <span
      className="text-xs px-2 py-0.5 font-medium capitalize"
      style={{ ...LEAD_STATUS_STYLE[status], borderRadius: '3px' }}
    >
      {status}
    </span>
  )
}

// ── Lead Detail Slide-over ────────────────────────────────────────────────────

function LeadDetailSlideOver({
  lead, onClose, onUpdated,
}: {
  lead: Lead | null
  onClose: () => void
  onUpdated: () => void
}) {
  const [convertOpen, setConvertOpen]   = useState(false)
  const [convertForm, setConvertForm]   = useState({ deal_name: '', value: '', service_type: '' })
  const [converting, setConverting]     = useState(false)
  const [convertError, setConvertError] = useState('')
  const [convertDone, setConvertDone]   = useState(false)

  useEffect(() => {
    if (lead) {
      setConvertOpen(false)
      setConvertForm({ deal_name: `${lead.org_name || lead.name} Deal`, value: '', service_type: '' })
      setConvertError('')
      setConvertDone(false)
    }
  }, [lead])

  async function handleConvert(e: React.FormEvent) {
    e.preventDefault()
    if (!lead) return
    setConverting(true)
    setConvertError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/convert-to-deal`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal_name:    convertForm.deal_name || undefined,
          value:        convertForm.value ? parseFloat(convertForm.value) : undefined,
          service_type: convertForm.service_type || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setConvertError(d.error || 'Conversion failed')
        return
      }
      setConvertDone(true)
      onUpdated()
    } catch {
      setConvertError('Network error')
    } finally {
      setConverting(false)
    }
  }

  if (!lead) return null

  const isConverted = lead.status === 'converted' || convertDone

  const detailRows: [string, string][] = [
    ['Company',      lead.company_name],
    ['Organisation', lead.org_name || '—'],
    ['Email',        lead.email || '—'],
    ['Phone',        lead.phone || '—'],
    ['Source',       lead.source ? lead.source.charAt(0).toUpperCase() + lead.source.slice(1) : '—'],
    ['Score',        lead.score != null ? String(lead.score) : '—'],
    ['Owner',        lead.owner_name || 'Unassigned'],
    ['Last Contact', lead.last_contact_at ? fmtDate(lead.last_contact_at) : '—'],
    ['Created',      fmtDate(lead.created_at)],
  ]

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{ width: '520px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-semibold truncate" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>
              {lead.name}
            </h2>
            <BadgeChip badge={lead.badge} />
          </div>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-5">
          <LeadStatusChip status={isConverted ? 'converted' : lead.status} />

          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {detailRows.map(([label, value]) => (
              <div key={label}>
                <p className="text-xs font-medium uppercase mb-0.5" style={{ color: 'var(--text3)', letterSpacing: '0.06em' }}>{label}</p>
                <p
                  className="text-sm"
                  style={{
                    color: 'var(--text1)',
                    fontFamily: ['Score', 'Last Contact', 'Created'].includes(label) ? 'var(--font-ibm-plex-mono), monospace' : 'inherit',
                  }}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>

          {lead.notes && (
            <div>
              <p className="text-xs font-medium uppercase mb-1" style={{ color: 'var(--text3)', letterSpacing: '0.06em' }}>Notes</p>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text2)', lineHeight: 1.6 }}>{lead.notes}</p>
            </div>
          )}

          {/* Convert to Deal section */}
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '14px',
              backgroundColor: isConverted ? '#ECFDF5' : '#FAFAFA',
            }}
          >
            {isConverted ? (
              <p className="text-sm font-medium" style={{ color: '#065F46' }}>✓ Converted to deal</p>
            ) : convertOpen ? (
              <form onSubmit={handleConvert} className="flex flex-col gap-3">
                <p className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>Convert to Deal</p>
                <div>
                  <label style={labelStyle}>Deal Name</label>
                  <input
                    type="text"
                    value={convertForm.deal_name}
                    onChange={(e) => setConvertForm(f => ({ ...f, deal_name: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label style={labelStyle}>Value (₹, optional)</label>
                    <input
                      type="number"
                      value={convertForm.value}
                      onChange={(e) => setConvertForm(f => ({ ...f, value: e.target.value }))}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      style={{ ...inputStyle, fontFamily: 'var(--font-ibm-plex-mono), monospace' }}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Service Type</label>
                    <select
                      value={convertForm.service_type}
                      onChange={(e) => setConvertForm(f => ({ ...f, service_type: e.target.value }))}
                      style={inputStyle}
                    >
                      <option value="">— Select —</option>
                      {Object.entries(SERVICE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {convertError && <p className="text-xs" style={{ color: 'var(--red)' }}>{convertError}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={converting}
                    className="flex-1 text-sm py-2 font-medium"
                    style={{
                      backgroundColor: converting ? '#ccc' : 'var(--green)',
                      color: '#fff', border: 'none', borderRadius: '6px',
                      cursor: converting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {converting ? 'Converting…' : 'Confirm Convert'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConvertOpen(false)}
                    className="text-sm px-4 py-2"
                    style={{ border: '1px solid var(--border)', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: 'var(--text2)' }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setConvertOpen(true)}
                className="text-sm px-4 py-2 font-medium"
                style={{ border: '1px solid var(--blue)', borderRadius: '6px', color: 'var(--blue)', background: '#fff', cursor: 'pointer' }}
              >
                Convert to Deal →
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Add Lead Slide-over ───────────────────────────────────────────────────────

function AddLeadSlideOver({
  open, onClose, onCreated, companies, users,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  companies: Company[]
  users: User[]
}) {
  const [form, setForm] = useState({
    company_id: '', name: '', org_name: '', email: '', phone: '',
    source: '', badge: '', notes: '', owner_id: '',
  })
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({ company_id: companies[0]?.id || '', name: '', org_name: '', email: '', phone: '', source: '', badge: '', notes: '', owner_id: '' })
      setError('')
    }
  }, [open, companies])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.company_id)    { setError('Company is required'); return }
    if (!form.name.trim())   { setError('Name is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/leads', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: form.company_id,
          name:       form.name.trim(),
          org_name:   form.org_name.trim() || null,
          email:      form.email.trim() || null,
          phone:      form.phone.trim() || null,
          source:     form.source || null,
          badge:      form.badge || null,
          notes:      form.notes.trim() || null,
          owner_id:   form.owner_id || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to create lead'); return }
      onCreated(); onClose()
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{ width: '480px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>Add Lead</h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label style={labelStyle}>Company *</label>
              <select value={form.company_id} onChange={(e) => setForm(f => ({ ...f, company_id: e.target.value }))} style={inputStyle}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Contact name" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Organisation</label>
              <input type="text" value={form.org_name} onChange={(e) => setForm(f => ({ ...f, org_name: e.target.value }))} placeholder="Company / org name" style={inputStyle} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Phone</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 …" style={inputStyle} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Source</label>
                <select value={form.source} onChange={(e) => setForm(f => ({ ...f, source: e.target.value }))} style={inputStyle}>
                  <option value="">— None —</option>
                  <option value="inbound">Inbound</option>
                  <option value="outbound">Outbound</option>
                  <option value="referral">Referral</option>
                  <option value="event">Event</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Score</label>
                <select value={form.badge} onChange={(e) => setForm(f => ({ ...f, badge: e.target.value }))} style={inputStyle}>
                  <option value="">— None —</option>
                  <option value="hot">Hot</option>
                  <option value="warm">Warm</option>
                  <option value="cold">Cold</option>
                </select>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Owner</label>
              <select value={form.owner_id} onChange={(e) => setForm(f => ({ ...f, owner_id: e.target.value }))} style={inputStyle}>
                <option value="">— Assign to me —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                placeholder="Initial notes…"
                style={{ ...inputStyle, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
              />
            </div>
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>

          <div className="px-6 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button
              type="submit" disabled={saving}
              className="flex-1 text-sm py-2 font-medium"
              style={{ backgroundColor: saving ? '#ccc' : 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}
            >
              {saving ? 'Saving…' : 'Add Lead'}
            </button>
            <button
              type="button" onClick={onClose}
              className="text-sm px-4 py-2"
              style={{ border: '1px solid var(--border)', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: 'var(--text2)' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Leads Tab ─────────────────────────────────────────────────────────────────

function LeadsTab() {
  const qc = useQueryClient()
  const [filter, setFilter]           = useState('')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [addOpen, setAddOpen]         = useState(false)

  const { data: leadsData, isLoading, isError } = useQuery<{ leads: Lead[] }>({
    queryKey: ['leads'],
    queryFn: async () => {
      const res = await fetch('/api/leads', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load leads')
      return res.json()
    },
  })

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies'],
    queryFn: async () => {
      const res = await fetch('/api/companies', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load companies')
      return res.json()
    },
  })

  const { data: usersData } = useQuery<{ users: User[] }>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load users')
      return res.json()
    },
  })

  const leads = leadsData?.leads || []

  const filtered = useMemo(
    () => filter
      ? leads.filter(l => `${l.name} ${l.org_name || ''}`.toLowerCase().includes(filter.toLowerCase()))
      : leads,
    [leads, filter]
  )

  const hotCount  = leads.filter(l => l.badge === 'hot').length
  const openCount = leads.filter(l => l.status !== 'converted' && l.status !== 'lost').length

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-6 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)', backgroundColor: '#fff' }}
      >
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Filter leads…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ ...inputStyle, width: '220px' }}
          />
          {!isLoading && !isError && (
            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ color: 'var(--text2)' }}>
                <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontWeight: 600, color: 'var(--text1)' }}>{openCount}</span>
                {' '}open
              </span>
              {hotCount > 0 && (
                <span className="text-sm" style={{ color: 'var(--text2)' }}>
                  <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontWeight: 600, color: '#D13212' }}>{hotCount}</span>
                  {' '}hot
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="text-sm px-4 py-2 font-medium"
          style={{ backgroundColor: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}
        >
          + Add Lead
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 flex flex-col gap-2">
            {[1,2,3,4].map(i => <div key={i} className="h-10 rounded animate-pulse" style={{ backgroundColor: '#E0E3E3' }} />)}
          </div>
        ) : isError ? (
          <div className="p-6"><p className="text-sm" style={{ color: 'var(--red)' }}>Failed to load leads</p></div>
        ) : filtered.length === 0 ? (
          <div className="p-6"><p className="text-sm" style={{ color: 'var(--text3)' }}>No leads found{filter ? ' matching that filter' : ''}.</p></div>
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#F2F3F3', borderBottom: '1px solid var(--border)' }}>
                {['Lead', 'Org', 'Source', 'Score', 'Status', 'Last Contact', 'Owner'].map(h => (
                  <th key={h} className="text-left px-4 py-2 font-medium text-xs uppercase" style={{ color: 'var(--text2)', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => (
                <tr
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className="cursor-pointer hover:bg-gray-50"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text1)' }}>{lead.name}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{lead.org_name || '—'}</td>
                  <td className="px-4 py-3 capitalize" style={{ color: 'var(--text3)' }}>{lead.source || '—'}</td>
                  <td className="px-4 py-3"><BadgeChip badge={lead.badge} /></td>
                  <td className="px-4 py-3"><LeadStatusChip status={lead.status} /></td>
                  <td className="px-4 py-3" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)', fontSize: '0.8rem' }}>
                    {lead.last_contact_at ? fmtDate(lead.last_contact_at) : '—'}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{lead.owner_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <LeadDetailSlideOver
        lead={selectedLead}
        onClose={() => setSelectedLead(null)}
        onUpdated={() => {
          qc.invalidateQueries({ queryKey: ['leads'] })
          qc.invalidateQueries({ queryKey: ['deals'] })
          qc.invalidateQueries({ queryKey: ['clients'] })
        }}
      />

      <AddLeadSlideOver
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ['leads'] })}
        companies={companiesData?.companies || []}
        users={usersData?.users || []}
      />
    </div>
  )
}

// ── Add Client Slide-over ─────────────────────────────────────────────────────

function AddClientSlideOver({
  open, onClose, onCreated, companies,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  companies: Company[]
}) {
  const [form, setForm] = useState({ company_id: '', name: '', org_name: '', email: '', phone: '', address: '', gstin: '' })
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({ company_id: companies[0]?.id || '', name: '', org_name: '', email: '', phone: '', address: '', gstin: '' })
      setError('')
    }
  }, [open, companies])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.company_id)    { setError('Company is required'); return }
    if (!form.name.trim())   { setError('Name is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/clients', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: form.company_id,
          name:       form.name.trim(),
          org_name:   form.org_name.trim() || null,
          email:      form.email.trim() || null,
          phone:      form.phone.trim() || null,
          address:    form.address.trim() || null,
          gstin:      form.gstin.trim() || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to create client'); return }
      onCreated(); onClose()
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{ width: '480px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>Add Client</h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label style={labelStyle}>Company *</label>
              <select value={form.company_id} onChange={(e) => setForm(f => ({ ...f, company_id: e.target.value }))} style={inputStyle}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Contact name" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Organisation</label>
              <input type="text" value={form.org_name} onChange={(e) => setForm(f => ({ ...f, org_name: e.target.value }))} placeholder="Company / org name" style={inputStyle} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Phone</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 …" style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Address</label>
              <textarea
                value={form.address}
                onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                rows={2}
                placeholder="Street, city, state, PIN"
                style={{ ...inputStyle, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
              />
            </div>
            <div>
              <label style={labelStyle}>GSTIN</label>
              <input
                type="text"
                value={form.gstin}
                onChange={(e) => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                placeholder="22AAAAA0000A1Z5"
                style={{ ...inputStyle, fontFamily: 'var(--font-ibm-plex-mono), monospace' }}
              />
            </div>
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>

          <div className="px-6 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button
              type="submit" disabled={saving}
              className="flex-1 text-sm py-2 font-medium"
              style={{ backgroundColor: saving ? '#ccc' : 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}
            >
              {saving ? 'Saving…' : 'Add Client'}
            </button>
            <button
              type="button" onClick={onClose}
              className="text-sm px-4 py-2"
              style={{ border: '1px solid var(--border)', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: 'var(--text2)' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Clients Tab ───────────────────────────────────────────────────────────────

function ClientsTab() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const { data: clientsData, isLoading, isError } = useQuery<{ clients: ClientFull[] }>({
    queryKey: ['clients'],
    queryFn: async () => {
      const res = await fetch('/api/clients', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load clients')
      return res.json()
    },
  })

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies'],
    queryFn: async () => {
      const res = await fetch('/api/companies', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load companies')
      return res.json()
    },
  })

  const clients = clientsData?.clients || []

  const filtered = useMemo(
    () => filter
      ? clients.filter(c => `${c.name} ${c.org_name || ''} ${c.email || ''}`.toLowerCase().includes(filter.toLowerCase()))
      : clients,
    [clients, filter]
  )

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-6 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)', backgroundColor: '#fff' }}
      >
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Filter clients…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ ...inputStyle, width: '220px' }}
          />
          {!isLoading && !isError && (
            <span className="text-sm" style={{ color: 'var(--text2)' }}>
              <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontWeight: 600, color: 'var(--text1)' }}>{clients.length}</span>
              {' '}client{clients.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="text-sm px-4 py-2 font-medium"
          style={{ backgroundColor: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}
        >
          + Add Client
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 flex flex-col gap-2">
            {[1,2,3,4].map(i => <div key={i} className="h-10 rounded animate-pulse" style={{ backgroundColor: '#E0E3E3' }} />)}
          </div>
        ) : isError ? (
          <div className="p-6"><p className="text-sm" style={{ color: 'var(--red)' }}>Failed to load clients</p></div>
        ) : filtered.length === 0 ? (
          <div className="p-6"><p className="text-sm" style={{ color: 'var(--text3)' }}>No clients yet{filter ? ' matching that filter' : ''}.</p></div>
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#F2F3F3', borderBottom: '1px solid var(--border)' }}>
                {['Client', 'Organisation', 'Email', 'Deals', 'Total Billed', 'Last Active'].map(h => (
                  <th key={h} className="text-left px-4 py-2 font-medium text-xs uppercase" style={{ color: 'var(--text2)', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="px-4 py-3" style={{ color: 'var(--text1)' }}>
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-1.5 text-xs" style={{ color: 'var(--text3)' }}>{c.company_name}</span>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{c.org_name || '—'}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{c.email || '—'}</td>
                  <td className="px-4 py-3" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text1)' }}>
                    {String(c.deals_count)}
                  </td>
                  <td className="px-4 py-3" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text1)' }}>
                    {formatINR(c.total_billed)}
                  </td>
                  <td className="px-4 py-3" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)', fontSize: '0.8rem' }}>
                    {c.last_active ? fmtDate(c.last_active) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AddClientSlideOver
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ['clients'] })}
        companies={companiesData?.companies || []}
      />
    </div>
  )
}

function ComingSoon({ label, slice }: { label: string; slice: number }) {
  return (
    <div className="flex items-center justify-center" style={{ height: '300px' }}>
      <p className="text-sm" style={{ color: 'var(--text3)', fontFamily: 'var(--font-inter), sans-serif' }}>
        {label} — coming in Slice {slice}
      </p>
    </div>
  )
}

// ── Main Sales Page ───────────────────────────────────────────────────────────

const TABS: { key: SalesTab; label: string }[] = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'leads',    label: 'Leads' },
  { key: 'clients',  label: 'Clients' },
]

export default function SalesPage() {
  const [activeTab, setActiveTab] = useState<SalesTab>('pipeline')

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      {/* Page header + tab bar */}
      <div
        className="px-6 pt-6 flex-shrink-0"
        style={{ backgroundColor: 'var(--bg)' }}
      >
        <h1
          className="text-xl font-semibold mb-4"
          style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}
        >
          Sales
        </h1>

        <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
          {TABS.map((t) => {
            const active = activeTab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className="text-sm px-4 py-2 font-medium transition-colors"
                style={{
                  borderTop:       'none',
                  borderLeft:      'none',
                  borderRight:     'none',
                  borderBottom:    active ? '2px solid var(--blue)' : '2px solid transparent',
                  color:           active ? 'var(--blue)' : 'var(--text2)',
                  backgroundColor: 'transparent',
                  fontFamily:      'var(--font-inter), sans-serif',
                  marginBottom:    '-1px',
                  cursor:          'pointer',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1" style={{ minHeight: 0 }}>
        {activeTab === 'pipeline' && <PipelineTab />}
        {activeTab === 'invoices' && <InvoicesTab />}
        {activeTab === 'leads'    && <LeadsTab />}
        {activeTab === 'clients'  && <ClientsTab />}
      </div>
    </div>
  )
}
