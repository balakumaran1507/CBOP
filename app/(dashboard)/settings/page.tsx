'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

type Role = 'ceo' | 'coo' | 'cto'
type SettingsTab = 'team' | 'companies' | 'jobs' | 'integrations'
type JobStatus = 'pending' | 'running' | 'done' | 'failed'

interface SessionUser {
  userId: string
  name: string
  role: Role
  companyIds: string[]
  companies: { id: string; name: string; invoice_prefix: string }[]
}

interface SettingsUser {
  id: string
  name: string
  email: string
  role: Role
  telegram_chat_id: string | null
  whatsapp_number: string | null
  is_active: boolean
  created_at: string
  company_ids: string[] | null
  company_names: string[] | null
}

interface SettingsCompany {
  id: string
  name: string
  type: string | null
  gstin: string | null
  upi_id: string | null
  bank_details: Record<string, string> | null
  invoice_prefix: string | null
}

interface SystemJob {
  id: string
  name: string
  type: 'automation' | 'agent'
  status: JobStatus
  started_at: string | null
  completed_at: string | null
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error_message: string | null
  retry_count: number
  created_at: string
}

interface IntegrationItem {
  key: string
  label: string
  value: string
  sensitive: boolean
}

interface IntegrationGroup {
  group: string
  items: IntegrationItem[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

const ROLE_LABELS: Record<Role, string> = { ceo: 'CEO', coo: 'COO', cto: 'CTO' }
const ROLE_COLORS: Record<Role, string> = {
  ceo: '#0073BB',
  coo: '#1D8102',
  cto: '#687078',
}

const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  pending: '#687078',
  running: '#E8820C',
  done:    '#1D8102',
  failed:  '#D13212',
}

// ── Slide-over shell ──────────────────────────────────────────────────────────

function SlideOver({
  open, onClose, title, children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
      <div
        ref={overlayRef}
        className="absolute inset-0"
        onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
      />
      <div
        className="relative flex flex-col"
        style={{
          width: '480px', height: '100%', backgroundColor: '#fff',
          borderLeft: '1px solid #D5DBDB', overflowY: 'auto',
        }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #D5DBDB' }}
        >
          <h2 style={{ fontFamily: 'var(--font-syne),sans-serif', fontSize: '1rem', fontWeight: 600, color: 'var(--text1)' }}>
            {title}
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.25rem', lineHeight: 1 }}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block mb-1 text-xs font-medium" style={{ color: 'var(--text2)' }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: '36px', padding: '0 10px',
  border: '1px solid #D5DBDB', borderRadius: '6px',
  fontSize: '0.875rem', color: 'var(--text1)', backgroundColor: '#fff',
  outline: 'none', boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = { ...inputStyle }

// ── Team Tab ──────────────────────────────────────────────────────────────────

function TeamTab({ userRole }: { userRole: Role }) {
  const qc = useQueryClient()
  const [soOpen, setSoOpen] = useState(false)
  const [editUser, setEditUser] = useState<SettingsUser | null>(null)

  const { data, isLoading } = useQuery<{ users: SettingsUser[] }>({
    queryKey: ['settings-users'],
    queryFn: () => fetch('/api/settings/users', { credentials: 'include' }).then((r) => r.json()),
  })

  const { data: companiesData } = useQuery<{ companies: { id: string; name: string }[] }>({
    queryKey: ['settings-companies'],
    queryFn: () => fetch('/api/settings/companies', { credentials: 'include' }).then((r) => r.json()),
    enabled: userRole === 'ceo',
  })

  const allCompanies = companiesData?.companies ?? []
  const users = data?.users ?? []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          {userRole === 'coo' ? 'Team members — read only' : `${users.length} team members`}
        </p>
        {userRole === 'ceo' && (
          <button
            onClick={() => setSoOpen(true)}
            className="text-sm px-3 py-1.5 rounded text-white"
            style={{ backgroundColor: 'var(--blue)' }}
          >
            + New User
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />
          ))}
        </div>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: '1px solid #D5DBDB' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#F8F9FA', borderBottom: '1px solid #D5DBDB' }}>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Name</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Role</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Email</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Telegram ID</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Companies</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr
                  key={u.id}
                  style={{ borderBottom: i < users.length - 1 ? '1px solid #D5DBDB' : undefined, cursor: userRole === 'ceo' ? 'pointer' : 'default' }}
                  className="hover:bg-gray-50 transition-colors"
                  onClick={() => { if (userRole === 'ceo') setEditUser(u) }}
                >
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text1)' }}>{u.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded"
                      style={{ backgroundColor: ROLE_COLORS[u.role] + '18', color: ROLE_COLORS[u.role] }}
                    >
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>{u.email}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {u.telegram_chat_id || '—'}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontSize: '0.8rem' }}>
                    {(u.company_names ?? []).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: u.is_active ? '#1D810218' : '#D1321218',
                        color: u.is_active ? '#1D8102' : '#D13212',
                      }}
                    >
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New User slide-over */}
      <CreateUserSlideOver
        open={soOpen}
        onClose={() => setSoOpen(false)}
        companies={allCompanies}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['settings-users'] }); setSoOpen(false) }}
      />

      {/* Edit User slide-over */}
      <EditUserSlideOver
        user={editUser}
        companies={allCompanies}
        onClose={() => setEditUser(null)}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['settings-users'] }); setEditUser(null) }}
      />
    </div>
  )
}

