'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ArrowRight, X, CheckCircle2 } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type DealStage    = 'lead' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost'
type ServiceType  = 'cybersecurity_event' | 'penetration_test' | 'it_consulting' | 'game_development' | 'other'
type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'accepted' | 'rejected' | 'expired'
type DocType      = 'invoice' | 'quotation'
type SalesTab     = 'pipeline' | 'invoices' | 'leads' | 'clients'

interface Invoice {
  id: string
  invoice_no: string
  doc_type: DocType
  amount: number | string
  gst_type: 'cgst_sgst' | 'igst' | null
  gst_mode: 'standard' | 'none'
  gst_amount: number | string
  discount_amount: number | string
  round_off: boolean
  total: number | string
  balance_due: number | string
  invoice_date: string | null
  due_date: string | null
  valid_until: string | null
  paid_at: string | null
  status: InvoiceStatus
  created_at: string
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

interface InvoiceItem {
  id?: string
  description: string
  hsn_code: string | null
  quantity: number | string
  unit_price: number | string
  discount_type: 'flat' | 'percent' | null
  discount_value: number | string
  amount?: number | string
}

interface ItemFormRow {
  description: string
  hsn_code: string
  quantity: string
  unit_price: string
  discount_type: '' | 'flat' | 'percent'
  discount_value: string
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
  if (amount == null || amount === '') return '-'
  const n = parseFloat(String(amount))
  if (isNaN(n)) return '-'
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
  onSelectDeal,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  deal: Deal
  onMoveStage: (dealId: string, stage: DealStage) => void
  onMoveLost: (deal: Deal) => void
  movingId: string | null
  onSelectDeal: (deal: Deal) => void
  onDragStart: (dealId: string, fromStage: DealStage) => void
  onDragEnd: () => void
  isDragging: boolean
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
      className={`bg-card rounded-sm mb-4 p-4 border border-border hover:shadow-md transition-all duration-200 ${isDragging ? 'rotate-[-1.5deg] scale-105 shadow-md opacity-50' : 'shadow-sm'} ${isMoving ? 'opacity-50' : 'opacity-100'} ${isClosed ? 'cursor-pointer' : 'cursor-grab'}`}
      onClick={() => onSelectDeal(deal)}
      draggable={!isClosed}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', deal.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(deal.id, deal.stage)
      }}
      onDragEnd={onDragEnd}
    >
      {/* Name + value */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-base font-semibold leading-snug text-text1 font-sans">
          {deal.name}
        </p>
        <p className="text-sm font-medium flex-shrink-0 text-text1 font-mono">
          {formatINR(deal.value)}
        </p>
      </div>

      {/* Company tag + service type */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs px-2.5 py-1 rounded-sm bg-blue/10 text-blue font-medium font-sans">
          {deal.company_name}
        </span>
        {deal.service_type && (
          <span className="text-xs text-text3 font-sans font-medium">
            {SERVICE_LABELS[deal.service_type]}
          </span>
        )}
      </div>

      {/* Footer: owner, days, move button */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {deal.owner_name ? (
            <span className="text-xs truncate text-text2 font-sans font-medium">{deal.owner_name}</span>
          ) : (
            <span className="text-xs text-text3 font-sans font-medium">Unassigned</span>
          )}
          <span className={`text-xs flex-shrink-0 font-mono font-medium ${deal.days_in_stage >= 7 ? 'text-amber' : 'text-text3'}`}>
            {deal.days_in_stage}d
          </span>
        </div>

        {/* Move dropdown (hidden for closed deals) */}
        {!isClosed && (
          <div className="relative flex-shrink-0" ref={dropdownRef} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="text-xs px-3 py-1.5 rounded-sm hover:opacity-80 transition-opacity bg-bg text-text2 border border-border flex items-center gap-1 font-sans font-medium"
            >
              Move <ChevronDown size={14} />
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 z-20 rounded-sm bg-card border border-border shadow-md min-w-[160px] py-2">
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
                    className={`w-full text-left text-sm px-4 py-2 transition-colors hover:bg-bg font-sans font-medium flex items-center gap-2 ${s.key === 'closed_won' ? 'text-green' : s.key === 'closed_lost' ? 'text-red' : 'text-text1'}`}
                  >
                    <ArrowRight size={14} /> {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Lost reason badge for closed_lost deals */}
        {deal.stage === 'closed_lost' && deal.lost_reason && (
          <span
            className="text-xs truncate text-red font-sans font-medium max-w-[120px]"
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
  onSelectDeal,
  onDragStart,
  onDragEnd,
  onDropDeal,
  draggingDealId,
  draggingFromStage,
}: {
  stage: DealStage
  label: string
  deals: Deal[]
  onMoveStage: (dealId: string, stage: DealStage) => void
  onMoveLost: (deal: Deal) => void
  movingId: string | null
  onSelectDeal: (deal: Deal) => void
  onDragStart: (dealId: string, fromStage: DealStage) => void
  onDragEnd: () => void
  onDropDeal: (dealId: string, toStage: DealStage) => void
  draggingDealId: string | null
  draggingFromStage: DealStage | null
}) {
  const [isDragOver, setIsDragOver] = useState(false)
  const colTotal = totalValue(deals)
  const isWon  = stage === 'closed_won'
  const isLost = stage === 'closed_lost'

  const isValidDropTarget = draggingDealId != null && draggingFromStage !== stage

  const getColBg = () => {
    if (isDragOver && isValidDropTarget) {
      return isLost ? 'bg-red/10 border-blue border-dashed' : isWon ? 'bg-green/10 border-blue border-dashed' : 'bg-blue/10 border-blue border-dashed'
    }
    return isWon ? 'bg-green/10 border-border' : isLost ? 'bg-red/10 border-border' : 'bg-bg border-border'
  }

  const headerColor = isWon ? 'text-green' : isLost ? 'text-red' : 'text-text2'

  return (
    <div
      className={`flex flex-col flex-shrink-0 rounded-sm w-[280px] border-2 transition-all duration-200 ${getColBg()}`}
      onDragOver={(e) => {
        if (!isValidDropTarget) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragOver(false)
        if (!isValidDropTarget) return
        const dealId = e.dataTransfer.getData('text/plain')
        if (dealId) onDropDeal(dealId, stage)
      }}
    >
      {/* Column header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-sm font-bold uppercase tracking-wider font-sans ${headerColor}`}>
            {label}
          </span>
          <span className="text-xs px-2.5 py-1 rounded-sm bg-border text-text2 font-mono font-semibold">
            {deals.length}
          </span>
        </div>
        {deals.length > 0 && (
          <p className="text-sm font-mono font-medium text-text2">
            {formatINR(colTotal)}
          </p>
        )}
      </div>

      {/* Cards */}
      <div className="p-3 min-h-[100px]">
        {deals.length === 0 ? (
          <p className={`text-sm text-center py-8 font-sans font-medium ${isDragOver && isValidDropTarget ? 'text-blue' : 'text-text3'}`}>
            {isDragOver && isValidDropTarget ? 'Drop here' : 'No deals'}
          </p>
        ) : (
          deals.map((d) => (
            <DealCard
              key={d.id}
              deal={d}
              onMoveStage={onMoveStage}
              onMoveLost={onMoveLost}
              movingId={movingId}
              onSelectDeal={onSelectDeal}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              isDragging={draggingDealId === d.id}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Deal Detail Slide-over (activity timeline) ─────────────────────────────────

interface DealActivity {
  id: string
  type: 'call' | 'email' | 'meeting' | 'note' | 'stage_change'
  note: string
  created_at: string
  user_name: string | null
}

const ACTIVITY_TYPE_LABEL: Record<DealActivity['type'], string> = {
  call: 'Call', email: 'Email', meeting: 'Meeting', note: 'Note', stage_change: 'Stage change',
}

function DealDetailSlideOver({ deal, onClose }: { deal: Deal | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [newType, setNewType] = useState<'call' | 'email' | 'meeting' | 'note'>('note')
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)

  const { data, isLoading } = useQuery<{ activities: DealActivity[] }>({
    queryKey: ['deal-activities', deal?.id],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${deal!.id}/activities`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!deal,
  })
  const activities = data?.activities ?? []

  async function addActivity() {
    if (!deal || !newNote.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/deals/${deal.id}/activities`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newType, note: newNote.trim() }),
      })
      if (!res.ok) throw new Error('Failed to save activity')
      setNewNote('')
      qc.invalidateQueries({ queryKey: ['deal-activities', deal.id] })
    } catch {
      // setSaving(false) runs in finally — button re-enables automatically
    } finally {
      setSaving(false)
    }
  }

  if (!deal) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/35" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col w-[480px] bg-bg shadow-[-4px_0_24px_rgba(0,0,0,0.14)]">
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate font-sans text-text1">{deal.name}</h2>
            <p className="text-xs mt-0.5 text-text3 font-sans">{deal.company_name} · {formatINR(deal.value)}</p>
          </div>
          <button onClick={onClose} className="text-text2 hover:text-text1 transition-colors flex-shrink-0"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5">
          <div className="flex gap-2 mb-3">
            {(['note', 'call', 'email', 'meeting'] as const).map(t => (
              <button
                key={t}
                onClick={() => setNewType(t)}
                className={`px-3 py-1 rounded-sm text-xs font-medium font-sans border transition-colors ${
                  newType === t ? 'bg-blue text-white border-blue' : 'bg-card text-text2 border-border hover:bg-bg'
                }`}
              >
                {ACTIVITY_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mb-6">
            <input
              className="flex-1 border border-border bg-card text-text1 rounded-sm px-3 h-9 text-sm font-sans focus:outline-none focus:border-blue"
              placeholder="Log a call, email, meeting, or note…"
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addActivity()}
            />
            <button
              onClick={addActivity}
              disabled={saving || !newNote.trim()}
              className="bg-blue text-white rounded-sm px-4 text-sm font-medium font-sans disabled:opacity-50 hover:bg-blue/90 transition-colors"
            >
              {saving ? '…' : 'Add'}
            </button>
          </div>

          {isLoading ? (
            <p className="text-sm text-text3 font-sans">Loading…</p>
          ) : activities.length === 0 ? (
            <p className="text-sm text-text3 font-sans text-center py-6">No activity logged yet</p>
          ) : (
            <div className="flex flex-col gap-3">
              {activities.map(a => (
                <div key={a.id} className="flex gap-2.5 border-l-2 border-border pl-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10.5px] font-bold uppercase text-text3 tracking-wider font-sans">{ACTIVITY_TYPE_LABEL[a.type]}</span>
                      <span className="text-[10.5px] text-text3 font-mono">{new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="text-sm text-text1 m-0 font-sans">{a.note}</p>
                    {a.user_name && <p className="text-xs text-text3 mt-0.5 font-sans">{a.user_name}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
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
      setSaveError('Network error - please try again')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const inputClass = "h-9 border border-border bg-card text-text1 rounded-sm outline-none px-3 text-sm w-full font-sans focus:border-blue transition-colors"
  const labelClass = "block text-xs font-medium mb-1 text-text2 font-sans"

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/35"
        onClick={onClose}
      />
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col w-[480px] bg-bg shadow-[-4px_0_24px_rgba(0,0,0,0.14)]"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0 border-b border-border"
        >
          <h2 className="text-base font-semibold font-sans text-text1">
            New Deal
          </h2>
          <button
            onClick={onClose}
            className="text-text2 hover:text-text1 transition-colors flex items-center"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">

            <div>
              <label className={labelClass}>Deal / Client Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Cyberdyne Systems Pentest"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Company *</label>
              <select
                value={form.company_id}
                onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
                className={inputClass}
              >
                {companies.length === 0 && <option value="">Loading…</option>}
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Value (₹)</label>
              <input
                type="number"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                placeholder="0"
                min="0"
                step="1"
                className="h-9 border border-border bg-card text-text1 rounded-sm outline-none px-3 text-sm w-full font-mono focus:border-blue transition-colors"
              />
            </div>

            <div>
              <label className={labelClass}>Stage *</label>
              <select
                value={form.stage}
                onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value as DealStage }))}
                className={inputClass}
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Service Type</label>
              <select
                value={form.service_type}
                onChange={(e) => setForm((f) => ({ ...f, service_type: e.target.value as ServiceType | '' }))}
                className={inputClass}
              >
                <option value="">- Select -</option>
                {(Object.entries(SERVICE_LABELS) as [ServiceType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Owner</label>
              <select
                value={form.owner_id}
                onChange={(e) => setForm((f) => ({ ...f, owner_id: e.target.value }))}
                className={inputClass}
              >
                <option value="">- Unassigned -</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <p className="text-xs text-red font-sans">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex gap-3 px-6 py-4 flex-shrink-0 border-t border-border bg-card"
          >
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded-sm font-medium disabled:opacity-50 bg-blue text-white font-sans hover:bg-blue/90 transition-colors"
            >
              {saving ? 'Creating…' : 'Create Deal'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-sm bg-bg text-text2 border border-border font-sans hover:bg-border transition-colors"
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
        className="fixed inset-0 z-40 bg-black/35"
        onClick={onClose}
      />
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col w-[440px] bg-bg shadow-[-4px_0_24px_rgba(0,0,0,0.14)]"
      >
        {/* Red-accented header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0 border-b border-border border-l-4 border-l-red"
        >
          <div>
            <h2 className="text-base font-semibold font-sans text-red">
              Mark as Lost
            </h2>
            <p className="text-xs mt-0.5 truncate text-text2 max-w-[300px] font-sans">
              {deal.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text2 hover:text-text1 transition-colors flex items-center"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <p className="text-sm text-text2 font-sans">
              This will move <strong className="text-text1 font-semibold">{deal.name}</strong> to Closed/Lost.
              This cannot be undone from the pipeline view.
            </p>

            <div>
              <label className="block text-xs font-medium mb-1 text-text2 font-sans">
                Why was this deal lost? *
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Budget cut, chose competitor, no response after proposal..."
                rows={5}
                className="w-full resize-none border border-border bg-card text-text1 rounded-sm px-3 py-2 text-sm font-sans focus:outline-none focus:border-red transition-colors"
              />
              {error && (
                <p className="text-xs mt-1 text-red font-sans">{error}</p>
              )}
            </div>
          </div>

          <div
            className="flex gap-3 px-6 py-4 flex-shrink-0 border-t border-border bg-card"
          >
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded-sm font-medium disabled:opacity-50 bg-red text-white hover:bg-red/90 transition-colors font-sans"
            >
              {saving ? 'Saving…' : 'Confirm Lost'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-sm bg-bg text-text2 border border-border font-sans hover:bg-border transition-colors"
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
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  const [draggingDealId, setDraggingDealId] = useState<string | null>(null)
  const [draggingFromStage, setDraggingFromStage] = useState<DealStage | null>(null)

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

  function handleDragStart(dealId: string, fromStage: DealStage) {
    setDraggingDealId(dealId)
    setDraggingFromStage(fromStage)
  }

  function handleDragEnd() {
    setDraggingDealId(null)
    setDraggingFromStage(null)
  }

  function handleDropDeal(dealId: string, toStage: DealStage) {
    const deal = deals.find((d) => d.id === dealId)
    if (!deal || deal.stage === toStage) return
    if (toStage === 'closed_lost') {
      setLostDeal(deal)
    } else {
      handleMoveStage(dealId, toStage)
    }
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
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 bg-card border-b border-border">
        <div className="flex items-center gap-5">
          {dealsLoading ? (
            <div className="h-4 w-32 rounded-sm animate-pulse bg-border" />
          ) : dealsError ? (
            <p className="text-xs text-red font-sans">Failed to load deals</p>
          ) : (
            <>
              <p className="text-sm text-text2 font-sans">
                <span className="font-mono text-text1 font-semibold">{openDeals.length}</span>
                {' '}open deal{openDeals.length !== 1 ? 's' : ''}
              </p>
              <p className="text-sm text-text2 font-sans">
                <span className="font-mono text-blue font-semibold">{formatINR(pipelineTotal)}</span>
                {' '}pipeline
              </p>
              <p className="text-xs hidden md:block text-text3 font-sans">
                Drag a card to another column to change its stage
              </p>
            </>
          )}
        </div>

        <button
          onClick={() => setNewDealOpen(true)}
          className="text-sm px-4 py-2 rounded-sm font-medium bg-blue text-white hover:bg-blue/90 transition-colors font-sans"
        >
          + New Deal
        </button>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-auto bg-bg">
        {dealsLoading ? (
          <div className="flex gap-4 p-6">
            {STAGES.map((s) => (
              <div
                key={s.key}
                className="flex-shrink-0 rounded-sm animate-pulse bg-card w-[240px] h-[280px] border border-border"
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
                onSelectDeal={setSelectedDeal}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDropDeal={handleDropDeal}
                draggingDealId={draggingDealId}
                draggingFromStage={draggingFromStage}
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
      <DealDetailSlideOver
        deal={selectedDeal}
        onClose={() => setSelectedDeal(null)}
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
  if (amount == null || amount === '') return '-'
  const n = parseFloat(String(amount))
  if (isNaN(n)) return '-'
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function effectiveStatus(inv: Invoice): InvoiceStatus {
  if (inv.doc_type === 'invoice' && inv.status === 'sent' && inv.due_date) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (new Date(inv.due_date) < today) return 'overdue'
  }
  return inv.status
}

const STATUS_CLASS: Record<InvoiceStatus, string> = {
  draft:    'bg-border/50 text-text2',
  sent:     'bg-blue/10 text-blue',
  paid:     'bg-green/10 text-green',
  overdue:  'bg-red/10 text-red',
  accepted: 'bg-green/10 text-green',
  rejected: 'bg-red/10 text-red',
  expired:  'bg-border/50 text-text2',
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft:    'Draft',
  sent:     'Sent',
  paid:     'Paid',
  overdue:  'Overdue',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired:  'Expired',
}

const INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue']
const QUOTATION_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired']

// ── New Invoice Slide-over ────────────────────────────────────────────────────

function emptyItemRow(): ItemFormRow {
  return { description: '', hsn_code: '', quantity: '1', unit_price: '', discount_type: '', discount_value: '' }
}

function computeItemAmount(row: ItemFormRow): number {
  const qty  = parseFloat(row.quantity) || 0
  const rate = parseFloat(row.unit_price) || 0
  const raw  = qty * rate
  const discVal = parseFloat(row.discount_value) || 0
  const disc = row.discount_type === 'percent' ? raw * discVal / 100 : (row.discount_type === 'flat' ? discVal : 0)
  return Math.round((raw - disc) * 100) / 100
}

function InvoiceSlideOver({
  open, onClose, onSaved, clients, companies, deals, editingId,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  clients: ClientFull[]
  companies: Company[]
  deals: Deal[]
  editingId: string | null
}) {
  const isEdit = !!editingId

  const [docType, setDocType] = useState<DocType>('invoice')
  const [form, setForm] = useState({
    company_id: '', client_id: '', deal_id: '',
    invoice_date: '', supply_date: '', due_date: '', valid_until: '',
    payment_terms_label: 'Net 14', place_of_supply: '', po_number: '', notes: '', terms_conditions: '',
    show_company_gstin: true, client_gstin_override: '',
    gst_mode: 'standard' as 'standard' | 'none', gst_type: 'cgst_sgst' as 'cgst_sgst' | 'igst', gst_rate: '18',
    round_off: false,
    overall_discount_type: '' as '' | 'flat' | 'percent', overall_discount_value: '',
    status: 'draft' as InvoiceStatus,
  })
  const [items, setItems] = useState<ItemFormRow[]>([emptyItemRow()])
  const [error, setError]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function todayPlus(days: number): string {
    const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]
  }

  useEffect(() => {
    if (!open) return
    setError('')
    setConfirmDelete(false)

    if (editingId) {
      setLoading(true)
      fetch(`/api/invoices/${editingId}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d: { invoice: Invoice & Record<string, any>; items: InvoiceItem[] }) => {
          const inv = d.invoice
          setDocType(inv.doc_type)
          setForm({
            company_id: inv.company_id ?? '', client_id: inv.client_id ?? '', deal_id: inv.deal_id ?? '',
            invoice_date: inv.invoice_date ?? '', supply_date: inv.supply_date ?? '',
            due_date: inv.due_date ?? '', valid_until: inv.valid_until ?? '',
            payment_terms_label: inv.payment_terms_label ?? 'Net 14',
            place_of_supply: inv.place_of_supply ?? '', po_number: inv.po_number ?? '',
            notes: inv.notes ?? '', terms_conditions: inv.terms_conditions ?? '',
            show_company_gstin: inv.show_company_gstin !== false,
            client_gstin_override: inv.client_gstin_override ?? '',
            gst_mode: inv.gst_mode === 'none' ? 'none' : 'standard',
            gst_type: inv.gst_type === 'igst' ? 'igst' : 'cgst_sgst',
            gst_rate: String(inv.gst_rate ?? 18),
            round_off: !!inv.round_off,
            overall_discount_type: inv.overall_discount_type ?? '',
            overall_discount_value: inv.overall_discount_value ? String(inv.overall_discount_value) : '',
            status: inv.status,
          })
          setItems(
            (d.items || []).map((it) => ({
              description: it.description, hsn_code: it.hsn_code || '',
              quantity: String(it.quantity), unit_price: String(it.unit_price),
              discount_type: it.discount_type || '', discount_value: it.discount_value ? String(it.discount_value) : '',
            })) as ItemFormRow[]
          )
          if ((d.items || []).length === 0) setItems([emptyItemRow()])
        })
        .catch(() => setError('Failed to load document'))
        .finally(() => setLoading(false))
    } else {
      setDocType('invoice')
      setForm({
        company_id: companies[0]?.id || '', client_id: '', deal_id: '',
        invoice_date: todayPlus(0), supply_date: todayPlus(0), due_date: todayPlus(14), valid_until: todayPlus(14),
        payment_terms_label: 'Net 14', place_of_supply: '', po_number: '', notes: '', terms_conditions: '',
        show_company_gstin: true, client_gstin_override: '',
        gst_mode: 'standard', gst_type: 'cgst_sgst', gst_rate: '18',
        round_off: false,
        overall_discount_type: '', overall_discount_value: '',
        status: 'draft',
      })
      setItems([emptyItemRow()])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId])

  function updateItem(idx: number, patch: Partial<ItemFormRow>) {
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function addItem() { setItems((rows) => [...rows, emptyItemRow()]) }
  function removeItem(idx: number) { setItems((rows) => rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows) }

  const computedItems = items.map((row) => ({ row, amount: computeItemAmount(row) }))
  const subtotal = computedItems.reduce((sum, i) => sum + i.amount, 0)
  const overallDiscountValue = parseFloat(form.overall_discount_value) || 0
  const overallDiscountAmount = form.overall_discount_type === 'percent'
    ? Math.round(subtotal * overallDiscountValue / 100 * 100) / 100
    : (form.overall_discount_type === 'flat' ? overallDiscountValue : 0)
  const taxableAmount = Math.round((subtotal - overallDiscountAmount) * 100) / 100
  const gstRateNum = parseFloat(form.gst_rate) || 0
  const gstAmount = form.gst_mode === 'none' ? 0 : Math.round(taxableAmount * gstRateNum / 100 * 100) / 100
  const rawTotal = taxableAmount + gstAmount
  const total = form.round_off ? Math.round(rawTotal) : Math.round(rawTotal * 100) / 100

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.company_id) { setError('Company is required'); return }
    if (!form.client_id)  { setError('Client is required'); return }
    if (docType === 'invoice'   && !form.due_date)    { setError('Due date is required'); return }
    if (docType === 'quotation' && !form.valid_until) { setError('Valid until date is required'); return }
    for (const row of items) {
      if (!row.description.trim()) { setError('Every line item needs a description'); return }
      if (!(parseFloat(row.quantity) > 0)) { setError(`"${row.description}" needs a quantity greater than 0`); return }
      if (!(parseFloat(row.unit_price) >= 0)) { setError(`"${row.description}" needs a unit price`); return }
    }

    setSaving(true); setError('')
    try {
      const payload = {
        doc_type: docType,
        company_id: form.company_id, client_id: form.client_id, deal_id: form.deal_id || null,
        invoice_date: form.invoice_date, supply_date: form.supply_date,
        due_date: docType === 'invoice' ? form.due_date : undefined,
        valid_until: docType === 'quotation' ? form.valid_until : undefined,
        items: items.map((row) => ({
          description: row.description.trim(),
          hsn_code: row.hsn_code.trim() || null,
          quantity: parseFloat(row.quantity),
          unit_price: parseFloat(row.unit_price),
          discount_type: row.discount_type || null,
          discount_value: row.discount_type ? (parseFloat(row.discount_value) || 0) : 0,
        })),
        gst_mode: form.gst_mode,
        gst_type: form.gst_mode === 'standard' ? form.gst_type : undefined,
        gst_rate: gstRateNum,
        round_off: form.round_off,
        overall_discount_type: form.overall_discount_type || null,
        overall_discount_value: overallDiscountValue,
        payment_terms_label: form.payment_terms_label || null,
        terms_conditions: form.terms_conditions || null,
        place_of_supply: form.place_of_supply || null,
        show_company_gstin: form.show_company_gstin,
        client_gstin_override: form.client_gstin_override || null,
        po_number: form.po_number || null,
        notes: form.notes || null,
      }

      const res = await fetch(isEdit ? `/api/invoices/${editingId}` : '/api/invoices', {
        method: isEdit ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to save'); return }
      onSaved()
      onClose()
    } catch {
      setError('Network error - please try again')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editingId) return
    setDeleting(true); setError('')
    try {
      const res = await fetch(`/api/invoices/${editingId}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to delete'); return }
      onSaved()
      onClose()
    } catch { setError('Network error')
    } finally { setDeleting(false) }
  }

  if (!open) return null

  const filteredClients = form.company_id ? clients.filter((cl) => cl.company_id === form.company_id) : clients
  const filteredDeals = form.company_id
    ? deals.filter((d) => d.company_id === form.company_id && d.stage === 'closed_won')
    : deals.filter((d) => d.stage === 'closed_won')

  const inputClass = "h-9 border border-border bg-card text-text1 rounded-sm outline-none px-3 text-sm w-full font-sans focus:border-blue transition-colors"
  const monoInputClass = "h-9 border border-border bg-card text-text1 rounded-sm outline-none px-3 text-sm w-full font-mono focus:border-blue transition-colors"
  const labelClass = "block text-xs font-medium mb-1 text-text2 font-sans"
  const smallInput = "h-8 border border-border bg-card text-text1 rounded-sm outline-none px-2 text-xs w-full font-sans focus:border-blue transition-colors"

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/35" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col w-[720px] max-w-[92vw] bg-bg shadow-[-4px_0_24px_rgba(0,0,0,0.14)]">
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold font-sans text-text1">
              {isEdit ? `Edit ${docType === 'quotation' ? 'Quotation' : 'Invoice'}` : `New ${docType === 'quotation' ? 'Quotation' : 'Invoice'}`}
            </h2>
            {!isEdit && (
              <div className="flex gap-1 p-0.5 bg-border/30 rounded-sm">
                {(['invoice', 'quotation'] as DocType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDocType(t)}
                    className={`text-xs px-3 py-1 rounded-sm font-medium capitalize transition-colors font-sans ${docType === t ? 'bg-card text-text1 shadow-sm' : 'text-text2 hover:text-text1'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isEdit && !confirmDelete && (
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs font-medium text-red hover:underline font-sans">Delete</button>
            )}
            <button onClick={onClose} className="text-text2 hover:text-text1 transition-colors"><X size={18} /></button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center"><p className="text-sm text-text3 font-sans">Loading…</p></div>
        ) : (
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-5 flex-1">

            {confirmDelete && (
              <div className="border border-red/40 bg-red/10 rounded-sm p-4 flex flex-col gap-3">
                <p className="text-sm text-text1 font-sans">Delete this {docType}? This cannot be undone.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={handleDelete} disabled={deleting} className="text-sm px-4 py-2 font-medium rounded-sm disabled:opacity-50 bg-red text-white hover:bg-red/90 transition-colors font-sans">
                    {deleting ? 'Deleting…' : 'Confirm Delete'}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="text-sm px-4 py-2 rounded-sm bg-bg text-text2 border border-border hover:bg-border transition-colors font-sans">Cancel</button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Company *</label>
                <select value={form.company_id} onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value, client_id: '', deal_id: '' }))} className={inputClass}>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Client *</label>
                <select value={form.client_id} onChange={(e) => {
                  const clientId = e.target.value
                  const cl = clients.find((x) => x.id === clientId)
                  setForm((f) => ({ ...f, client_id: clientId, client_gstin_override: cl?.gstin || '' }))
                }} className={inputClass}>
                  <option value="">- Select client -</option>
                  {filteredClients.map((cl) => (
                    <option key={cl.id} value={cl.id}>{cl.name}{cl.org_name ? ` (${cl.org_name})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Linked Deal</label>
                <select value={form.deal_id} onChange={(e) => setForm((f) => ({ ...f, deal_id: e.target.value }))} className={inputClass}>
                  <option value="">- No deal -</option>
                  {filteredDeals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={labelClass}>Line Items *</label>
                <button type="button" onClick={addItem} className="text-xs font-medium text-blue hover:underline font-sans">+ Add Line</button>
              </div>
              <div className="flex flex-col gap-2">
                {computedItems.map(({ row, amount }, idx) => (
                  <div key={idx} className="border border-border bg-card rounded-sm p-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <input type="text" value={row.description} onChange={(e) => updateItem(idx, { description: e.target.value })} placeholder="Description" className={`${smallInput} flex-1`} />
                      <input type="text" value={row.hsn_code} onChange={(e) => updateItem(idx, { hsn_code: e.target.value })} placeholder="HSN/SAC" className={`${smallInput} w-24 font-mono`} />
                      {items.length > 1 && (
                        <button type="button" onClick={() => removeItem(idx)} className="text-text3 hover:text-red transition-colors px-1"><X size={14} /></button>
                      )}
                    </div>
                    <div className="grid grid-cols-5 gap-2 items-center">
                      <input type="number" min="0" step="0.01" value={row.quantity} onChange={(e) => updateItem(idx, { quantity: e.target.value })} placeholder="Qty" className={`${smallInput} font-mono`} />
                      <input type="number" min="0" step="0.01" value={row.unit_price} onChange={(e) => updateItem(idx, { unit_price: e.target.value })} placeholder="Unit Price" className={`${smallInput} font-mono`} />
                      <select value={row.discount_type} onChange={(e) => updateItem(idx, { discount_type: e.target.value as '' | 'flat' | 'percent' })} className={smallInput}>
                        <option value="">No discount</option>
                        <option value="flat">₹ flat</option>
                        <option value="percent">% off</option>
                      </select>
                      <input type="number" min="0" step="0.01" disabled={!row.discount_type} value={row.discount_value} onChange={(e) => updateItem(idx, { discount_value: e.target.value })} placeholder="Discount" className={`${smallInput} font-mono disabled:opacity-40`} />
                      <p className="text-xs font-mono text-right text-text1 font-semibold">{formatInvoiceAmount(amount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Overall discount + GST */}
            <div className="grid grid-cols-2 gap-4">
              <div className="border border-border bg-card rounded-sm p-3 flex flex-col gap-2">
                <p className="text-xs font-semibold text-text1 font-sans">Overall Discount</p>
                <div className="grid grid-cols-2 gap-2">
                  <select value={form.overall_discount_type} onChange={(e) => setForm((f) => ({ ...f, overall_discount_type: e.target.value as '' | 'flat' | 'percent' }))} className={smallInput}>
                    <option value="">None</option>
                    <option value="flat">₹ flat</option>
                    <option value="percent">% off</option>
                  </select>
                  <input type="number" min="0" step="0.01" disabled={!form.overall_discount_type} value={form.overall_discount_value} onChange={(e) => setForm((f) => ({ ...f, overall_discount_value: e.target.value }))} placeholder="Value" className={`${smallInput} font-mono disabled:opacity-40`} />
                </div>
              </div>
              <div className="border border-border bg-card rounded-sm p-3 flex flex-col gap-2">
                <p className="text-xs font-semibold text-text1 font-sans">GST</p>
                <div className="flex gap-1 p-0.5 bg-border/30 rounded-sm w-max">
                  {(['standard', 'none'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setForm((f) => ({ ...f, gst_mode: m }))} className={`text-xs px-3 py-1 rounded-sm font-medium transition-colors font-sans ${form.gst_mode === m ? 'bg-card text-text1 shadow-sm' : 'text-text2'}`}>
                      {m === 'standard' ? 'Standard' : 'No GST'}
                    </button>
                  ))}
                </div>
                {form.gst_mode === 'standard' && (
                  <div className="grid grid-cols-2 gap-2">
                    <select value={form.gst_type} onChange={(e) => setForm((f) => ({ ...f, gst_type: e.target.value as 'cgst_sgst' | 'igst' }))} className={smallInput}>
                      <option value="cgst_sgst">CGST+SGST</option>
                      <option value="igst">IGST</option>
                    </select>
                    <input type="number" min="0" step="0.1" value={form.gst_rate} onChange={(e) => setForm((f) => ({ ...f, gst_rate: e.target.value }))} placeholder="Rate %" className={`${smallInput} font-mono`} />
                  </div>
                )}
                <label className="flex items-center gap-2 text-xs text-text2 font-sans mt-1">
                  <input type="checkbox" checked={form.round_off} onChange={(e) => setForm((f) => ({ ...f, round_off: e.target.checked }))} />
                  Round off total to nearest ₹
                </label>
              </div>
            </div>

            {/* Live totals */}
            <div className="rounded-sm px-4 py-3 text-xs bg-border/20 border border-border font-mono text-text1 flex flex-wrap gap-x-4 gap-y-1">
              <span>Sub Total: {formatInvoiceAmount(subtotal)}</span>
              {overallDiscountAmount > 0 && <span className="text-amber">Discount: -{formatInvoiceAmount(overallDiscountAmount)}</span>}
              <span>{form.gst_mode === 'none' ? 'GST: N/A' : `GST (${gstRateNum}%): ${formatInvoiceAmount(gstAmount)}`}</span>
              <span className="font-semibold text-blue">Total: {formatInvoiceAmount(total)}</span>
            </div>

            {/* Dates + terms */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{docType === 'quotation' ? 'Quotation Date' : 'Invoice Date'}</label>
                <input type="date" value={form.invoice_date} onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))} className={monoInputClass} />
              </div>
              <div>
                <label className={labelClass}>Supply Date</label>
                <input type="date" value={form.supply_date} onChange={(e) => setForm((f) => ({ ...f, supply_date: e.target.value }))} className={monoInputClass} />
              </div>
              {docType === 'invoice' ? (
                <>
                  <div>
                    <label className={labelClass}>Payment Terms</label>
                    <input type="text" value={form.payment_terms_label} onChange={(e) => setForm((f) => ({ ...f, payment_terms_label: e.target.value }))} placeholder="Net 14" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Due Date *</label>
                    <input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} className={monoInputClass} />
                  </div>
                </>
              ) : (
                <div>
                  <label className={labelClass}>Valid Until *</label>
                  <input type="date" value={form.valid_until} onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} className={monoInputClass} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Place of Supply</label>
                <input type="text" value={form.place_of_supply} onChange={(e) => setForm((f) => ({ ...f, place_of_supply: e.target.value }))} placeholder="e.g. Tamil Nadu (33) - optional" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>P.O. Number</label>
                <input type="text" value={form.po_number} onChange={(e) => setForm((f) => ({ ...f, po_number: e.target.value }))} className={inputClass} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <label className="flex items-center gap-2 text-xs text-text2 font-sans">
                <input type="checkbox" checked={form.show_company_gstin} onChange={(e) => setForm((f) => ({ ...f, show_company_gstin: e.target.checked }))} />
                Show company GSTIN on this document
              </label>
              <div>
                <label className={labelClass}>Client GSTIN</label>
                <input type="text" value={form.client_gstin_override} onChange={(e) => setForm((f) => ({ ...f, client_gstin_override: e.target.value.toUpperCase() }))} className={`${monoInputClass} uppercase`} />
              </div>
            </div>

            <div>
              <label className={labelClass}>Terms &amp; Conditions</label>
              <textarea value={form.terms_conditions} onChange={(e) => setForm((f) => ({ ...f, terms_conditions: e.target.value }))} rows={3} placeholder="Leave blank to use the company's default terms" className="w-full border border-border bg-card text-text1 rounded-sm px-3 py-2 text-sm font-sans focus:outline-none focus:border-blue transition-colors h-auto resize-y" />
            </div>

            <div>
              <label className={labelClass}>Notes (appears on document)</label>
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full resize-y border border-border bg-card text-text1 rounded-sm px-3 py-2 text-sm font-sans focus:outline-none focus:border-blue transition-colors" />
            </div>

            {error && <p className="text-xs text-red font-sans">{error}</p>}
          </div>

          <div className="flex gap-3 px-6 py-4 flex-shrink-0 border-t border-border bg-card">
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-sm font-medium disabled:opacity-50 bg-blue text-white hover:bg-blue/90 transition-colors font-sans">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : `Create ${docType === 'quotation' ? 'Quotation' : 'Invoice'}`}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-sm bg-bg text-text2 border border-border hover:bg-border transition-colors font-sans">Cancel</button>
          </div>
        </form>
        )}
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
  const STATUSES = invoice.doc_type === 'quotation' ? QUOTATION_STATUSES : INVOICE_STATUSES

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className={`text-xs px-2 py-0.5 rounded-sm font-medium inline-flex items-center gap-1 ${STATUS_CLASS[eff]}`}
      >
        {STATUS_LABEL[eff]} <ChevronDown size={11} />
      </button>
      {open && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-[9999] bg-card border border-border shadow-md rounded-sm min-w-[110px] py-1"
        >
          {STATUSES.filter((s) => s !== invoice.status).map((s) => (
            <button
              key={s}
              onClick={() => { setOpen(false); onStatusChange(invoice.id, s) }}
              className={`w-full text-left text-xs px-3 py-1.5 hover:bg-bg transition-colors font-medium ${STATUS_CLASS[s].split(' ')[1]}`}
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
  const [docType, setDocType]       = useState<DocType>('invoice')
  const [showAll, setShowAll]       = useState(false)
  const [slideOverOpen, setSlideOverOpen] = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [reminding, setReminding]   = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const { data: invoicesData, isLoading, isError } = useQuery<{ invoices: Invoice[] }>({
    queryKey: ['invoices', docType, showAll],
    queryFn: async () => {
      const params = new URLSearchParams({ doc_type: docType })
      if (showAll) params.set('all', 'true')
      const res = await fetch(`/api/invoices?${params.toString()}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load invoices')
      return res.json()
    },
  })

  const { data: clientsData } = useQuery<{ clients: ClientFull[] }>({
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

  function openCreate() { setEditingId(null); setSlideOverOpen(true) }
  function openEdit(id: string) { setEditingId(id); setSlideOverOpen(true) }

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
      alert('Network error - could not send reminder')
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
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 bg-card border-b border-border">
        <div className="flex items-center gap-5">
          <div className="flex gap-1 p-0.5 bg-border/30 rounded-sm">
            {(['invoice', 'quotation'] as DocType[]).map((t) => (
              <button
                key={t}
                onClick={() => setDocType(t)}
                className={`text-xs px-3 py-1.5 rounded-sm font-medium capitalize transition-colors font-sans ${docType === t ? 'bg-card text-text1 shadow-sm' : 'text-text2 hover:text-text1'}`}
              >
                {t === 'invoice' ? 'Invoices' : 'Quotations'}
              </button>
            ))}
          </div>
          {isLoading ? (
            <div className="h-4 w-40 rounded-sm animate-pulse bg-border" />
          ) : isError ? (
            <p className="text-xs text-red font-sans">Failed to load {docType === 'quotation' ? 'quotations' : 'invoices'}</p>
          ) : (
            <>
              {docType === 'invoice' && overdueCount > 0 && (
                <p className="text-sm text-red font-sans">
                  <span className="font-mono font-semibold">{overdueCount}</span>
                  {' '}overdue
                </p>
              )}
              {docType === 'invoice' && (
                <p className="text-sm text-text2 font-sans">
                  <span className="font-mono text-blue font-semibold">
                    {formatInvoiceAmount(totalOutstanding)}
                  </span>
                  {' '}outstanding
                </p>
              )}
              {docType === 'invoice' && (
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className={`text-xs px-2.5 py-1 rounded-sm border font-sans transition-colors ${showAll ? 'bg-blue/10 text-blue border-blue' : 'bg-bg text-text2 border-border hover:bg-border'}`}
                >
                  {showAll ? 'Showing all' : 'Due this week + overdue'}
                </button>
              )}
            </>
          )}
        </div>
        <button
          onClick={openCreate}
          className="text-sm px-4 py-2 rounded-sm font-medium bg-blue text-white hover:bg-blue/90 transition-colors font-sans"
        >
          + New {docType === 'quotation' ? 'Quotation' : 'Invoice'}
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-6 bg-bg">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 rounded-sm animate-pulse bg-border" />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-sm h-[200px] bg-card border border-border">
            <p className="text-sm text-text3 font-sans">
              {docType === 'quotation' ? 'No quotations yet' : (showAll ? 'No invoices yet' : 'No overdue or upcoming invoices')}
            </p>
            {docType === 'invoice' && !showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="text-xs mt-2 underline text-blue font-sans hover:text-blue/80 transition-colors"
              >
                Show all invoices
              </button>
            )}
          </div>
        ) : (
          <div className="bg-card rounded-sm border border-border overflow-hidden">
            <table className="w-full border-collapse text-[0.8125rem] font-sans">
              <thead>
                <tr className="bg-bg border-b border-border">
                  <th className="text-left px-4 py-3 text-text2 font-semibold text-xs">REF</th>
                  <th className="text-left px-4 py-3 text-text2 font-semibold text-xs">CLIENT</th>
                  <th className="text-right px-4 py-3 text-text2 font-semibold text-xs">AMOUNT</th>
                  <th className="text-left px-4 py-3 text-text2 font-semibold text-xs">{docType === 'quotation' ? 'VALID UNTIL' : 'DUE DATE'}</th>
                  <th className="text-left px-4 py-3 text-text2 font-semibold text-xs">STATUS</th>
                  <th className="text-right px-4 py-3 text-text2 font-semibold text-xs">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, idx) => {
                  const eff      = effectiveStatus(inv)
                  const isDl     = downloadingId === inv.id
                  const isRmd    = reminding === inv.id
                  const canRemind = docType === 'invoice' && (eff === 'sent' || eff === 'overdue') && !!inv.client_phone

                  return (
                    <tr
                      key={inv.id}
                      className={`bg-card hover:bg-bg transition-colors cursor-pointer ${idx < invoices.length - 1 ? 'border-b border-border' : ''}`}
                      onClick={() => openEdit(inv.id)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-[0.8125rem] text-text1 font-medium">
                          {inv.invoice_no}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <p className="font-medium text-text1">{inv.client_name || '-'}</p>
                        {inv.client_org && (
                          <p className="text-xs text-text3">{inv.client_org}</p>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <span className={`font-mono font-semibold ${eff === 'overdue' ? 'text-red' : 'text-text1'}`}>
                          {formatInvoiceAmount(inv.total)}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <span className={`font-mono ${eff === 'overdue' ? 'text-red' : 'text-text2'}`}>
                          {fmtDate(docType === 'quotation' ? inv.valid_until : inv.due_date)}
                        </span>
                      </td>

                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <StatusDropdown
                          invoice={inv}
                          onStatusChange={(id, status) => statusMutation.mutate({ id, status })}
                        />
                      </td>

                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => downloadPdf(inv.id, inv.invoice_no)}
                            disabled={isDl}
                            className="text-xs px-2.5 py-1 rounded-sm disabled:opacity-50 bg-bg text-text1 border border-border hover:bg-border transition-colors font-sans"
                          >
                            {isDl ? 'Generating…' : 'PDF'}
                          </button>

                          {canRemind && (
                            <button
                              onClick={() => sendReminder(inv.id)}
                              disabled={isRmd}
                              className="text-xs px-2.5 py-1 rounded-sm disabled:opacity-50 bg-amber/10 text-amber border border-amber/30 hover:bg-amber/20 transition-colors font-sans"
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

      <InvoiceSlideOver
        open={slideOverOpen}
        editingId={editingId}
        onClose={() => setSlideOverOpen(false)}
        onSaved={() => {
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
  if (!badge) return <span className="text-text3">-</span>
  const s: Record<LeadBadge, string> = {
    hot:  'bg-red/10 text-red',
    warm: 'bg-amber/10 text-amber',
    cold: 'bg-border/50 text-text2',
  }
  return (
    <span
      className={`text-xs px-2 py-0.5 font-semibold uppercase rounded-[3px] tracking-widest font-mono ${s[badge]}`}
    >
      {badge}
    </span>
  )
}

const LEAD_STATUS_CLASS: Record<LeadStatus, string> = {
  new:       'bg-blue/10 text-blue',
  contacted: 'bg-blue/20 text-blue',
  qualified: 'bg-green/10 text-green',
  converted: 'bg-green/20 text-green',
  lost:      'bg-red/10 text-red',
}

function LeadStatusChip({ status }: { status: LeadStatus }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 font-medium capitalize rounded-sm font-sans ${LEAD_STATUS_CLASS[status]}`}
    >
      {status}
    </span>
  )
}

// ── Lead Detail Slide-over ────────────────────────────────────────────────────

function LeadDetailSlideOver({
  lead, onClose, onUpdated, users,
}: {
  lead: Lead | null
  onClose: () => void
  onUpdated: () => void
  users: User[]
}) {
  const [convertOpen, setConvertOpen]   = useState(false)
  const [convertForm, setConvertForm]   = useState({ deal_name: '', value: '', service_type: '' })
  const [converting, setConverting]     = useState(false)
  const [convertError, setConvertError] = useState('')
  const [convertDone, setConvertDone]   = useState(false)

  const [editing, setEditing]     = useState(false)
  const [editForm, setEditForm]   = useState({
    name: '', org_name: '', email: '', phone: '', source: '', badge: '', notes: '', owner_id: '',
  })
  const [saving, setSaving]       = useState(false)
  const [editError, setEditError] = useState('')

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [deleteError, setDeleteError]     = useState('')

  useEffect(() => {
    if (lead) {
      setConvertOpen(false)
      setConvertForm({ deal_name: `${lead.org_name || lead.name} Deal`, value: '', service_type: '' })
      setConvertError('')
      setConvertDone(false)
      setEditing(false)
      setEditForm({
        name: lead.name, org_name: lead.org_name || '', email: lead.email || '', phone: lead.phone || '',
        source: lead.source || '', badge: lead.badge || '', notes: lead.notes || '', owner_id: lead.owner_id || '',
      })
      setEditError('')
      setConfirmDelete(false)
      setDeleteError('')
    }
  }, [lead])

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!lead) return
    if (!editForm.name.trim()) { setEditError('Name is required'); return }
    setSaving(true); setEditError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:      editForm.name.trim(),
          org_name:  editForm.org_name.trim() || null,
          email:     editForm.email.trim() || null,
          phone:     editForm.phone.trim() || null,
          source:    editForm.source || null,
          badge:     editForm.badge || null,
          notes:     editForm.notes.trim() || null,
          owner_id:  editForm.owner_id || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); setEditError(d.error || 'Failed to save changes'); return }
      setEditing(false)
      onUpdated()
      onClose()
    } catch { setEditError('Network error')
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!lead) return
    setDeleting(true); setDeleteError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) { const d = await res.json(); setDeleteError(d.error || 'Failed to delete lead'); return }
      onUpdated()
      onClose()
    } catch { setDeleteError('Network error')
    } finally { setDeleting(false) }
  }

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
    ['Organisation', lead.org_name || '-'],
    ['Email',        lead.email || '-'],
    ['Phone',        lead.phone || '-'],
    ['Source',       lead.source ? lead.source.charAt(0).toUpperCase() + lead.source.slice(1) : '-'],
    ['Score',        lead.score != null ? String(lead.score) : '-'],
    ['Owner',        lead.owner_name || 'Unassigned'],
    ['Last Contact', lead.last_contact_at ? fmtDate(lead.last_contact_at) : '-'],
    ['Created',      fmtDate(lead.created_at)],
  ]

  const inputClass = "h-9 border border-border bg-card text-text1 rounded-sm outline-none px-3 text-sm w-full font-sans focus:border-blue transition-colors"
  const labelClass = "block text-xs font-medium mb-1 text-text2 font-sans"

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/35" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col w-[520px] bg-bg shadow-[-4px_0_24px_rgba(0,0,0,0.14)]">
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 border-b border-border bg-card">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-semibold truncate font-sans text-text1">
              {lead.name}
            </h2>
            <BadgeChip badge={lead.badge} />
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {!editing && !confirmDelete && (
              <>
                <button onClick={() => setEditing(true)} className="text-xs font-medium text-blue hover:underline font-sans">Edit</button>
                <button onClick={() => setConfirmDelete(true)} className="text-xs font-medium text-red hover:underline font-sans">Delete</button>
              </>
            )}
            <button onClick={onClose} className="text-text2 hover:text-text1 transition-colors"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-5">
          {confirmDelete && (
            <div className="border border-red/40 bg-red/10 rounded-sm p-4 flex flex-col gap-3">
              <p className="text-sm text-text1 font-sans">Delete this lead? This cannot be undone.</p>
              {deleteError && <p className="text-xs text-red font-sans">{deleteError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-sm px-4 py-2 font-medium rounded-sm disabled:opacity-50 bg-red text-white hover:bg-red/90 transition-colors font-sans"
                >
                  {deleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmDelete(false); setDeleteError('') }}
                  className="text-sm px-4 py-2 rounded-sm bg-bg text-text2 border border-border hover:bg-border transition-colors font-sans"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div><LeadStatusChip status={isConverted ? 'converted' : lead.status} /></div>

          {editing ? (
            <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
              <div>
                <label className={labelClass}>Name *</label>
                <input type="text" value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Organisation</label>
                <input type="text" value={editForm.org_name} onChange={(e) => setEditForm(f => ({ ...f, org_name: e.target.value }))} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Email</label>
                  <input type="email" value={editForm.email} onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Phone</label>
                  <input type="tel" value={editForm.phone} onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))} className={inputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Source</label>
                  <select value={editForm.source} onChange={(e) => setEditForm(f => ({ ...f, source: e.target.value }))} className={inputClass}>
                    <option value="">- None -</option>
                    <option value="inbound">Inbound</option>
                    <option value="outbound">Outbound</option>
                    <option value="referral">Referral</option>
                    <option value="event">Event</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Score</label>
                  <select value={editForm.badge} onChange={(e) => setEditForm(f => ({ ...f, badge: e.target.value }))} className={inputClass}>
                    <option value="">- None -</option>
                    <option value="hot">Hot</option>
                    <option value="warm">Warm</option>
                    <option value="cold">Cold</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Owner</label>
                <select value={editForm.owner_id} onChange={(e) => setEditForm(f => ({ ...f, owner_id: e.target.value }))} className={inputClass}>
                  <option value="">- Unassigned -</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full border border-border bg-card text-text1 rounded-sm px-3 py-2 text-sm font-sans focus:outline-none focus:border-blue transition-colors h-auto resize-y"
                />
              </div>
              {editError && <p className="text-xs text-red font-sans">{editError}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 text-sm py-2 font-medium rounded-sm disabled:opacity-50 bg-blue text-white hover:bg-blue/90 transition-colors font-sans"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setEditError('') }}
                  className="text-sm px-4 py-2 rounded-sm bg-bg text-text2 border border-border hover:bg-border transition-colors font-sans"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {detailRows.map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs font-medium uppercase mb-0.5 text-text3 tracking-widest font-sans">{label}</p>
                    <p className={`text-sm text-text1 ${['Score', 'Last Contact', 'Created'].includes(label) ? 'font-mono' : 'font-sans'}`}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              {lead.notes && (
                <div>
                  <p className="text-xs font-medium uppercase mb-1 text-text3 tracking-widest font-sans">Notes</p>
                  <p className="text-sm whitespace-pre-wrap text-text2 font-sans leading-relaxed">{lead.notes}</p>
                </div>
              )}
            </>
          )}

          {/* Convert to Deal section */}
          <div className={`border border-border rounded-sm p-4 ${isConverted ? 'bg-green/10' : 'bg-card'}`}>
            {isConverted ? (
              <p className="text-sm font-medium flex items-center gap-1.5 text-green font-sans"><CheckCircle2 size={14} /> Converted to deal</p>
            ) : convertOpen ? (
              <form onSubmit={handleConvert} className="flex flex-col gap-3">
                <p className="text-sm font-semibold text-text1 font-sans">Convert to Deal</p>
                <div>
                  <label className={labelClass}>Deal Name</label>
                  <input
                    type="text"
                    value={convertForm.deal_name}
                    onChange={(e) => setConvertForm(f => ({ ...f, deal_name: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Value (₹, optional)</label>
                    <input
                      type="number"
                      value={convertForm.value}
                      onChange={(e) => setConvertForm(f => ({ ...f, value: e.target.value }))}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className="h-9 border border-border bg-card text-text1 rounded-sm outline-none px-3 text-sm w-full font-mono focus:border-blue transition-colors"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Service Type</label>
                    <select
                      value={convertForm.service_type}
                      onChange={(e) => setConvertForm(f => ({ ...f, service_type: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="">- Select -</option>
                      {Object.entries(SERVICE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {convertError && <p className="text-xs text-red font-sans">{convertError}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={converting}
                    className="flex-1 text-sm py-2 font-medium rounded-sm disabled:opacity-50 bg-green text-white hover:bg-green/90 transition-colors font-sans"
                  >
                    {converting ? 'Converting…' : 'Confirm Convert'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConvertOpen(false)}
                    className="text-sm px-4 py-2 rounded-sm bg-bg text-text2 border border-border hover:bg-border transition-colors font-sans"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setConvertOpen(true)}
                className="text-sm px-4 py-2 font-medium border border-blue rounded-sm text-blue bg-card hover:bg-blue/10 transition-colors inline-flex items-center gap-1.5 font-sans"
              >
                Convert to Deal <ArrowRight size={14} />
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

  const inputClass = "h-9 border border-border bg-card text-text1 rounded-sm outline-none px-3 text-sm w-full font-sans focus:border-blue transition-colors"
  const labelClass = "block text-xs font-medium mb-1 text-text2 font-sans"

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/35" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col w-[480px] bg-bg shadow-[-4px_0_24px_rgba(0,0,0,0.14)]">
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 border-b border-border bg-card">
          <h2 className="text-base font-semibold font-sans text-text1">Add Lead</h2>
          <button onClick={onClose} className="text-text2 hover:text-text1 transition-colors"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label className={labelClass}>Company *</label>
              <select value={form.company_id} onChange={(e) => setForm(f => ({ ...f, company_id: e.target.value }))} className={inputClass}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Contact name" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Organisation</label>
              <input type="text" value={form.org_name} onChange={(e) => setForm(f => ({ ...f, org_name: e.target.value }))} placeholder="Company / org name" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 …" className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Source</label>
                <select value={form.source} onChange={(e) => setForm(f => ({ ...f, source: e.target.value }))} className={inputClass}>
                  <option value="">- None -</option>
                  <option value="inbound">Inbound</option>
                  <option value="outbound">Outbound</option>
                  <option value="referral">Referral</option>
                  <option value="event">Event</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Score</label>
                <select value={form.badge} onChange={(e) => setForm(f => ({ ...f, badge: e.target.value }))} className={inputClass}>
                  <option value="">- None -</option>
                  <option value="hot">Hot</option>
                  <option value="warm">Warm</option>
                  <option value="cold">Cold</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Owner</label>
              <select value={form.owner_id} onChange={(e) => setForm(f => ({ ...f, owner_id: e.target.value }))} className={inputClass}>
                <option value="">- Assign to me -</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                placeholder="Initial notes…"
                className="w-full border border-border bg-card text-text1 rounded-sm px-3 py-2 text-sm font-sans focus:outline-none focus:border-blue transition-colors h-auto resize-y"
              />
            </div>
            {error && <p className="text-xs text-red font-sans">{error}</p>}
          </div>

          <div className="px-6 py-4 flex gap-3 flex-shrink-0 border-t border-border bg-card">
            <button
              type="submit" disabled={saving}
              className="flex-1 text-sm py-2 font-medium rounded-sm disabled:opacity-50 bg-blue text-white hover:bg-blue/90 transition-colors font-sans"
            >
              {saving ? 'Saving…' : 'Add Lead'}
            </button>
            <button
              type="button" onClick={onClose}
              className="text-sm px-4 py-2 rounded-sm bg-bg text-text2 border border-border hover:bg-border transition-colors font-sans"
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
    <div className="flex flex-col h-full bg-bg">
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 bg-card border-b border-border">
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Filter leads…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 w-[220px] border border-border bg-card text-text1 rounded-sm px-3 text-sm font-sans focus:outline-none focus:border-blue transition-colors"
          />
          {!isLoading && !isError && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-text2 font-sans">
                <span className="font-mono font-semibold text-text1">{openCount}</span>
                {' '}open
              </span>
              {hotCount > 0 && (
                <span className="text-sm text-text2 font-sans">
                  <span className="font-mono font-semibold text-red">{hotCount}</span>
                  {' '}hot
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="text-sm px-4 py-2 font-medium rounded-sm bg-blue text-white hover:bg-blue/90 transition-colors font-sans"
        >
          + Add Lead
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[1,2,3,4].map(i => <div key={i} className="h-10 rounded-sm bg-border animate-pulse" />)}
          </div>
        ) : isError ? (
          <p className="text-sm text-red font-sans">Failed to load leads</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-sm h-[200px] bg-card border border-border">
            <p className="text-sm text-text3 font-sans">No leads found{filter ? ' matching that filter' : ''}.</p>
          </div>
        ) : (
          <div className="bg-card rounded-sm border border-border overflow-hidden">
            <table className="w-full text-sm border-collapse font-sans text-[0.8125rem]">
              <thead>
                <tr className="bg-bg border-b border-border">
                  {['Lead', 'Org', 'Source', 'Score', 'Status', 'Last Contact', 'Owner'].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-semibold text-xs text-text2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead, idx) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className={`bg-card cursor-pointer hover:bg-bg transition-colors ${idx < filtered.length - 1 ? 'border-b border-border' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium text-text1">{lead.name}</td>
                    <td className="px-4 py-3 text-text2">{lead.org_name || '-'}</td>
                    <td className="px-4 py-3 capitalize text-text3">{lead.source || '-'}</td>
                    <td className="px-4 py-3"><BadgeChip badge={lead.badge} /></td>
                    <td className="px-4 py-3"><LeadStatusChip status={lead.status} /></td>
                    <td className="px-4 py-3 font-mono text-text2 text-[0.8rem]">
                      {lead.last_contact_at ? fmtDate(lead.last_contact_at) : '-'}
                    </td>
                    <td className="px-4 py-3 text-text2">{lead.owner_name || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        users={usersData?.users || []}
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

  const inputClass = "h-9 border border-border bg-card text-text1 rounded-sm outline-none px-3 text-sm w-full font-sans focus:border-blue transition-colors"
  const labelClass = "block text-xs font-medium mb-1 text-text2 font-sans"

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/35" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col w-[480px] bg-bg shadow-[-4px_0_24px_rgba(0,0,0,0.14)]">
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 border-b border-border bg-card">
          <h2 className="text-base font-semibold font-sans text-text1">Add Client</h2>
          <button onClick={onClose} className="text-text2 hover:text-text1 transition-colors"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label className={labelClass}>Company *</label>
              <select value={form.company_id} onChange={(e) => setForm(f => ({ ...f, company_id: e.target.value }))} className={inputClass}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Contact name" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Organisation</label>
              <input type="text" value={form.org_name} onChange={(e) => setForm(f => ({ ...f, org_name: e.target.value }))} placeholder="Company / org name" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 …" className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Address</label>
              <textarea
                value={form.address}
                onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                rows={2}
                placeholder="Street, city, state, PIN"
                className="w-full border border-border bg-card text-text1 rounded-sm px-3 py-2 text-sm font-sans focus:outline-none focus:border-blue transition-colors h-auto resize-y"
              />
            </div>
            <div>
              <label className={labelClass}>GSTIN</label>
              <input
                type="text"
                value={form.gstin}
                onChange={(e) => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                placeholder="22AAAAA0000A1Z5"
                className="h-9 border border-border bg-card text-text1 rounded-sm outline-none px-3 text-sm w-full font-mono focus:border-blue transition-colors uppercase"
              />
            </div>
            {error && <p className="text-xs text-red font-sans">{error}</p>}
          </div>

          <div className="px-6 py-4 flex gap-3 flex-shrink-0 border-t border-border bg-card">
            <button
              type="submit" disabled={saving}
              className="flex-1 text-sm py-2 font-medium rounded-sm disabled:opacity-50 bg-blue text-white hover:bg-blue/90 transition-colors font-sans"
            >
              {saving ? 'Saving…' : 'Add Client'}
            </button>
            <button
              type="button" onClick={onClose}
              className="text-sm px-4 py-2 rounded-sm bg-bg text-text2 border border-border hover:bg-border transition-colors font-sans"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Client Detail Slide-over ──────────────────────────────────────────────────

function ClientDetailSlideOver({
  client, onClose, onUpdated,
}: {
  client: ClientFull | null
  onClose: () => void
  onUpdated: () => void
}) {
  const [editing, setEditing]     = useState(false)
  const [editForm, setEditForm]   = useState({ name: '', org_name: '', email: '', phone: '', address: '', gstin: '' })
  const [saving, setSaving]       = useState(false)
  const [editError, setEditError] = useState('')

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [deleteError, setDeleteError]     = useState('')

  useEffect(() => {
    if (client) {
      setEditing(false)
      setEditForm({
        name: client.name, org_name: client.org_name || '', email: client.email || '',
        phone: client.phone || '', address: client.address || '', gstin: client.gstin || '',
      })
      setEditError('')
      setConfirmDelete(false)
      setDeleteError('')
    }
  }, [client])

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!client) return
    if (!editForm.name.trim()) { setEditError('Name is required'); return }
    setSaving(true); setEditError('')
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:     editForm.name.trim(),
          org_name: editForm.org_name.trim() || null,
          email:    editForm.email.trim() || null,
          phone:    editForm.phone.trim() || null,
          address:  editForm.address.trim() || null,
          gstin:    editForm.gstin.trim() || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); setEditError(d.error || 'Failed to save changes'); return }
      setEditing(false)
      onUpdated()
      onClose()
    } catch { setEditError('Network error')
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!client) return
    setDeleting(true); setDeleteError('')
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) { const d = await res.json(); setDeleteError(d.error || 'Failed to delete client'); return }
      onUpdated()
      onClose()
    } catch { setDeleteError('Network error')
    } finally { setDeleting(false) }
  }

  if (!client) return null

  const detailRows: [string, string][] = [
    ['Company',      client.company_name],
    ['Organisation', client.org_name || '-'],
    ['Email',        client.email || '-'],
    ['Phone',        client.phone || '-'],
    ['Address',      client.address || '-'],
    ['GSTIN',        client.gstin || '-'],
    ['Deals',        String(client.deals_count)],
    ['Total Billed', formatINR(client.total_billed)],
    ['Created',      fmtDate(client.created_at)],
  ]

  const inputClass = "h-9 border border-border bg-card text-text1 rounded-sm outline-none px-3 text-sm w-full font-sans focus:border-blue transition-colors"
  const labelClass = "block text-xs font-medium mb-1 text-text2 font-sans"

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/35" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col w-[520px] bg-bg shadow-[-4px_0_24px_rgba(0,0,0,0.14)]">
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 border-b border-border bg-card">
          <h2 className="text-base font-semibold truncate font-sans text-text1">{client.name}</h2>
          <div className="flex items-center gap-3 flex-shrink-0">
            {!editing && !confirmDelete && (
              <>
                <button onClick={() => setEditing(true)} className="text-xs font-medium text-blue hover:underline font-sans">Edit</button>
                <button onClick={() => setConfirmDelete(true)} className="text-xs font-medium text-red hover:underline font-sans">Delete</button>
              </>
            )}
            <button onClick={onClose} className="text-text2 hover:text-text1 transition-colors"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-5">
          {confirmDelete && (
            <div className="border border-red/40 bg-red/10 rounded-sm p-4 flex flex-col gap-3">
              <p className="text-sm text-text1 font-sans">Delete this client? This cannot be undone.</p>
              {deleteError && <p className="text-xs text-red font-sans">{deleteError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-sm px-4 py-2 font-medium rounded-sm disabled:opacity-50 bg-red text-white hover:bg-red/90 transition-colors font-sans"
                >
                  {deleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmDelete(false); setDeleteError('') }}
                  className="text-sm px-4 py-2 rounded-sm bg-bg text-text2 border border-border hover:bg-border transition-colors font-sans"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {editing ? (
            <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
              <div>
                <label className={labelClass}>Name *</label>
                <input type="text" value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Organisation</label>
                <input type="text" value={editForm.org_name} onChange={(e) => setEditForm(f => ({ ...f, org_name: e.target.value }))} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Email</label>
                  <input type="email" value={editForm.email} onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Phone</label>
                  <input type="tel" value={editForm.phone} onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))} className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Address</label>
                <textarea
                  value={editForm.address}
                  onChange={(e) => setEditForm(f => ({ ...f, address: e.target.value }))}
                  rows={2}
                  className="w-full border border-border bg-card text-text1 rounded-sm px-3 py-2 text-sm font-sans focus:outline-none focus:border-blue transition-colors h-auto resize-y"
                />
              </div>
              <div>
                <label className={labelClass}>GSTIN</label>
                <input
                  type="text"
                  value={editForm.gstin}
                  onChange={(e) => setEditForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                  className="h-9 border border-border bg-card text-text1 rounded-sm outline-none px-3 text-sm w-full font-mono focus:border-blue transition-colors uppercase"
                />
              </div>
              {editError && <p className="text-xs text-red font-sans">{editError}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 text-sm py-2 font-medium rounded-sm disabled:opacity-50 bg-blue text-white hover:bg-blue/90 transition-colors font-sans"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setEditError('') }}
                  className="text-sm px-4 py-2 rounded-sm bg-bg text-text2 border border-border hover:bg-border transition-colors font-sans"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {detailRows.map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs font-medium uppercase mb-0.5 text-text3 tracking-widest font-sans">{label}</p>
                  <p className={`text-sm text-text1 ${['Deals', 'Total Billed', 'Created'].includes(label) ? 'font-mono' : 'font-sans'}`}>
                    {value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Clients Tab ───────────────────────────────────────────────────────────────

function ClientsTab() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [selectedClient, setSelectedClient] = useState<ClientFull | null>(null)

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
    <div className="flex flex-col h-full bg-bg">
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 bg-card border-b border-border">
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Filter clients…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 w-[220px] border border-border bg-card text-text1 rounded-sm px-3 text-sm font-sans focus:outline-none focus:border-blue transition-colors"
          />
          {!isLoading && !isError && (
            <span className="text-sm text-text2 font-sans">
              <span className="font-mono font-semibold text-text1">{clients.length}</span>
              {' '}client{clients.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="text-sm px-4 py-2 font-medium rounded-sm bg-blue text-white hover:bg-blue/90 transition-colors font-sans"
        >
          + Add Client
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[1,2,3,4].map(i => <div key={i} className="h-10 rounded-sm bg-border animate-pulse" />)}
          </div>
        ) : isError ? (
          <p className="text-sm text-red font-sans">Failed to load clients</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-sm h-[200px] bg-card border border-border">
            <p className="text-sm text-text3 font-sans">No clients yet{filter ? ' matching that filter' : ''}.</p>
          </div>
        ) : (
          <div className="bg-card rounded-sm border border-border overflow-hidden">
            <table className="w-full text-sm border-collapse font-sans text-[0.8125rem]">
              <thead>
                <tr className="bg-bg border-b border-border">
                  {['Client', 'Organisation', 'Email', 'Deals', 'Total Billed', 'Last Active'].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-semibold text-xs text-text2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedClient(c)}
                    className={`bg-card cursor-pointer hover:bg-bg transition-colors ${idx < filtered.length - 1 ? 'border-b border-border' : ''}`}
                  >
                    <td className="px-4 py-3 text-text1">
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-1.5 text-xs text-text3">{c.company_name}</span>
                    </td>
                    <td className="px-4 py-3 text-text2">{c.org_name || '-'}</td>
                    <td className="px-4 py-3 text-text2">{c.email || '-'}</td>
                    <td className="px-4 py-3 font-mono text-text1">
                      {String(c.deals_count)}
                    </td>
                    <td className="px-4 py-3 font-mono text-text1">
                      {formatINR(c.total_billed)}
                    </td>
                    <td className="px-4 py-3 font-mono text-text2 text-[0.8rem]">
                      {c.last_active ? fmtDate(c.last_active) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ClientDetailSlideOver
        client={selectedClient}
        onClose={() => setSelectedClient(null)}
        onUpdated={() => qc.invalidateQueries({ queryKey: ['clients'] })}
      />

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
        {label} - coming in Slice {slice}
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
    <div className="flex flex-col h-full bg-bg">
      {/* Page header + tab bar */}
      <div className="px-6 pt-6 flex-shrink-0 border-b border-border bg-card">
        <h1 className="text-xl font-semibold mb-4 font-sans text-text1">
          Sales
        </h1>

        <div className="flex gap-6">
          {TABS.map((t) => {
            const active = activeTab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`text-sm pb-3 font-medium transition-colors font-sans relative ${active ? 'text-blue' : 'text-text2 hover:text-text1'}`}
              >
                {t.label}
                {active && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'pipeline' && <PipelineTab />}
        {activeTab === 'invoices' && <InvoicesTab />}
        {activeTab === 'leads'    && <LeadsTab />}
        {activeTab === 'clients'  && <ClientsTab />}
      </div>
    </div>
  )
}