// ── Create User Slide-over ────────────────────────────────────────────────────

function CreateUserSlideOver({
  open, onClose, companies, onSuccess,
}: {
  open: boolean
  onClose: () => void
  companies: { id: string; name: string }[]
  onSuccess: () => void
}) {
  const [form, setForm] = useState({
    name: '', email: '', role: 'coo' as Role, password: '',
    telegram_chat_id: '', whatsapp_number: '', company_ids: [] as string[],
  })
  const [err, setErr] = useState('')

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      fetch('/api/settings/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }
        return r.json()
      }),
    onSuccess,
    onError: (e: Error) => setErr(e.message),
  })

  function toggleCompany(id: string) {
    setForm((f) => ({
      ...f,
      company_ids: f.company_ids.includes(id)
        ? f.company_ids.filter((c) => c !== id)
        : [...f.company_ids, id],
    }))
  }

  function reset() {
    setForm({ name: '', email: '', role: 'coo', password: '', telegram_chat_id: '', whatsapp_number: '', company_ids: [] })
    setErr('')
  }

  return (
    <SlideOver open={open} onClose={() => { reset(); onClose() }} title="New User">
      {err && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#D1321218', color: '#D13212' }}>{err}</div>
      )}

      <Field label="Full name *">
        <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Balakumaran" />
      </Field>
      <Field label="Email *">
        <input style={inputStyle} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@etherence.com" />
      </Field>
      <Field label="Role *">
        <select style={selectStyle} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          <option value="ceo">CEO</option>
          <option value="coo">COO</option>
          <option value="cto">CTO</option>
        </select>
      </Field>
      <Field label="Initial password *">
        <input style={inputStyle} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min. 8 characters" />
      </Field>
      <Field label="Telegram Chat ID">
        <input style={inputStyle} value={form.telegram_chat_id} onChange={(e) => setForm({ ...form, telegram_chat_id: e.target.value })} placeholder="123456789" />
      </Field>
      <Field label="WhatsApp number">
        <input style={inputStyle} value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} placeholder="+91 9876543210" />
      </Field>

      <Field label="Companies *">
        <div className="space-y-2 mt-1">
          {companies.map((co) => (
            <label key={co.id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text1)' }}>
              <input
                type="checkbox"
                checked={form.company_ids.includes(co.id)}
                onChange={() => toggleCompany(co.id)}
              />
              {co.name}
            </label>
          ))}
        </div>
      </Field>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending}
          className="flex-1 py-2 rounded text-sm text-white"
          style={{ backgroundColor: 'var(--blue)', opacity: mutation.isPending ? 0.6 : 1 }}
        >
          {mutation.isPending ? 'Creating…' : 'Create User'}
        </button>
        <button onClick={() => { reset(); onClose() }} className="px-4 py-2 rounded text-sm" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>
          Cancel
        </button>
      </div>
    </SlideOver>
  )
}

// ── Edit User Slide-over ──────────────────────────────────────────────────────

function EditUserSlideOver({
  user, companies, onClose, onSuccess,
}: {
  user: SettingsUser | null
  companies: { id: string; name: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [form, setForm] = useState({ name: '', role: 'coo' as Role, telegram_chat_id: '', whatsapp_number: '', company_ids: [] as string[] })
  const [err, setErr] = useState('')

  useEffect(() => {
    if (user) {
      setForm({
        name: user.name,
        role: user.role,
        telegram_chat_id: user.telegram_chat_id ?? '',
        whatsapp_number: user.whatsapp_number ?? '',
        company_ids: user.company_ids ?? [],
      })
      setErr('')
    }
  }, [user])

  const mutation = useMutation({
    mutationFn: (data: { name: string; role: Role; telegram_chat_id: string; whatsapp_number: string; company_ids: string[] }) =>
      fetch(`/api/settings/users/${user!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...data,
          telegram_chat_id: data.telegram_chat_id || null,
          whatsapp_number: data.whatsapp_number || null,
        }),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }
        return r.json()
      }),
    onSuccess,
    onError: (e: Error) => setErr(e.message),
  })

  const deactivateMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/settings/users/${user!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_active: !user!.is_active }),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }
        return r.json()
      }),
    onSuccess,
    onError: (e: Error) => setErr(e.message),
  })

  function toggleCompany(id: string) {
    setForm((f) => ({
      ...f,
      company_ids: f.company_ids.includes(id)
        ? f.company_ids.filter((c) => c !== id)
        : [...f.company_ids, id],
    }))
  }

  if (!user) return null

  return (
    <SlideOver open={!!user} onClose={onClose} title={`Edit — ${user.name}`}>
      {err && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#D1321218', color: '#D13212' }}>{err}</div>
      )}

      <Field label="Full name">
        <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Role">
        <select style={selectStyle} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          <option value="ceo">CEO</option>
          <option value="coo">COO</option>
          <option value="cto">CTO</option>
        </select>
      </Field>
      <Field label="Telegram Chat ID">
        <input style={inputStyle} value={form.telegram_chat_id} onChange={(e) => setForm({ ...form, telegram_chat_id: e.target.value })} placeholder="123456789" />
      </Field>
      <Field label="WhatsApp number">
        <input style={inputStyle} value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} placeholder="+91 9876543210" />
      </Field>

      <Field label="Companies">
        <div className="space-y-2 mt-1">
          {companies.map((co) => (
            <label key={co.id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text1)' }}>
              <input
                type="checkbox"
                checked={form.company_ids.includes(co.id)}
                onChange={() => toggleCompany(co.id)}
              />
              {co.name}
            </label>
          ))}
        </div>
      </Field>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending}
          className="flex-1 py-2 rounded text-sm text-white"
          style={{ backgroundColor: 'var(--blue)', opacity: mutation.isPending ? 0.6 : 1 }}
        >
          {mutation.isPending ? 'Saving…' : 'Save Changes'}
        </button>
        <button onClick={onClose} className="px-4 py-2 rounded text-sm" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>
          Cancel
        </button>
      </div>

      <div className="mt-6 pt-4" style={{ borderTop: '1px solid #D5DBDB' }}>
        <p className="text-xs mb-2" style={{ color: 'var(--text2)' }}>
          {user.is_active ? 'Deactivating prevents login but preserves all data.' : 'Reactivate to allow this user to log in again.'}
        </p>
        <button
          onClick={() => deactivateMutation.mutate()}
          disabled={deactivateMutation.isPending}
          className="text-sm px-3 py-1.5 rounded"
          style={{
            border: `1px solid ${user.is_active ? '#D13212' : '#1D8102'}`,
            color: user.is_active ? '#D13212' : '#1D8102',
            opacity: deactivateMutation.isPending ? 0.6 : 1,
          }}
        >
          {deactivateMutation.isPending ? 'Updating…' : user.is_active ? 'Deactivate user' : 'Reactivate user'}
        </button>
      </div>
    </SlideOver>
  )
}

// ── Companies Tab ─────────────────────────────────────────────────────────────

function CompaniesTab() {
  const qc = useQueryClient()
  const [editCompany, setEditCompany] = useState<SettingsCompany | null>(null)

  const { data, isLoading } = useQuery<{ companies: SettingsCompany[] }>({
    queryKey: ['settings-companies'],
    queryFn: () => fetch('/api/settings/companies', { credentials: 'include' }).then((r) => r.json()),
  })

  const companies = data?.companies ?? []

  return (
    <div>
      <p className="text-sm mb-4" style={{ color: 'var(--text2)' }}>
        Click a company to edit its details. GSTIN and UPI ID are used on invoices.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-12 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />)}
        </div>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: '1px solid #D5DBDB' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#F8F9FA', borderBottom: '1px solid #D5DBDB' }}>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Name</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Type</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Invoice prefix</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>GSTIN</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>UPI ID</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((co, i) => (
                <tr
                  key={co.id}
                  onClick={() => setEditCompany(co)}
                  className="hover:bg-gray-50 transition-colors"
                  style={{ borderBottom: i < companies.length - 1 ? '1px solid #D5DBDB' : undefined, cursor: 'pointer' }}
                >
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text1)' }}>{co.name}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{co.type ?? '—'}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {co.invoice_prefix ?? '—'}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {co.gstin || '—'}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {co.upi_id || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EditCompanySlideOver
        company={editCompany}
        onClose={() => setEditCompany(null)}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['settings-companies'] })
          setEditCompany(null)
        }}
      />
    </div>
  )
}

// ── Edit Company Slide-over ───────────────────────────────────────────────────

function EditCompanySlideOver({
  company, onClose, onSuccess,
}: {
  company: SettingsCompany | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [form, setForm] = useState({ name: '', type: '', gstin: '', upi_id: '', bank_details_raw: '' })
  const [err, setErr] = useState('')

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name,
        type: company.type ?? '',
        gstin: company.gstin ?? '',
        upi_id: company.upi_id ?? '',
        bank_details_raw: company.bank_details ? JSON.stringify(company.bank_details, null, 2) : '',
      })
      setErr('')
    }
  }, [company])

  const mutation = useMutation({
    mutationFn: (data: typeof form) => {
      let bank_details: Record<string, string> | undefined
      if (data.bank_details_raw.trim()) {
        try { bank_details = JSON.parse(data.bank_details_raw) }
        catch { throw new Error('Bank details must be valid JSON') }
      }
      return fetch(`/api/settings/companies/${company!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name || undefined,
          type: data.type || undefined,
          gstin: data.gstin || undefined,
          upi_id: data.upi_id || undefined,
          bank_details,
        }),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }
        return r.json()
      })
    },
    onSuccess,
    onError: (e: Error) => setErr(e.message),
  })

  if (!company) return null

  return (
    <SlideOver open={!!company} onClose={onClose} title={`Edit — ${company.name}`}>
      {err && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#D1321218', color: '#D13212' }}>{err}</div>
      )}

      <Field label="Company name">
        <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Type">
        <select style={selectStyle} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="">— select —</option>
          <option value="it">IT</option>
          <option value="security">Security</option>
          <option value="ctf">CTF</option>
          <option value="gamedev">Game Development</option>
        </select>
      </Field>
      <Field label="GSTIN">
        <input style={inputStyle} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="33XXXXXXXXXXXXX" />
      </Field>
      <Field label="UPI ID">
        <input style={inputStyle} value={form.upi_id} onChange={(e) => setForm({ ...form, upi_id: e.target.value })} placeholder="company@upi" />
      </Field>
      <Field label="Bank details (JSON)">
        <textarea
          value={form.bank_details_raw}
          onChange={(e) => setForm({ ...form, bank_details_raw: e.target.value })}
          placeholder={'{\n  "bank": "HDFC",\n  "account": "XXXX",\n  "ifsc": "HDFC0000001"\n}'}
          rows={5}
          style={{
            ...inputStyle, height: 'auto', padding: '8px 10px',
            fontFamily: 'var(--font-mono)', fontSize: '0.8rem', resize: 'vertical',
          }}
        />
      </Field>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending}
          className="flex-1 py-2 rounded text-sm text-white"
          style={{ backgroundColor: 'var(--blue)', opacity: mutation.isPending ? 0.6 : 1 }}
        >
          {mutation.isPending ? 'Saving…' : 'Save Changes'}
        </button>
        <button onClick={onClose} className="px-4 py-2 rounded text-sm" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>
          Cancel
        </button>
      </div>
    </SlideOver>
  )
}

// ── System Jobs Tab ───────────────────────────────────────────────────────────

function JobsTab() {
  const qc = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading } = useQuery<{ jobs: SystemJob[] }>({
    queryKey: ['settings-jobs'],
    queryFn: () => fetch('/api/settings/jobs', { credentials: 'include' }).then((r) => r.json()),
    refetchInterval: 15000,
  })

  const retryMutation = useMutation({
    mutationFn: (jobId: string) =>
      fetch(`/api/settings/jobs/${jobId}/retry`, {
        method: 'POST',
        credentials: 'include',
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }
        return r.json()
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-jobs'] }),
  })

  const jobs = data?.jobs ?? []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          {jobs.length} job entries — auto-refreshes every 15s
        </p>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['settings-jobs'] })}
          className="text-xs px-2 py-1 rounded"
          style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}
        >
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />)}
        </div>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-center py-12" style={{ color: 'var(--text3)' }}>No jobs recorded yet.</p>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: '1px solid #D5DBDB' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#F8F9FA', borderBottom: '1px solid #D5DBDB' }}>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Name</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Type</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Status</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Started</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Completed</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Retries</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job, i) => (
                <React.Fragment key={job.id}>
                  <tr
                    onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
                    className="hover:bg-gray-50 transition-colors"
                    style={{
                      borderBottom: expandedId === job.id || i < jobs.length - 1 ? '1px solid #D5DBDB' : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text1)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {job.name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{ backgroundColor: job.type === 'agent' ? '#0073BB18' : '#E8820C18', color: job.type === 'agent' ? '#0073BB' : '#E8820C' }}
                      >
                        {job.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded flex items-center gap-1 w-fit"
                        style={{ backgroundColor: JOB_STATUS_COLORS[job.status] + '18', color: JOB_STATUS_COLORS[job.status] }}
                      >
                        {job.status === 'running' && (
                          <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#E8820C', animation: 'pulse 1s infinite' }} />
                        )}
                        {job.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
                      {fmtDateTime(job.started_at)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
                      {fmtDateTime(job.completed_at)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
                      {job.retry_count}
                    </td>
                  </tr>

                  {expandedId === job.id && (
                    <tr style={{ borderBottom: i < jobs.length - 1 ? '1px solid #D5DBDB' : undefined }}>
                      <td colSpan={6} className="px-4 py-4" style={{ backgroundColor: '#F8F9FA' }}>
                        {job.error_message && (
                          <div className="mb-3">
                            <p className="text-xs font-semibold mb-1" style={{ color: '#D13212' }}>Error</p>
                            <pre className="text-xs p-3 rounded" style={{ backgroundColor: '#D1321208', color: '#D13212', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                              {job.error_message}
                            </pre>
                          </div>
                        )}
                        {job.payload && (
                          <div className="mb-3">
                            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text2)' }}>Payload</p>
                            <pre className="text-xs p-3 rounded" style={{ backgroundColor: '#E9EAEB', color: 'var(--text1)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                              {JSON.stringify(job.payload, null, 2)}
                            </pre>
                          </div>
                        )}
                        {job.status === 'failed' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); retryMutation.mutate(job.id) }}
                            disabled={retryMutation.isPending}
                            className="text-sm px-3 py-1.5 rounded text-white"
                            style={{ backgroundColor: 'var(--blue)', opacity: retryMutation.isPending ? 0.6 : 1 }}
                          >
                            {retryMutation.isPending ? 'Re-enqueuing…' : 'Retry job'}
                          </button>
                        )}
                        {!job.error_message && !job.payload && (
                          <p className="text-xs" style={{ color: 'var(--text3)' }}>No additional details.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Integrations Tab ──────────────────────────────────────────────────────────

function IntegrationsTab() {
  const { data, isLoading } = useQuery<{ integrations: IntegrationGroup[] }>({
    queryKey: ['settings-integrations'],
    queryFn: () => fetch('/api/settings/integrations', { credentials: 'include' }).then((r) => r.json()),
  })

  const groups = data?.integrations ?? []

  return (
    <div>
      <div
        className="mb-4 px-3 py-2 rounded text-sm flex items-start gap-2"
        style={{ backgroundColor: '#0073BB12', color: '#0073BB', border: '1px solid #0073BB30' }}
      >
        <span style={{ flexShrink: 0 }}>ℹ</span>
        <span>Integration keys are read from environment variables. To change a value, edit <code className="font-mono text-xs">.env</code> and restart the server.</span>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />)}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.group}>
              <h3 className="text-xs font-semibold uppercase mb-2" style={{ color: 'var(--text3)', letterSpacing: '0.05em' }}>
                {group.group}
              </h3>
              <div className="rounded overflow-hidden" style={{ border: '1px solid #D5DBDB' }}>
                {group.items.map((item, i) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between px-4 py-3"
                    style={{ borderBottom: i < group.items.length - 1 ? '1px solid #D5DBDB' : undefined, backgroundColor: '#fff' }}
                  >
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--text1)' }}>{item.label}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{item.key}</p>
                    </div>
                    <span
                      className="text-sm"
                      style={{
                        fontFamily: item.sensitive ? 'var(--font-mono)' : undefined,
                        color: item.value === '[not set]' ? '#D13212' : 'var(--text1)',
                        fontSize: item.sensitive ? '0.85rem' : undefined,
                      }}
                    >
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Settings Page ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter()
  const [tab, setTab] = useState<SettingsTab>('team')

  const { data: session, isLoading: sessionLoading } = useQuery<SessionUser>({
    queryKey: ['session'],
    queryFn: () => fetch('/api/session', { credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error('Unauthorized')
      return r.json()
    }),
  })

  useEffect(() => {
    if (!session) return
    if (session.role === 'cto') {
      router.replace('/dashboard')
      return
    }
    if (session.role === 'coo' && tab !== 'team') {
      setTab('team')
    }
  }, [session, tab, router])

  const role = session?.role ?? 'cto'

  const TABS: { id: SettingsTab; label: string; ceoOnly?: boolean }[] = [
    { id: 'team',         label: 'Team' },
    { id: 'companies',    label: 'Companies',   ceoOnly: true },
    { id: 'jobs',         label: 'System Jobs', ceoOnly: true },
    { id: 'integrations', label: 'Integrations', ceoOnly: true },
  ]

  const visibleTabs = TABS.filter((t) => !t.ceoOnly || role === 'ceo')

  if (sessionLoading) {
    return (
      <div className="p-6">
        <div className="h-7 w-32 rounded animate-pulse mb-6" style={{ backgroundColor: '#E9EAEB' }} />
        <div className="h-10 w-full rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />
      </div>
    )
  }

  if (!session || session.role === 'cto') return null

  return (
    <div className="p-6">
      {/* Page header */}
      <h1
        className="text-xl font-semibold mb-6"
        style={{ fontFamily: 'var(--font-syne),sans-serif', color: 'var(--text1)' }}
      >
        Settings
      </h1>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6" style={{ borderBottom: '2px solid #D5DBDB' }}>
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2 text-sm transition-colors"
            style={{
              color: tab === t.id ? 'var(--blue)' : 'var(--text2)',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
              marginBottom: '-2px',
              fontWeight: tab === t.id ? 600 : 400,
              background: 'none',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-white rounded p-5" style={{ border: '1px solid #D5DBDB', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        {tab === 'team'         && <TeamTab userRole={role} />}
        {tab === 'companies'    && <CompaniesTab />}
        {tab === 'jobs'         && <JobsTab />}
        {tab === 'integrations' && <IntegrationsTab />}
      </div>
    </div>
  )
}
