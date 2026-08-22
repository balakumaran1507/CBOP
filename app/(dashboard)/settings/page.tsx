'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { Info, X, CheckCircle2, Calendar, Users, Send, FileText, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { BriefingDialog } from '@/app/components/briefing-dialog'

// ── Types ─────────────────────────────────────────────────────────────────────

const CO_TYPE_LABELS: Record<string, string> = {
  it: 'IT', security: 'Security', ctf: 'CTF', gamedev: 'Game Dev', ai: 'AI', saas: 'SaaS',
}

type Role = 'creator' | 'ceo' | 'coo' | 'cto'
type SettingsTab =
  | 'team' | 'companies' | 'jobs' | 'integrations' | 'hiring' | 'seo' | 'modules'
  | 'signatures' | 'email-templates' | 'automation' | 'roles'
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
  quotation_prefix: string | null
  invoice_terms: string | null
  address: string | null
  company_seal: string | null
  logo_initials: string | null
  logo_url: string | null
  is_active: boolean
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

interface EmailSignature {
  id: string
  company_id: string | null
  company_name: string | null
  name: string
  html: string
  is_default: boolean
  variables: string[]
  created_at: string
  updated_at: string
}

type TemplateOutputType = 'pdf' | 'email' | 'both'
type TemplateCategory = 'transactional' | 'marketing' | 'hiring' | 'notification' | 'contract' | 'proposal' | 'report' | 'certificate' | 'other'

interface TemplateItem {
  id: string
  name: string
  type: string
  output_type: TemplateOutputType
  subject: string | null
  category: TemplateCategory | null
  variables: string[] | null
  slug: string | null
  version: number
  updated_at: string
  created_at: string
  company_name: string
  company_id: string
}

type TriggerType = 'project.completed' | 'deal.closed_won' | 'invoice.paid' | 'lead.created'
type ActionType  = 'generate_certificate' | 'send_email' | 'create_task' | 'notify_team'

interface CompanyRole {
  id: string
  company_id: string
  name: string
  slug: string
  description: string | null
  is_system: boolean
  member_count: number
  created_at: string
}

interface EnhancedSettingsUser {
  id: string
  name: string
  email: string
  role: string
  company_role_id: string | null
  role_name: string | null
  role_slug: string | null
  telegram_chat_id: string | null
  whatsapp_number: string | null
  is_active: boolean
  created_at: string
  company_ids: string[] | null
  company_names: string[] | null
}

interface AutomationRule {
  id: string
  company_id: string
  company_name: string
  name: string
  trigger_type: TriggerType
  trigger_condition: Record<string, unknown>
  action_type: ActionType
  action_config: Record<string, unknown>
  is_active: boolean
  created_at: string
  updated_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

const ROLE_LABELS: Record<Role, string> = { creator: 'Creator', ceo: 'CEO', coo: 'COO', cto: 'CTO' }
const ROLE_COLORS: Record<Role, string> = {
  creator: '#8B5CF6',
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
          <button onClick={onClose} style={{ color: 'var(--text2)', lineHeight: 1 }}><X size={20} /></button>
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
  const [soOpen, setSoOpen]       = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editUser, setEditUser]   = useState<SettingsUser | null>(null)
  const [changeRoleUser, setChangeRoleUser] = useState<EnhancedSettingsUser | null>(null)

  const isCreator = userRole === 'creator'
  const isAdmin   = userRole === 'ceo' || isCreator

  // Creator uses the enhanced endpoint that returns dynamic role names
  const { data: enhancedData, isLoading: enhancedLoading } = useQuery<{ users: EnhancedSettingsUser[] }>({
    queryKey: ['settings-users-list'],
    queryFn: () => fetch('/api/settings/users-list', { credentials: 'include' }).then((r) => r.json()),
    enabled: isCreator,
  })

  const { data, isLoading: standardLoading } = useQuery<{ users: SettingsUser[] }>({
    queryKey: ['settings-users'],
    queryFn: () => fetch('/api/settings/users', { credentials: 'include' }).then((r) => r.json()),
    enabled: !isCreator,
  })

  const { data: companiesData } = useQuery<{ companies: { id: string; name: string }[] }>({
    queryKey: ['settings-companies'],
    queryFn: () => fetch('/api/settings/companies', { credentials: 'include' }).then((r) => r.json()),
    enabled: isAdmin,
  })

  const allCompanies = companiesData?.companies ?? []
  const isLoading    = isCreator ? enhancedLoading : standardLoading

  // For display purposes: unify both user shapes
  const enhancedUsers = enhancedData?.users ?? []
  const standardUsers = data?.users ?? []

  function displayRoleBadge(user: SettingsUser | EnhancedSettingsUser) {
    if ('role_name' in user && user.role_name) {
      const color = ROLE_COLORS[(user.role as Role)] ?? '#687078'
      return (
        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: color + '18', color }}>
          {user.role_name}
        </span>
      )
    }
    const su = user as SettingsUser
    return (
      <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: (ROLE_COLORS[su.role] ?? '#687078') + '18', color: ROLE_COLORS[su.role] ?? '#687078' }}>
        {ROLE_LABELS[su.role] ?? su.role}
      </span>
    )
  }

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['settings-users'] })
    qc.invalidateQueries({ queryKey: ['settings-users-list'] })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          {isAdmin ? `${(isCreator ? enhancedUsers : standardUsers).length} team members` : 'Team members - read only'}
        </p>
        {isAdmin && (
          <div className="flex gap-2">
            {isCreator && (
              <button
                onClick={() => setInviteOpen(true)}
                className="text-sm px-3 py-1.5 rounded text-white"
                style={{ backgroundColor: '#1D8102' }}
              >
                + Invite User
              </button>
            )}
            {!isCreator && (
              <button
                onClick={() => setSoOpen(true)}
                className="text-sm px-3 py-1.5 rounded text-white"
                style={{ backgroundColor: 'var(--blue)' }}
              >
                + New User
              </button>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />
          ))}
        </div>
      ) : isCreator ? (
        <div className="rounded overflow-hidden" style={{ border: '1px solid #D5DBDB' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#F8F9FA', borderBottom: '1px solid #D5DBDB' }}>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Name</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Role</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Email</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Companies</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Status</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {enhancedUsers.map((u, i) => (
                <tr
                  key={u.id}
                  style={{ borderBottom: i < enhancedUsers.length - 1 ? '1px solid #D5DBDB' : undefined }}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text1)' }}>{u.name}</td>
                  <td className="px-4 py-3">{displayRoleBadge(u)}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{u.email}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontSize: '0.8rem' }}>
                    {(u.company_names ?? []).join(', ') || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: u.is_active ? '#1D810218' : '#D1321218', color: u.is_active ? '#1D8102' : '#D13212' }}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.role !== 'creator' && (
                      <button
                        onClick={() => setChangeRoleUser(u)}
                        className="text-xs px-2 py-1 rounded"
                        style={{ border: '1px solid #D5DBDB', color: 'var(--blue)', background: '#fff', cursor: 'pointer' }}
                      >
                        Change Role
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
              {standardUsers.map((u, i) => (
                <tr
                  key={u.id}
                  style={{ borderBottom: i < standardUsers.length - 1 ? '1px solid #D5DBDB' : undefined, cursor: 'pointer' }}
                  className="hover:bg-gray-50 transition-colors"
                  onClick={() => setEditUser(u)}
                >
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text1)' }}>{u.name}</td>
                  <td className="px-4 py-3">{displayRoleBadge(u)}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>{u.email}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {u.telegram_chat_id || '-'}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontSize: '0.8rem' }}>
                    {(u.company_names ?? []).join(', ') || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: u.is_active ? '#1D810218' : '#D1321218', color: u.is_active ? '#1D8102' : '#D13212' }}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite User slide-over (creator only) */}
      <InviteUserSlideOver
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        companies={allCompanies}
        onSuccess={() => { refreshAll(); setInviteOpen(false) }}
      />

      {/* New User slide-over (CEO) */}
      <CreateUserSlideOver
        open={soOpen}
        onClose={() => setSoOpen(false)}
        companies={allCompanies}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['settings-users'] }); setSoOpen(false) }}
      />

      {/* Edit User slide-over (CEO) */}
      <EditUserSlideOver
        user={editUser}
        companies={allCompanies}
        onClose={() => setEditUser(null)}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['settings-users'] }); setEditUser(null) }}
      />

      {/* Change Role slide-over (creator) */}
      <ChangeRoleSlideOver
        user={changeRoleUser}
        companies={allCompanies}
        onClose={() => setChangeRoleUser(null)}
        onSuccess={() => { refreshAll(); setChangeRoleUser(null) }}
      />
    </div>
  )
}

// ── Invite User Slide-over (creator only) ────────────────────────────────────

function InviteUserSlideOver({
  open, onClose, companies, onSuccess,
}: {
  open: boolean
  onClose: () => void
  companies: { id: string; name: string }[]
  onSuccess: () => void
}) {
  const [form, setForm] = useState({ name: '', email: '', role_id: '', company_id: '' })
  const [err, setErr]   = useState('')
  const [success, setSuccess] = useState<{ name: string; email: string; temp_password: string } | null>(null)
  const [copied, setCopied]   = useState(false)

  const { data: rolesData } = useQuery<{ roles: CompanyRole[] }>({
    queryKey: ['settings-roles', form.company_id],
    queryFn: () => fetch(`/api/settings/roles?company_id=${form.company_id}`, { credentials: 'include' }).then((r) => r.json()),
    enabled: !!form.company_id,
  })

  const roles = rolesData?.roles ?? []

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      fetch('/api/settings/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }
        return r.json()
      }),
    onSuccess: (data) => {
      setSuccess({ name: form.name, email: form.email, temp_password: data.temp_password })
      onSuccess()
    },
    onError: (e: Error) => setErr(e.message),
  })

  function reset() {
    setForm({ name: '', email: '', role_id: '', company_id: '' })
    setErr('')
    setSuccess(null)
    setCopied(false)
  }

  function copyPassword() {
    if (!success) return
    void navigator.clipboard.writeText(success.temp_password)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <SlideOver open={open} onClose={() => { reset(); onClose() }} title="Invite User">
      {success ? (
        <div>
          <div className="mb-5 p-4 rounded" style={{ backgroundColor: '#F0FFF4', border: '1px solid #1D8102' }}>
            <p className="text-sm font-semibold mb-1" style={{ color: '#1D8102' }}>Invitation created</p>
            <p className="text-sm" style={{ color: 'var(--text1)' }}>{success.name} ({success.email})</p>
          </div>
          <p className="text-xs mb-2 font-medium" style={{ color: 'var(--text2)' }}>
            Share this temporary password with {success.name} — they can change it after logging in.
          </p>
          <div className="flex items-center gap-2 mb-4">
            <code
              className="flex-1 px-3 py-2 rounded text-sm"
              style={{ fontFamily: 'var(--font-mono)', backgroundColor: '#F8F9FA', border: '1px solid #D5DBDB', color: 'var(--text1)', letterSpacing: '0.05em' }}
            >
              {success.temp_password}
            </code>
            <button
              onClick={copyPassword}
              className="px-3 py-2 rounded text-sm text-white"
              style={{ backgroundColor: copied ? '#1D8102' : 'var(--blue)', minWidth: 64, transition: 'background-color 0.2s' }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-xs mb-4" style={{ color: 'var(--text3)' }}>
            Login URL: {typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login'}
          </p>
          <button onClick={reset} className="text-sm px-4 py-2 rounded" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>
            Invite another user
          </button>
        </div>
      ) : (
        <>
          {err && (
            <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#F8F9FA', color: '#D13212', border: '1px solid #E5E7EB' }}>{err}</div>
          )}

          <Field label="Full name *">
            <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nabeelah" />
          </Field>
          <Field label="Email *">
            <input style={inputStyle} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@etherence.com" />
          </Field>
          <Field label="Company *">
            <select
              style={selectStyle}
              value={form.company_id}
              onChange={(e) => setForm({ ...form, company_id: e.target.value, role_id: '' })}
            >
              <option value="">— select company —</option>
              {companies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
            </select>
          </Field>
          <Field label="Role *">
            <select
              style={selectStyle}
              value={form.role_id}
              onChange={(e) => setForm({ ...form, role_id: e.target.value })}
              disabled={!form.company_id || roles.length === 0}
            >
              <option value="">— select role —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.is_system ? ' (system)' : ''}</option>
              ))}
            </select>
            {form.company_id && roles.length === 0 && (
              <p className="mt-1 text-xs" style={{ color: '#E8820C' }}>No roles found for this company. Create roles in the Roles & Access tab first.</p>
            )}
          </Field>

          <p className="text-xs mb-4" style={{ color: 'var(--text3)' }}>
            A temporary password will be generated and shown after submission. The user can change it after their first login.
          </p>

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => mutation.mutate(form)}
              disabled={mutation.isPending || !form.name.trim() || !form.email.trim() || !form.role_id || !form.company_id}
              className="flex-1 py-2 rounded text-sm text-white"
              style={{ backgroundColor: 'var(--blue)', opacity: mutation.isPending ? 0.6 : 1 }}
            >
              {mutation.isPending ? 'Inviting…' : 'Send Invite'}
            </button>
            <button onClick={() => { reset(); onClose() }} className="px-4 py-2 rounded text-sm" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </SlideOver>
  )
}

// ── Change Role Slide-over (creator only) ────────────────────────────────────

function ChangeRoleSlideOver({
  user, companies, onClose, onSuccess,
}: {
  user: EnhancedSettingsUser | null
  companies: { id: string; name: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [selectedRoleId, setSelectedRoleId]       = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (user) {
      const firstCompany = (user.company_ids ?? [])[0] ?? ''
      setSelectedCompanyId(firstCompany)
      setSelectedRoleId(user.company_role_id ?? '')
      setErr('')
    }
  }, [user])

  const { data: rolesData } = useQuery<{ roles: CompanyRole[] }>({
    queryKey: ['settings-roles', selectedCompanyId],
    queryFn: () => fetch(`/api/settings/roles?company_id=${selectedCompanyId}`, { credentials: 'include' }).then((r) => r.json()),
    enabled: !!selectedCompanyId,
  })

  const roles = rolesData?.roles ?? []

  const mutation = useMutation({
    mutationFn: () =>
      fetch(`/api/settings/users/${user!.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role_id: selectedRoleId }),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }
        return r.json()
      }),
    onSuccess,
    onError: (e: Error) => setErr(e.message),
  })

  if (!user) return null

  const userCompanies = companies.filter((co) => (user.company_ids ?? []).includes(co.id))

  return (
    <SlideOver open={!!user} onClose={onClose} title={`Change Role — ${user.name}`}>
      {err && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#F8F9FA', color: '#D13212', border: '1px solid #E5E7EB' }}>{err}</div>
      )}

      <p className="text-sm mb-4" style={{ color: 'var(--text2)' }}>
        Current role: <strong>{user.role_name ?? user.role}</strong>
      </p>

      {userCompanies.length > 1 && (
        <Field label="Company context">
          <select style={selectStyle} value={selectedCompanyId} onChange={(e) => { setSelectedCompanyId(e.target.value); setSelectedRoleId('') }}>
            {userCompanies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
          </select>
        </Field>
      )}

      <Field label="New Role *">
        <select
          style={selectStyle}
          value={selectedRoleId}
          onChange={(e) => setSelectedRoleId(e.target.value)}
          disabled={!selectedCompanyId || roles.length === 0}
        >
          <option value="">— select role —</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}{r.is_system ? ' (system)' : ''}</option>
          ))}
        </select>
      </Field>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !selectedRoleId}
          className="flex-1 py-2 rounded text-sm text-white"
          style={{ backgroundColor: 'var(--blue)', opacity: mutation.isPending ? 0.6 : 1 }}
        >
          {mutation.isPending ? 'Saving…' : 'Change Role'}
        </button>
        <button onClick={onClose} className="px-4 py-2 rounded text-sm" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>
          Cancel
        </button>
      </div>
    </SlideOver>
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
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#F8F9FA', color: '#D13212', border: '1px solid #E5E7EB' }}>{err}</div>
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
    <SlideOver open={!!user} onClose={onClose} title={`Edit - ${user.name}`}>
      {err && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#F8F9FA', color: '#D13212', border: '1px solid #E5E7EB' }}>{err}</div>
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

// ── Company Seal Upload ───────────────────────────────────────────────────────

function CompanySealUpload({ company, onUploaded }: { company: SettingsCompany | null; onUploaded: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  if (!company) return null

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setErr('')
    try {
      const fd = new FormData(); fd.append('file', file)
      const res  = await fetch(`/api/settings/companies/${company.id}/seal`, { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || 'Upload failed'); return }
      onUploaded()
    } catch { setErr('Network error')
    } finally { setUploading(false); e.target.value = '' }
  }

  const sealUrl = company.company_seal?.startsWith('/api/') ? company.company_seal : null

  return (
    <div className="mb-4">
      <div className="text-xs font-medium mb-1" style={{ color: 'var(--text2)' }}>Company Seal</div>
      {sealUrl && (
        <div style={{ marginBottom: 8, padding: 6, borderRadius: 4, border: '1px solid var(--border)', background: '#F8F9FA', display: 'inline-block' }}>
          <img src={sealUrl} alt="seal" style={{ height: 64, maxWidth: 160, objectFit: 'contain', display: 'block' }} />
        </div>
      )}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 5, border: '1px solid var(--border)', cursor: uploading ? 'wait' : 'pointer', fontSize: 13, color: 'var(--text1)', background: '#fff' }}>
        {uploading ? 'Uploading…' : sealUrl ? 'Replace Seal' : 'Upload Seal'}
        <input type="file" accept="image/png,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
      </label>
      {err && <p className="mt-1 text-xs" style={{ color: 'var(--red)' }}>{err}</p>}
      <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>PNG, WebP or SVG with transparent background. Used on contracts and invoices.</p>
    </div>
  )
}

// ── Company Logo Upload ───────────────────────────────────────────────────────

function CompanyLogoUpload({ company, onUploaded }: { company: SettingsCompany | null; onUploaded: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  if (!company) return null

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setErr('')
    try {
      const fd = new FormData(); fd.append('file', file)
      const res  = await fetch(`/api/settings/companies/${company.id}/logo`, { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || 'Upload failed'); return }
      onUploaded()
    } catch { setErr('Network error')
    } finally { setUploading(false); e.target.value = '' }
  }

  return (
    <div className="mb-4">
      <div className="text-xs font-medium mb-1" style={{ color: 'var(--text2)' }}>Company Logo</div>
      {company.logo_url && (
        <img src={company.logo_url} alt="logo" style={{ height: 40, maxWidth: 160, objectFit: 'contain', borderRadius: 4, border: '1px solid var(--border)', marginBottom: 8, background: '#fff', padding: 4 }} />
      )}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 5, border: '1px solid var(--border)', cursor: uploading ? 'wait' : 'pointer', fontSize: 13, color: 'var(--text1)', background: '#fff' }}>
        {uploading ? 'Uploading…' : company.logo_url ? 'Replace Logo' : 'Upload Logo'}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
      </label>
      {err && <p className="mt-1 text-xs" style={{ color: 'var(--red)' }}>{err}</p>}
      <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>PNG, JPG or SVG. Used in PDF templates and emails.</p>
    </div>
  )
}

// ── Companies Tab ─────────────────────────────────────────────────────────────

function CompaniesTab() {
  const qc = useQueryClient()
  const [editCompany, setEditCompany] = useState<SettingsCompany | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading } = useQuery<{ companies: SettingsCompany[] }>({
    queryKey: ['settings-companies'],
    queryFn: () => fetch('/api/settings/companies', { credentials: 'include' }).then((r) => r.json()),
  })

  const companies = data?.companies ?? []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Click a company to edit its details. GSTIN and UPI ID are used on invoices.
        </p>
        <button
          onClick={() => setCreateOpen(true)}
          className="text-sm px-3 py-1.5 rounded text-white flex-shrink-0"
          style={{ backgroundColor: 'var(--blue)' }}
        >
          + Add Company
        </button>
      </div>

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
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((co, i) => (
                <tr
                  key={co.id}
                  onClick={() => setEditCompany(co)}
                  className="hover:bg-gray-50 transition-colors"
                  style={{
                    borderBottom: i < companies.length - 1 ? '1px solid #D5DBDB' : undefined,
                    cursor: 'pointer',
                    opacity: co.is_active ? 1 : 0.55,
                  }}
                >
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text1)' }}>{co.name}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{co.type ? (CO_TYPE_LABELS[co.type] ?? co.type) : '-'}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {co.invoice_prefix ?? '-'}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {co.gstin || '-'}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {co.upi_id || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: co.is_active ? '#1D810218' : '#D1321218',
                        color: co.is_active ? '#1D8102' : '#D13212',
                      }}
                    >
                      {co.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateCompanySlideOver
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['settings-companies'] })
          setCreateOpen(false)
        }}
      />

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

// ── Create Company Slide-over ─────────────────────────────────────────────────

function CreateCompanySlideOver({
  open, onClose, onSuccess,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [form, setForm] = useState({
    name: '', invoice_prefix: '', type: '', gstin: '', upi_id: '', address: '',
  })
  const [err, setErr] = useState('')

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      fetch('/api/settings/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name,
          invoice_prefix: data.invoice_prefix.trim().toUpperCase(),
          type: data.type || undefined,
          gstin: data.gstin || undefined,
          upi_id: data.upi_id || undefined,
          address: data.address || undefined,
        }),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }
        return r.json()
      }),
    onSuccess,
    onError: (e: Error) => setErr(e.message),
  })

  function reset() {
    setForm({ name: '', invoice_prefix: '', type: '', gstin: '', upi_id: '', address: '' })
    setErr('')
  }

  return (
    <SlideOver open={open} onClose={() => { reset(); onClose() }} title="Add Company">
      {err && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#F8F9FA', color: '#D13212', border: '1px solid #E5E7EB' }}>{err}</div>
      )}

      <Field label="Company name *">
        <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="New Company Pvt Ltd" />
      </Field>
      <Field label="Invoice prefix *">
        <input
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          value={form.invoice_prefix}
          onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value.toUpperCase() })}
          placeholder="ETH"
          maxLength={6}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
          2-6 uppercase letters/digits. Used on every invoice (e.g. ETH-2026-0001) - cannot be changed once invoices exist.
        </p>
      </Field>
      <Field label="Type">
        <select style={selectStyle} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="">- select -</option>
          <option value="it">IT</option>
          <option value="security">Security</option>
          <option value="ctf">CTF</option>
          <option value="gamedev">Game Dev</option>
          <option value="ai">AI</option>
          <option value="saas">SaaS</option>
        </select>
      </Field>
      <Field label="GSTIN">
        <input style={inputStyle} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="33XXXXXXXXXXXXX" />
      </Field>
      <Field label="UPI ID">
        <input style={inputStyle} value={form.upi_id} onChange={(e) => setForm({ ...form, upi_id: e.target.value })} placeholder="company@upi" />
      </Field>
      <Field label="Company Address">
        <textarea
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          placeholder="No. 12, Example Street, Chennai 600 001"
          rows={3}
          style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical' }}
        />
      </Field>

      <p className="mb-4 text-xs" style={{ color: 'var(--text3)' }}>
        Bank details, GST, logo and seal can be added afterwards by editing the company.
        To route outbound email and SMTP credentials for this company, add its domain to
        the <code>email_domains</code> table.
      </p>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending || !form.name.trim() || !form.invoice_prefix.trim()}
          className="flex-1 py-2 rounded text-sm text-white"
          style={{ backgroundColor: 'var(--blue)', opacity: mutation.isPending ? 0.6 : 1 }}
        >
          {mutation.isPending ? 'Creating…' : 'Create Company'}
        </button>
        <button onClick={() => { reset(); onClose() }} className="px-4 py-2 rounded text-sm" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>
          Cancel
        </button>
      </div>
    </SlideOver>
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
  const [form, setForm] = useState({
    name: '', type: '', gstin: '', upi_id: '', address: '', logo_initials: '', invoice_prefix: '',
    quotation_prefix: '', invoice_terms: '',
    bank_name: '', account_name: '', account_number: '', ifsc: '', branch: '',
  })
  const [err, setErr] = useState('')

  useEffect(() => {
    if (company) {
      const bd = (company.bank_details ?? {}) as Record<string, string>
      setForm({
        name:              company.name,
        type:              company.type ?? '',
        gstin:             company.gstin ?? '',
        upi_id:            company.upi_id ?? '',
        address:           company.address ?? '',
        logo_initials:     company.logo_initials ?? '',
        invoice_prefix:    company.invoice_prefix ?? '',
        quotation_prefix:  company.quotation_prefix ?? '',
        invoice_terms:     company.invoice_terms ?? '',
        bank_name:      bd.bank_name ?? bd.bank ?? '',
        account_name:   bd.account_name ?? bd.name ?? '',
        account_number: bd.account_number ?? bd.account ?? '',
        ifsc:           bd.ifsc ?? '',
        branch:         bd.branch ?? '',
      })
      setErr('')
    }
  }, [company])

  const mutation = useMutation({
    mutationFn: (data: typeof form) => {
      const hasBank = [data.bank_name, data.account_number, data.ifsc].some(v => v.trim())
      const bank_details = hasBank
        ? { bank_name: data.bank_name, account_name: data.account_name, account_number: data.account_number, ifsc: data.ifsc, branch: data.branch }
        : undefined
      const prefixChanged = data.invoice_prefix.trim().toUpperCase() !== (company!.invoice_prefix ?? '')
      const quotationPrefixChanged = data.quotation_prefix.trim().toUpperCase() !== (company!.quotation_prefix ?? '')
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
          address: data.address,
          logo_initials: data.logo_initials,
          invoice_prefix: prefixChanged ? data.invoice_prefix.trim().toUpperCase() : undefined,
          quotation_prefix: quotationPrefixChanged ? data.quotation_prefix.trim().toUpperCase() : undefined,
          invoice_terms: data.invoice_terms,
        }),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }
        return r.json()
      })
    },
    onSuccess,
    onError: (e: Error) => setErr(e.message),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/settings/companies/${company!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_active: !company!.is_active }),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }
        return r.json()
      }),
    onSuccess,
    onError: (e: Error) => setErr(e.message),
  })

  if (!company) return null

  return (
    <SlideOver open={!!company} onClose={onClose} title={`Edit - ${company.name}`}>
      {err && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#F8F9FA', color: '#D13212', border: '1px solid #E5E7EB' }}>{err}</div>
      )}

      <div className="flex items-center justify-between mb-4 px-3 py-2 rounded" style={{ backgroundColor: '#F8F9FA', border: '1px solid #E5E7EB' }}>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded"
          style={{
            backgroundColor: company.is_active ? '#1D810218' : '#D1321218',
            color: company.is_active ? '#1D8102' : '#D13212',
          }}
        >
          {company.is_active ? 'Active' : 'Inactive'}
        </span>
        <button
          onClick={() => toggleActiveMutation.mutate()}
          disabled={toggleActiveMutation.isPending}
          className="text-xs px-3 py-1.5 rounded"
          style={{
            border: `1px solid ${company.is_active ? '#D13212' : '#1D8102'}`,
            color: company.is_active ? '#D13212' : '#1D8102',
            opacity: toggleActiveMutation.isPending ? 0.6 : 1,
          }}
        >
          {toggleActiveMutation.isPending ? 'Saving…' : company.is_active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>

      <Field label="Company name">
        <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Invoice prefix">
        <input
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          value={form.invoice_prefix}
          onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value.toUpperCase() })}
          placeholder="ETH"
          maxLength={6}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
          Locked once this company has invoices - changing it afterwards would break the numbering sequence.
        </p>
      </Field>
      <Field label="Quotation Number Prefix">
        <input
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          value={form.quotation_prefix}
          onChange={(e) => setForm({ ...form, quotation_prefix: e.target.value.toUpperCase() })}
          placeholder="ETH-QUO"
          maxLength={16}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
          Used for quotation numbers, e.g. {form.quotation_prefix || 'ETH-QUO'}-2026-0001.
        </p>
      </Field>
      <Field label="Type">
        <select style={selectStyle} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="">- select -</option>
          <option value="it">IT</option>
          <option value="security">Security</option>
          <option value="ctf">CTF</option>
          <option value="gamedev">Game Dev</option>
          <option value="ai">AI</option>
          <option value="saas">SaaS</option>
        </select>
      </Field>
      <Field label="GSTIN">
        <input style={inputStyle} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="33XXXXXXXXXXXXX" />
      </Field>
      <Field label="UPI ID">
        <input style={inputStyle} value={form.upi_id} onChange={(e) => setForm({ ...form, upi_id: e.target.value })} placeholder="company@upi" />
      </Field>
      <div className="mb-4">
        <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text2)', letterSpacing: '0.05em' }}>Bank Details</div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <div style={{ flex: 1 }}>
              <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Bank Name</div>
              <input style={inputStyle} value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} placeholder="HDFC Bank" />
            </div>
            <div style={{ flex: 1 }}>
              <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Account Name</div>
              <input style={inputStyle} value={form.account_name} onChange={e => setForm({ ...form, account_name: e.target.value })} placeholder="Etherence IT Pvt Ltd" />
            </div>
          </div>
          <div className="flex gap-2">
            <div style={{ flex: 1 }}>
              <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Account Number</div>
              <input style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }} value={form.account_number} onChange={e => setForm({ ...form, account_number: e.target.value })} placeholder="50100XXXXXXXXXX" />
            </div>
            <div style={{ flex: 1 }}>
              <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>IFSC Code</div>
              <input style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }} value={form.ifsc} onChange={e => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} placeholder="HDFC0001234" />
            </div>
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Branch</div>
            <input style={inputStyle} value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })} placeholder="Anna Nagar, Chennai" />
          </div>
        </div>
      </div>
      <Field label="Company Address">
        <textarea
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          placeholder="No. 12, Example Street, Chennai 600 001"
          rows={3}
          style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical' }}
        />
      </Field>
      <Field label="Logo Initials">
        <input
          style={inputStyle}
          value={form.logo_initials}
          onChange={(e) => setForm({ ...form, logo_initials: e.target.value })}
          placeholder="E2"
          maxLength={3}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
          2–3 characters shown in the logo circle. Leave blank to auto-generate from company name.
        </p>
      </Field>
      <Field label="Invoice Terms & Conditions">
        <textarea
          value={form.invoice_terms}
          onChange={(e) => setForm({ ...form, invoice_terms: e.target.value })}
          placeholder={'1. Payment due within 14 days of invoice date.\n2. Late payments subject to 1.5% monthly interest.\n3. Disputes subject to Chennai jurisdiction.\n4. This is a system-generated tax invoice.'}
          rows={5}
          style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical' }}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
          Default terms shown on this company&apos;s invoices and quotations. Can still be overridden per-document.
        </p>
      </Field>
      <CompanySealUpload company={company} onUploaded={() => onSuccess()} />
      <CompanyLogoUpload company={company} onUploaded={() => onSuccess()} />

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
          {jobs.length} job entries - auto-refreshes every 15s
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
        style={{ backgroundColor: '#F8F9FA', color: '#0073BB', border: '1px solid #E5E7EB' }}
      >
        <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}><Info size={16} /></span>
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

// ── Hiring Tab ────────────────────────────────────────────────────────────────

interface HiringSettings {
  id: string
  company_id: string
  company_name: string
  rejection_delay_hours: number
  auto_reject_threshold: number
  auto_shortlist_threshold: number
  slack_workspace_invite_url: string | null
  discord_invite_url: string | null
  google_calendar_id: string | null
  rejection_email_template: string
  interview_email_template: string
  offer_email_template: string
  welcome_email_template: string
  updated_at: string
}

const TEMPLATE_VARS: Record<string, string[]> = {
  rejection: ['{{applicant_name}}', '{{role_title}}', '{{company_name}}'],
  interview: ['{{applicant_name}}', '{{role_title}}', '{{company_name}}', '{{interview_date}}', '{{interview_time}}', '{{meet_link}}', '{{interviewer_name}}'],
  offer:     ['{{applicant_name}}', '{{role_title}}', '{{company_name}}'],
  welcome:   ['{{applicant_name}}', '{{role_title}}', '{{company_name}}', '{{start_date}}', '{{team_lead_name}}', '{{team_lead_email}}'],
}

const EMAIL_TEMPLATES = [
  { key: 'rejection', label: 'Rejection', field: 'rejection_email_template' as const },
  { key: 'interview', label: 'Interview', field: 'interview_email_template' as const },
  { key: 'offer',     label: 'Offer',     field: 'offer_email_template'     as const },
  { key: 'welcome',   label: 'Welcome',   field: 'welcome_email_template'   as const },
]

function AutoTextarea({ value, onChange, style }: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  style: React.CSSProperties
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      style={{ ...style, overflow: 'hidden', resize: 'none', minHeight: 140 }}
    />
  )
}

function HiringTab() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<HiringSettings>>({})
  const [saved, setSaved] = useState(false)
  const [templateKey, setTemplateKey] = useState<string>('rejection')

  const { data, isLoading } = useQuery<{ settings: HiringSettings[] }>({
    queryKey: ['settings-hiring'],
    queryFn: () => fetch('/api/settings/hiring', { credentials: 'include' }).then(r => r.json()),
  })

  const settings = data?.settings ?? []

  useEffect(() => {
    if (settings.length > 0 && !selectedId) {
      setSelectedId(settings[0].company_id)
    }
  }, [settings, selectedId])

  useEffect(() => {
    const s = settings.find(x => x.company_id === selectedId)
    if (s) setForm({ ...s })
  }, [selectedId, data])

  const saveMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/settings/hiring/${selectedId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!r.ok) throw new Error('Save failed')
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-hiring'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const set = (field: keyof HiringSettings, value: unknown) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const taStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', border: '1px solid #D5DBDB',
    borderRadius: 6, fontSize: '0.8125rem', fontFamily: 'var(--font-mono)',
    color: 'var(--text1)', outline: 'none',
    boxSizing: 'border-box', lineHeight: 1.6,
  }

  const numStyle: React.CSSProperties = { ...inputStyle, width: 120, fontFamily: 'var(--font-mono)' }

  const activeTemplate = EMAIL_TEMPLATES.find(t => t.key === templateKey)!

  if (isLoading) {
    return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-10 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />)}</div>
  }

  return (
    <div>
      {/* Company selector */}
      <div className="flex flex-wrap gap-2 mb-6">
        {settings.map(s => (
          <button
            key={s.company_id}
            onClick={() => setSelectedId(s.company_id)}
            className="px-4 py-1.5 rounded text-sm font-medium transition-colors"
            style={{
              backgroundColor: selectedId === s.company_id ? 'var(--blue)' : '#F2F3F3',
              color: selectedId === s.company_id ? '#fff' : 'var(--text1)',
              border: '1px solid',
              borderColor: selectedId === s.company_id ? 'var(--blue)' : '#D5DBDB',
            }}
          >
            {s.company_name}
          </button>
        ))}
      </div>

      {selectedId && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24, alignItems: 'start' }}>

          {/* Left column - thresholds + integrations + save */}
          <div>
            <div className="mb-5 p-4 rounded" style={{ border: '1px solid #D5DBDB', backgroundColor: '#FAFBFB' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text2)' }}>
                Scoring Thresholds
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text2)' }}>Rejection Delay (hours)</label>
                  <input
                    type="number" min={0} max={168}
                    value={form.rejection_delay_hours ?? 48}
                    onChange={e => set('rejection_delay_hours', parseInt(e.target.value) || 0)}
                    style={numStyle}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text2)' }}>Auto-Reject Below</label>
                  <input
                    type="number" min={0} max={100}
                    value={form.auto_reject_threshold ?? 25}
                    onChange={e => set('auto_reject_threshold', parseInt(e.target.value) || 0)}
                    style={numStyle}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text2)' }}>Auto-Shortlist Above</label>
                  <input
                    type="number" min={0} max={100}
                    value={form.auto_shortlist_threshold ?? 75}
                    onChange={e => set('auto_shortlist_threshold', parseInt(e.target.value) || 0)}
                    style={numStyle}
                  />
                </div>
              </div>
            </div>

            <div className="mb-5 p-4 rounded" style={{ border: '1px solid #D5DBDB', backgroundColor: '#FAFBFB' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text2)' }}>
                Integrations
              </h3>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text2)' }}>Slack Workspace Invite URL</label>
                <input
                  type="url"
                  value={form.slack_workspace_invite_url ?? ''}
                  onChange={e => set('slack_workspace_invite_url', e.target.value || null)}
                  placeholder="https://join.slack.com/t/..."
                  style={inputStyle}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
                className="px-5 py-2 rounded text-sm font-medium text-white flex items-center gap-1.5"
                style={{ backgroundColor: saved ? '#1D8102' : 'var(--blue)', transition: 'background-color 0.2s' }}
              >
                {saveMut.isPending ? 'Saving…' : saved ? <><CheckCircle2 size={14} /> Saved</> : 'Save Settings'}
              </button>
              {saveMut.isError && (
                <span className="text-sm" style={{ color: '#D13212' }}>Save failed</span>
              )}
            </div>
          </div>

          {/* Right column - email templates */}
          <div>
            {/* Template sub-tabs */}
            <div className="flex gap-0 mb-0" style={{ borderBottom: '2px solid #D5DBDB' }}>
              {EMAIL_TEMPLATES.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTemplateKey(t.key)}
                  className="px-4 py-2 text-sm transition-colors"
                  style={{
                    color: templateKey === t.key ? 'var(--blue)' : 'var(--text2)',
                    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                    borderBottom: templateKey === t.key ? '2px solid var(--blue)' : '2px solid transparent',
                    marginBottom: '-2px',
                    fontWeight: templateKey === t.key ? 600 : 400,
                    background: 'none', cursor: 'pointer',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="pt-4">
              {/* Variable chips */}
              <div className="flex flex-wrap gap-1 mb-3">
                <span className="text-xs mr-1" style={{ color: 'var(--text3)', alignSelf: 'center' }}>Variables:</span>
                {TEMPLATE_VARS[activeTemplate.key].map(v => (
                  <span
                    key={v}
                    className="text-xs px-1.5 py-0.5 rounded cursor-pointer select-all"
                    style={{ backgroundColor: '#EBF5FB', color: '#0073BB', fontFamily: 'var(--font-mono)' }}
                    title="Click to select"
                  >
                    {v}
                  </span>
                ))}
              </div>

              {/* Auto-growing textarea */}
              <AutoTextarea
                value={(form[activeTemplate.field] as string) ?? ''}
                onChange={e => set(activeTemplate.field, e.target.value)}
                style={taStyle}
              />
              <p className="mt-1.5 text-xs" style={{ color: 'var(--text3)' }}>
                Use the variable names above exactly as shown - they are replaced at send time.
              </p>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}

// ── SEO Connections Tab ──────────────────────────────────────────────────────

interface SeoConnection {
  id: string
  company_id: string
  company_name: string
  site_url: string
  ga4_property_id: string | null
  connected_at: string
  connected_by_name: string | null
}

interface VerifiedSite { siteUrl: string; permissionLevel: string }

function SeoConnectionsTab() {
  const qc = useQueryClient()
  const [pickingFor, setPickingFor] = useState<string | null>(null)

  const { data: companiesData } = useQuery<{ companies: { id: string; name: string }[] }>({
    queryKey: ['settings-companies'],
    queryFn: () => fetch('/api/settings/companies', { credentials: 'include' }).then((r) => r.json()),
  })
  const companies = companiesData?.companies ?? []

  const { data, isLoading } = useQuery<{ connections: SeoConnection[]; google_configured: boolean }>({
    queryKey: ['seo-connections'],
    queryFn: () => fetch('/api/seo/connections', { credentials: 'include' }).then((r) => r.json()),
  })
  const connections = data?.connections ?? []
  const googleConfigured = data?.google_configured ?? false

  const { data: verifiedSitesData, isLoading: sitesLoading } = useQuery<{ sites: VerifiedSite[] }>({
    queryKey: ['seo-verified-sites', pickingFor],
    queryFn: () => fetch(`/api/seo/connections/${pickingFor}/verified-sites`, { credentials: 'include' }).then((r) => r.json()),
    enabled: !!pickingFor,
  })

  async function pickSite(connectionId: string, siteUrl: string) {
    await fetch(`/api/seo/connections/${connectionId}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_url: siteUrl }),
    })
    setPickingFor(null)
    qc.invalidateQueries({ queryKey: ['seo-connections'] })
  }

  async function disconnect(id: string) {
    if (!confirm('Disconnect this site? Tracked SEO data stays, but rankings/traffic will stop updating.')) return
    await fetch(`/api/seo/connections/${id}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['seo-connections'] })
  }

  return (
    <div>
      {!googleConfigured && (
        <div className="mb-4 px-3 py-2 rounded text-sm flex items-start gap-2" style={{ backgroundColor: '#FDECEA', color: '#D13212', border: '1px solid #F5C6C0' }}>
          <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}><Info size={16} /></span>
          <span>
            Google OAuth isn&apos;t configured yet. Create a project at console.cloud.google.com, enable
            &quot;Search Console API&quot; + &quot;Google Analytics Data API&quot;, create an OAuth 2.0 Web
            application Client ID, and set <code className="font-mono text-xs">GOOGLE_OAUTH_CLIENT_ID</code> /{' '}
            <code className="font-mono text-xs">GOOGLE_OAUTH_CLIENT_SECRET</code> in <code className="font-mono text-xs">.env</code> - see the comment
            block in <code className="font-mono text-xs">.env.example</code> for the exact redirect URI to authorize.
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="h-20 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />
      ) : (
        <div className="space-y-3">
          {companies.map((co) => {
            const conn = connections.find((c) => c.company_id === co.id)
            const isPending = conn && conn.site_url === 'pending-site-selection'
            return (
              <div key={co.id} className="flex items-center justify-between px-4 py-3 rounded" style={{ border: '1px solid #D5DBDB', backgroundColor: '#fff' }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text1)' }}>{co.name}</p>
                  {conn ? (
                    isPending ? (
                      <p className="text-xs mt-0.5" style={{ color: '#E8820C' }}>Connected - pick a verified property</p>
                    ) : (
                      <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text3)' }}>{conn.site_url}</p>
                    )
                  ) : (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>Not connected</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {conn && isPending && (
                    <button
                      onClick={() => setPickingFor(conn.id)}
                      className="text-xs px-3 py-1.5 rounded font-medium"
                      style={{ backgroundColor: '#0073BB', color: '#fff', border: 'none', cursor: 'pointer' }}
                    >
                      Pick site
                    </button>
                  )}
                  {conn && !isPending && (
                    <button
                      onClick={() => disconnect(conn.id)}
                      className="text-xs px-3 py-1.5 rounded font-medium"
                      style={{ backgroundColor: 'transparent', color: '#D13212', border: '1px solid #D5DBDB', cursor: 'pointer' }}
                    >
                      Disconnect
                    </button>
                  )}
                  {!conn && (
                    <a
                      href={googleConfigured ? `/api/seo/oauth/start?company_id=${co.id}` : undefined}
                      className="text-xs px-3 py-1.5 rounded font-medium"
                      style={{
                        backgroundColor: googleConfigured ? '#0073BB' : '#E9EAEB',
                        color: googleConfigured ? '#fff' : '#AAB5BB',
                        border: 'none', textDecoration: 'none', display: 'inline-block',
                        cursor: googleConfigured ? 'pointer' : 'not-allowed',
                        pointerEvents: googleConfigured ? 'auto' : 'none',
                      }}
                    >
                      Connect
                    </a>
                  )}
                </div>
              </div>
            )
          })}
          {companies.length === 0 && (
            <p className="text-sm text-center py-6" style={{ color: 'var(--text3)' }}>No companies yet</p>
          )}
        </div>
      )}

      {pickingFor && (
        <>
          <div onClick={() => setPickingFor(null)} className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
          <div className="fixed top-1/2 left-1/2 z-50 rounded p-5" style={{ transform: 'translate(-50%,-50%)', width: 480, backgroundColor: '#fff', boxShadow: '0 12px 32px rgba(0,0,0,0.2)' }}>
            <p className="text-sm font-semibold mb-3" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>Pick a verified property</p>
            {sitesLoading ? (
              <p className="text-sm" style={{ color: 'var(--text3)' }}>Loading…</p>
            ) : (verifiedSitesData?.sites ?? []).length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text3)' }}>No verified properties found on this Google account. Verify the site in Search Console first.</p>
            ) : (
              <div className="space-y-1 mb-3">
                {(verifiedSitesData?.sites ?? []).map((s) => (
                  <button
                    key={s.siteUrl}
                    onClick={() => pickSite(pickingFor, s.siteUrl)}
                    className="w-full text-left text-sm px-3 py-2 rounded font-mono"
                    style={{ border: '1px solid #D5DBDB', background: '#fff', cursor: 'pointer' }}
                  >
                    {s.siteUrl}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setPickingFor(null)} className="text-xs px-3 py-1.5 rounded" style={{ border: '1px solid #D5DBDB', background: '#fff', cursor: 'pointer', color: 'var(--text2)' }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Modules Tab ──────────────────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  finance:      'Finance',
  mentor:       'Mentor Council',
  sales:        'Sales',
  hiring:       'Hiring',
  campaigns:    'Campaigns',
  blog:         'Blog',
  seo:          'SEO',
  social:       'Social',
  documents:    'Documents',
  email_studio: 'Email Studio',
  subscribers:  'Subscribers',
  templates:    'Templates',
  work:         'Work',
  goals:        'Goals',
  rnd:          'R&D',
  audit:        'Audit',
  settings:     'Settings',
  legal:        'Legal',
}

const MODULE_ROLE_HINTS: Record<string, string> = {
  finance:      'CEO only',
  mentor:       'CEO only',
  sales:        'CEO, COO, CTO',
  hiring:       'CEO, COO, CTO',
  campaigns:    'CEO, COO',
  blog:         'CEO, COO, CTO',
  seo:          'CEO, COO, CTO',
  social:       'CEO, COO',
  documents:    'CEO, COO, CTO',
  email_studio: 'CEO, COO',
  subscribers:  'CEO, COO',
  templates:    'CEO, COO, CTO',
  work:         'CEO, COO, CTO',
  goals:        'CEO, COO, CTO',
  rnd:          'CEO, COO, CTO',
  audit:        'CEO only',
  settings:     'CEO only',
  legal:        'CEO, COO',
}

const ALL_MODULE_KEYS = Object.keys(MODULE_LABELS)

interface CompanyModules {
  companyId: string
  companyName: string
  modules: Record<string, boolean>
}

function ModulesTab() {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<{ modules: CompanyModules[] }>({
    queryKey: ['settings-modules'],
    queryFn: () => fetch('/api/settings/modules', { credentials: 'include' }).then((r) => r.json()),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ companyId, moduleKey, is_enabled }: { companyId: string; moduleKey: string; is_enabled: boolean }) =>
      fetch(`/api/settings/modules/${companyId}/${moduleKey}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled }),
      }).then((r) => { if (!r.ok) throw new Error('Failed to update module'); return r.json() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-modules'] }),
  })

  const rows = data?.modules ?? []

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return <p style={{ color: 'var(--text2)', fontSize: '0.875rem' }}>No companies found.</p>
  }

  return (
    <div>
      <p className="mb-4 text-sm" style={{ color: 'var(--text2)' }}>
        Toggle CBOP modules on or off per company. Disabling a module blocks access to its routes
        for all users of that company (creator always bypasses). Role column shows the minimum
        role required when the module is enabled.
      </p>

      {rows.map((company) => (
        <div key={company.companyId} className="mb-8">
          <h3
            className="mb-3 text-sm font-semibold"
            style={{ color: 'var(--text1)', fontFamily: 'var(--font-syne),sans-serif' }}
          >
            {company.companyName}
          </h3>
          <div
            style={{
              border: '1px solid #D5DBDB',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#F8F9FA', borderBottom: '1px solid #D5DBDB' }}>
                  <th
                    style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text2)', width: '40%' }}
                  >
                    Module
                  </th>
                  <th
                    style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text2)', width: '40%' }}
                  >
                    Allowed Roles
                  </th>
                  <th
                    style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 600, color: 'var(--text2)', width: '20%' }}
                  >
                    Enabled
                  </th>
                </tr>
              </thead>
              <tbody>
                {ALL_MODULE_KEYS.map((key, idx) => {
                  const isEnabled = company.modules[key] ?? true
                  const isPending = toggleMutation.isPending && (toggleMutation.variables as { companyId: string; moduleKey: string } | undefined)?.companyId === company.companyId && (toggleMutation.variables as { companyId: string; moduleKey: string } | undefined)?.moduleKey === key
                  return (
                    <tr
                      key={key}
                      style={{
                        borderBottom: idx < ALL_MODULE_KEYS.length - 1 ? '1px solid #F2F3F3' : 'none',
                        backgroundColor: isEnabled ? '#fff' : '#FAFAFA',
                        opacity: isPending ? 0.6 : 1,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <td style={{ padding: '10px 14px', color: isEnabled ? 'var(--text1)' : 'var(--text2)', fontWeight: isEnabled ? 500 : 400 }}>
                        {MODULE_LABELS[key] ?? key}
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--text2)', fontFamily: 'var(--font-mono),monospace', fontSize: '0.75rem' }}>
                        {MODULE_ROLE_HINTS[key] ?? '—'}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <button
                          disabled={isPending}
                          onClick={() => toggleMutation.mutate({ companyId: company.companyId, moduleKey: key, is_enabled: !isEnabled })}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '44px',
                            height: '24px',
                            borderRadius: '12px',
                            border: 'none',
                            cursor: isPending ? 'not-allowed' : 'pointer',
                            backgroundColor: isEnabled ? '#1D8102' : '#D5DBDB',
                            transition: 'background-color 0.2s',
                            position: 'relative',
                          }}
                          title={isEnabled ? 'Click to disable' : 'Click to enable'}
                        >
                          <span
                            style={{
                              display: 'block',
                              width: '18px',
                              height: '18px',
                              borderRadius: '50%',
                              backgroundColor: '#fff',
                              position: 'absolute',
                              left: isEnabled ? 'calc(100% - 21px)' : '3px',
                              transition: 'left 0.2s',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            }}
                          />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Shared helpers for studios ────────────────────────────────────────────────

const SIGNATURE_VARS = ['{{sender_name}}', '{{company_name}}', '{{role}}', '{{phone}}', '{{email}}', '{{website}}']

const EMAIL_TEMPLATE_VARS = [
  '{{recipient_name}}', '{{sender_name}}', '{{company_name}}', '{{role}}',
  '{{subject}}', '{{date}}', '{{link}}', '{{phone}}',
]

function VarChips({ vars, onInsert }: { vars: string[]; onInsert: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 mb-2">
      <span className="text-xs self-center mr-1" style={{ color: 'var(--text3)' }}>Insert:</span>
      {vars.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onInsert(v)}
          className="text-xs px-1.5 py-0.5 rounded transition-colors"
          style={{ backgroundColor: '#EBF5FB', color: '#0073BB', fontFamily: 'var(--font-mono)', border: 'none', cursor: 'pointer' }}
          title="Click to insert"
        >
          {v}
        </button>
      ))}
    </div>
  )
}

function HtmlPreview({ html }: { html: string }) {
  if (!html.trim()) {
    return (
      <div className="mt-3 rounded p-3 text-xs" style={{ border: '1px dashed #D5DBDB', color: 'var(--text3)', textAlign: 'center', minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Preview will appear here
      </div>
    )
  }
  return (
    <div
      className="mt-3 rounded p-4"
      style={{ border: '1px solid #D5DBDB', background: '#FAFBFB', minHeight: 60, fontSize: '0.875rem', lineHeight: 1.7, color: '#374151', overflow: 'auto' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function ConfirmDelete({ label, onConfirm, onCancel }: { label: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="px-3 py-2 rounded text-sm flex items-center gap-3" style={{ backgroundColor: '#FFF3F3', border: '1px solid #F5C6C0' }}>
      <span style={{ color: '#D13212', flex: 1 }}>Delete &ldquo;{label}&rdquo;?</span>
      <button onClick={onConfirm} className="px-3 py-1 rounded text-white text-xs" style={{ backgroundColor: '#D13212' }}>Delete</button>
      <button onClick={onCancel} className="px-3 py-1 rounded text-xs" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>Cancel</button>
    </div>
  )
}

// ── Signatures Tab ────────────────────────────────────────────────────────────

function SignaturesTab() {
  const qc = useQueryClient()
  const [soOpen, setSoOpen]     = useState(false)
  const [editing, setEditing]   = useState<EmailSignature | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: sigsData, isLoading } = useQuery<{ signatures: EmailSignature[] }>({
    queryKey: ['settings-signatures'],
    queryFn: () => fetch('/api/settings/signatures', { credentials: 'include' }).then((r) => r.json()),
  })
  const { data: coData } = useQuery<{ companies: { id: string; name: string }[] }>({
    queryKey: ['settings-companies'],
    queryFn: () => fetch('/api/settings/companies', { credentials: 'include' }).then((r) => r.json()),
  })

  const sigs      = sigsData?.signatures ?? []
  const companies = coData?.companies ?? []

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/settings/signatures/${id}`, { method: 'DELETE', credentials: 'include' }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings-signatures'] }); setDeleteId(null) },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Company email signatures with variable support. Set a default per company.
        </p>
        <button
          onClick={() => setSoOpen(true)}
          className="text-sm px-3 py-1.5 rounded text-white"
          style={{ backgroundColor: 'var(--blue)' }}
        >
          + New Signature
        </button>
      </div>

      {deleteId && (
        <div className="mb-3">
          <ConfirmDelete
            label={sigs.find((s) => s.id === deleteId)?.name ?? ''}
            onConfirm={() => deleteMut.mutate(deleteId)}
            onCancel={() => setDeleteId(null)}
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />)}
        </div>
      ) : sigs.length === 0 ? (
        <p className="text-sm text-center py-12" style={{ color: 'var(--text3)' }}>
          No signatures yet. Create one to use in your outgoing emails.
        </p>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: '1px solid #D5DBDB' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#F8F9FA', borderBottom: '1px solid #D5DBDB' }}>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Name</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Company</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Variables</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Default</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sigs.map((sig, i) => (
                <tr
                  key={sig.id}
                  className="hover:bg-gray-50 transition-colors"
                  style={{ borderBottom: i < sigs.length - 1 ? '1px solid #D5DBDB' : undefined }}
                >
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text1)', cursor: 'pointer' }} onClick={() => setEditing(sig)}>
                    {sig.name}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text2)' }}>
                    {sig.company_name ?? 'All companies'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(sig.variables ?? []).slice(0, 4).map((v) => (
                        <span key={v} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#EBF5FB', color: '#0073BB', fontFamily: 'var(--font-mono)' }}>
                          {v}
                        </span>
                      ))}
                      {(sig.variables ?? []).length > 4 && (
                        <span className="text-xs" style={{ color: 'var(--text3)' }}>+{(sig.variables ?? []).length - 4}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {sig.is_default && (
                      <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#1D810218', color: '#1D8102' }}>Default</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                    {fmtDate(sig.updated_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditing(sig)} className="text-xs px-2 py-1 rounded" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>Edit</button>
                      <button onClick={() => setDeleteId(sig.id)} className="text-xs px-2 py-1 rounded" style={{ border: '1px solid #D5DBDB', color: '#D13212' }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SignatureSlideOver
        open={soOpen || !!editing}
        signature={editing}
        companies={companies}
        onClose={() => { setSoOpen(false); setEditing(null) }}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['settings-signatures'] })
          setSoOpen(false)
          setEditing(null)
        }}
      />
    </div>
  )
}

function SignatureSlideOver({
  open, signature, companies, onClose, onSuccess,
}: {
  open: boolean
  signature: EmailSignature | null
  companies: { id: string; name: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const isEdit = !!signature
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const [form, setForm] = useState({
    name: '', company_id: '', html: '', is_default: false, variables: [] as string[],
  })
  const [err, setErr] = useState('')

  useEffect(() => {
    if (signature) {
      setForm({
        name:       signature.name,
        company_id: signature.company_id ?? '',
        html:       signature.html,
        is_default: signature.is_default,
        variables:  signature.variables ?? [],
      })
    } else {
      setForm({ name: '', company_id: companies[0]?.id ?? '', html: '', is_default: false, variables: [] })
    }
    setErr('')
  }, [signature, companies])

  function insertVar(v: string) {
    const el = bodyRef.current
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end   = el.selectionEnd   ?? el.value.length
    const newVal = el.value.slice(0, start) + v + el.value.slice(end)
    setForm((f) => ({ ...f, html: newVal }))
    // Extract vars from html
    const found = [...new Set(newVal.match(/\{\{[a-z_]+\}\}/g) ?? [])]
    setForm((f) => ({ ...f, html: newVal, variables: found }))
    setTimeout(() => {
      if (bodyRef.current) {
        bodyRef.current.selectionStart = start + v.length
        bodyRef.current.selectionEnd   = start + v.length
        bodyRef.current.focus()
      }
    }, 0)
  }

  function handleHtmlChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val   = e.target.value
    const found = [...new Set(val.match(/\{\{[a-z_]+\}\}/g) ?? [])]
    setForm((f) => ({ ...f, html: val, variables: found }))
  }

  const mutation = useMutation({
    mutationFn: (data: typeof form) => {
      const url    = isEdit ? `/api/settings/signatures/${signature!.id}` : '/api/settings/signatures'
      const method = isEdit ? 'PATCH' : 'POST'
      return fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...data,
          company_id: data.company_id || null,
        }),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }
        return r.json()
      })
    },
    onSuccess,
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <SlideOver open={open} onClose={onClose} title={isEdit ? `Edit — ${signature?.name}` : 'New Email Signature'}>
      {err && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#FFF3F3', color: '#D13212', border: '1px solid #F5C6C0' }}>{err}</div>
      )}

      <Field label="Signature name *">
        <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bala — Etherence IT" />
      </Field>

      <Field label="Company">
        <select style={selectStyle} value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
          <option value="">All companies (global)</option>
          {companies.map((co) => (
            <option key={co.id} value={co.id}>{co.name}</option>
          ))}
        </select>
      </Field>

      <div className="mb-4">
        <label className="block mb-1 text-xs font-medium" style={{ color: 'var(--text2)' }}>HTML body</label>
        <VarChips vars={SIGNATURE_VARS} onInsert={insertVar} />
        <textarea
          ref={bodyRef}
          value={form.html}
          onChange={handleHtmlChange}
          rows={8}
          placeholder="<p>Best regards,<br><strong>{{sender_name}}</strong><br>{{role}} — {{company_name}}<br>{{phone}}</p>"
          style={{
            ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical',
            fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: 1.6,
          }}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>HTML is supported. Variables in &#123;&#123;double_braces&#125;&#125; are replaced at send time.</p>
      </div>

      <div className="mb-4">
        <label className="block mb-1 text-xs font-medium" style={{ color: 'var(--text2)' }}>Live preview</label>
        <HtmlPreview html={form.html} />
      </div>

      <div className="mb-4 flex items-center gap-2">
        <input
          type="checkbox"
          id="sig-default"
          checked={form.is_default}
          onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
        />
        <label htmlFor="sig-default" className="text-sm cursor-pointer" style={{ color: 'var(--text1)' }}>
          Set as default signature for this company
        </label>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending || !form.name.trim()}
          className="flex-1 py-2 rounded text-sm text-white"
          style={{ backgroundColor: 'var(--blue)', opacity: mutation.isPending ? 0.6 : 1 }}
        >
          {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Signature'}
        </button>
        <button onClick={onClose} className="px-4 py-2 rounded text-sm" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>
          Cancel
        </button>
      </div>
    </SlideOver>
  )
}

// ── Email Templates Tab ───────────────────────────────────────────────────────

const EMAIL_TEMPLATE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'transactional', label: 'Transactional' },
  { value: 'marketing',     label: 'Marketing' },
  { value: 'hiring',        label: 'Hiring' },
  { value: 'notification',  label: 'Notification' },
  { value: 'other',         label: 'Other' },
]

function EmailTemplatesTab() {
  const qc = useQueryClient()
  const [soOpen, setSoOpen]     = useState(false)
  const [editing, setEditing]   = useState<TemplateItem | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [filter, setFilter]     = useState('')

  const { data, isLoading } = useQuery<{ templates: TemplateItem[] }>({
    queryKey: ['settings-email-templates'],
    queryFn: () =>
      fetch('/api/settings/templates?output_type=email', { credentials: 'include' }).then((r) => r.json()),
  })
  const { data: coData } = useQuery<{ companies: { id: string; name: string }[] }>({
    queryKey: ['settings-companies'],
    queryFn: () => fetch('/api/settings/companies', { credentials: 'include' }).then((r) => r.json()),
  })

  const all       = data?.templates ?? []
  const templates = filter
    ? all.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()) || (t.subject ?? '').toLowerCase().includes(filter.toLowerCase()))
    : all
  const companies = coData?.companies ?? []

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/settings/templates/${id}`, { method: 'DELETE', credentials: 'include' }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings-email-templates'] }); setDeleteId(null) },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Email templates for notifications, hiring, and transactional sends.
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter templates…"
            style={{ ...inputStyle, width: 180 }}
          />
          <button
            onClick={() => setSoOpen(true)}
            className="text-sm px-3 py-1.5 rounded text-white whitespace-nowrap"
            style={{ backgroundColor: 'var(--blue)' }}
          >
            + New Template
          </button>
        </div>
      </div>

      {deleteId && (
        <div className="mb-3">
          <ConfirmDelete
            label={all.find((t) => t.id === deleteId)?.name ?? ''}
            onConfirm={() => deleteMut.mutate(deleteId)}
            onCancel={() => setDeleteId(null)}
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />)}
        </div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-center py-12" style={{ color: 'var(--text3)' }}>
          {filter ? 'No templates match your filter.' : 'No email templates yet. Create one to use in automated sends.'}
        </p>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: '1px solid #D5DBDB' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#F8F9FA', borderBottom: '1px solid #D5DBDB' }}>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Name</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Subject</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Category</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Company</th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {templates.map((t, i) => (
                <tr
                  key={t.id}
                  className="hover:bg-gray-50 transition-colors"
                  style={{ borderBottom: i < templates.length - 1 ? '1px solid #D5DBDB' : undefined }}
                >
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text1)', cursor: 'pointer' }} onClick={() => setEditing(t)}>
                    {t.name}
                    {t.slug && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>#{t.slug}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text2)', maxWidth: 200 }}>
                    <span className="truncate block">{t.subject || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    {t.category && (
                      <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#0073BB18', color: '#0073BB' }}>
                        {t.category}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text2)' }}>{t.company_name}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                    {fmtDate(t.updated_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditing(t)} className="text-xs px-2 py-1 rounded" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>Edit</button>
                      <button onClick={() => setDeleteId(t.id)} className="text-xs px-2 py-1 rounded" style={{ border: '1px solid #D5DBDB', color: '#D13212' }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EmailTemplateSlideOver
        open={soOpen || !!editing}
        template={editing}
        companies={companies}
        onClose={() => { setSoOpen(false); setEditing(null) }}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['settings-email-templates'] })
          setSoOpen(false)
          setEditing(null)
        }}
      />
    </div>
  )
}

function EmailTemplateSlideOver({
  open, template, companies, onClose, onSuccess,
}: {
  open: boolean
  template: TemplateItem | null
  companies: { id: string; name: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const isEdit  = !!template
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [form, setForm] = useState({
    name: '', company_id: '', subject: '', category: '', content: '', variables: [] as string[],
  })
  const [preview, setPreview] = useState(false)
  const [err, setErr]         = useState('')

  useEffect(() => {
    if (template) {
      setForm({
        name:       template.name,
        company_id: template.company_id,
        subject:    template.subject ?? '',
        category:   template.category ?? '',
        content:    '',
        variables:  template.variables ?? [],
      })
    } else {
      setForm({ name: '', company_id: companies[0]?.id ?? '', subject: '', category: 'transactional', content: '', variables: [] })
    }
    setPreview(false)
    setErr('')
  }, [template, companies])

  function insertVar(v: string) {
    const el = bodyRef.current
    if (!el) return
    const start  = el.selectionStart ?? el.value.length
    const end    = el.selectionEnd   ?? el.value.length
    const newVal = el.value.slice(0, start) + v + el.value.slice(end)
    const found  = [...new Set(newVal.match(/\{\{[a-z_]+\}\}/g) ?? [])]
    setForm((f) => ({ ...f, content: newVal, variables: found }))
  }

  function handleBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val  = e.target.value
    const found = [...new Set(val.match(/\{\{[a-z_]+\}\}/g) ?? [])]
    setForm((f) => ({ ...f, content: val, variables: found }))
  }

  const mutation = useMutation({
    mutationFn: (data: typeof form) => {
      if (isEdit) {
        return fetch(`/api/settings/templates/${template!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: data.name, subject: data.subject, category: data.category,
            ...(data.content ? { content: data.content, variables: data.variables } : {}),
          }),
        }).then(async (r) => { if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }; return r.json() })
      }
      return fetch('/api/settings/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name, company_id: data.company_id, output_type: 'email',
          type: 'email', subject: data.subject, category: data.category,
          content: data.content, variables: data.variables,
        }),
      }).then(async (r) => { if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }; return r.json() })
    },
    onSuccess,
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit — ${template?.name}` : 'New Email Template'}
    >
      {err && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#FFF3F3', color: '#D13212', border: '1px solid #F5C6C0' }}>{err}</div>
      )}

      <Field label="Template name *">
        <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Invoice Payment Reminder" />
      </Field>

      {!isEdit && (
        <Field label="Company *">
          <select style={selectStyle} value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
            <option value="">— select —</option>
            {companies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
          </select>
        </Field>
      )}

      <Field label="Subject line">
        <input style={inputStyle} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Invoice &#123;&#123;invoice_number&#125;&#125; — Payment Due" />
      </Field>

      <Field label="Category">
        <select style={selectStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          <option value="">— select —</option>
          {EMAIL_TEMPLATE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </Field>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium" style={{ color: 'var(--text2)' }}>Body{isEdit ? ' (leave blank to keep existing)' : ''}</label>
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            className="text-xs px-2 py-1 rounded"
            style={{ border: '1px solid #D5DBDB', color: 'var(--text2)', background: preview ? '#F2F3F3' : '#fff' }}
          >
            {preview ? 'Edit' : 'Preview'}
          </button>
        </div>

        {!preview ? (
          <>
            <VarChips vars={EMAIL_TEMPLATE_VARS} onInsert={insertVar} />
            <textarea
              ref={bodyRef}
              value={form.content}
              onChange={handleBodyChange}
              rows={10}
              placeholder="Dear {{recipient_name}},&#10;&#10;This is a reminder that your invoice is due on {{date}}..."
              style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical', lineHeight: 1.7, fontSize: '0.85rem' }}
            />
          </>
        ) : (
          <HtmlPreview html={form.content} />
        )}
      </div>

      {(form.variables.length > 0) && (
        <div className="mb-4 px-3 py-2 rounded text-xs" style={{ backgroundColor: '#F8F9FA', border: '1px solid #E5E7EB', color: 'var(--text2)' }}>
          Detected variables: {form.variables.join(', ')}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending || !form.name.trim() || (!isEdit && !form.company_id)}
          className="flex-1 py-2 rounded text-sm text-white"
          style={{ backgroundColor: 'var(--blue)', opacity: mutation.isPending ? 0.6 : 1 }}
        >
          {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Template'}
        </button>
        <button onClick={onClose} className="px-4 py-2 rounded text-sm" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>
          Cancel
        </button>
      </div>
    </SlideOver>
  )
}

// ── Automation Tab ────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<TriggerType, string> = {
  'project.completed': 'Project completed',
  'deal.closed_won':   'Deal closed (won)',
  'invoice.paid':      'Invoice paid',
  'lead.created':      'Lead created',
}

const ACTION_LABELS: Record<ActionType, string> = {
  generate_certificate: 'Generate certificate PDF',
  send_email:           'Send email',
  create_task:          'Create task',
  notify_team:          'Notify team',
}

const TRIGGER_COLORS: Record<TriggerType, string> = {
  'project.completed': '#1D8102',
  'deal.closed_won':   '#0073BB',
  'invoice.paid':      '#E8820C',
  'lead.created':      '#8B5CF6',
}

const ACTION_COLORS: Record<ActionType, string> = {
  generate_certificate: '#E8820C',
  send_email:           '#0073BB',
  create_task:          '#1D8102',
  notify_team:          '#8B5CF6',
}

// ── Morning Briefing Config Block ─────────────────────────────────────────────

function MorningBriefingConfig() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <BriefingDialog open={open} onClose={() => setOpen(false)} />
      <div style={{ border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden', marginBottom: 28 }}>
        <div style={{ padding: '14px 16px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#1E293B', margin: 0, fontFamily: 'var(--font-inter)' }}>Morning Briefing</p>
            <p style={{ fontSize: 12, color: '#64748B', margin: '2px 0 0', fontFamily: 'var(--font-inter)' }}>
              Sent at 8:00 AM on weekdays via n8n — tasks, invoices, deals, and automation status per recipient.
            </p>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, background: '#DCFCE7', color: '#15803D', padding: '3px 10px', borderRadius: 10, fontFamily: 'var(--font-inter)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Active</span>
        </div>
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => setOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-inter)' }}
          >
            <Users size={12} />
            Configure &amp; Preview
          </button>
          <p style={{ fontSize: 12, color: '#94A3B8', margin: 0, fontFamily: 'var(--font-inter)' }}>
            Manage recipients, schedule, and per-person content toggles.
          </p>
        </div>
      </div>
    </>
  )
}

// ── Automation Rules Tab ───────────────────────────────────────────────────────

function AutomationTab() {
  const qc = useQueryClient()
  const [soOpen, setSoOpen]     = useState(false)
  const [editing, setEditing]   = useState<AutomationRule | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data, isLoading } = useQuery<{ rules: AutomationRule[] }>({
    queryKey: ['settings-automation-rules'],
    queryFn: () => fetch('/api/settings/automation-rules', { credentials: 'include' }).then((r) => r.json()),
  })
  const { data: coData } = useQuery<{ companies: { id: string; name: string }[] }>({
    queryKey: ['settings-companies'],
    queryFn: () => fetch('/api/settings/companies', { credentials: 'include' }).then((r) => r.json()),
  })

  const rules     = data?.rules ?? []
  const companies = coData?.companies ?? []

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      fetch(`/api/settings/automation-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_active }),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-automation-rules'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/settings/automation-rules/${id}`, { method: 'DELETE', credentials: 'include' }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings-automation-rules'] }); setDeleteId(null) },
  })

  return (
    <div>
      <MorningBriefingConfig />

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Automation rules fire when a trigger event occurs. Each rule has one trigger and one action.
        </p>
        <button
          onClick={() => setSoOpen(true)}
          className="text-sm px-3 py-1.5 rounded text-white"
          style={{ backgroundColor: 'var(--blue)' }}
        >
          + New Rule
        </button>
      </div>

      {deleteId && (
        <div className="mb-3">
          <ConfirmDelete
            label={rules.find((r) => r.id === deleteId)?.name ?? ''}
            onConfirm={() => deleteMut.mutate(deleteId)}
            onCancel={() => setDeleteId(null)}
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />)}
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm mb-2" style={{ color: 'var(--text3)' }}>No automation rules yet.</p>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Example: when a project is completed → auto-generate a certificate PDF and email it to the client.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="rounded p-4"
              style={{
                border: '1px solid #D5DBDB',
                backgroundColor: '#fff',
                opacity: rule.is_active ? 1 : 0.65,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div style={{ flex: 1 }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--text1)' }}>{rule.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#F2F3F3', color: 'var(--text3)' }}>
                      {rule.company_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-xs px-2 py-1 rounded font-medium"
                      style={{ backgroundColor: TRIGGER_COLORS[rule.trigger_type] + '18', color: TRIGGER_COLORS[rule.trigger_type] }}
                    >
                      When: {TRIGGER_LABELS[rule.trigger_type]}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text3)' }}>→</span>
                    <span
                      className="text-xs px-2 py-1 rounded font-medium"
                      style={{ backgroundColor: ACTION_COLORS[rule.action_type] + '18', color: ACTION_COLORS[rule.action_type] }}
                    >
                      Then: {ACTION_LABELS[rule.action_type]}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Active toggle */}
                  <button
                    onClick={() => toggleMut.mutate({ id: rule.id, is_active: !rule.is_active })}
                    disabled={toggleMut.isPending}
                    className="text-xs px-3 py-1 rounded"
                    style={{
                      border: `1px solid ${rule.is_active ? '#1D8102' : '#D5DBDB'}`,
                      color: rule.is_active ? '#1D8102' : 'var(--text3)',
                      backgroundColor: rule.is_active ? '#1D810208' : '#fff',
                    }}
                  >
                    {rule.is_active ? 'Active' : 'Inactive'}
                  </button>
                  <button onClick={() => setEditing(rule)} className="text-xs px-2 py-1 rounded" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>Edit</button>
                  <button onClick={() => setDeleteId(rule.id)} className="text-xs px-2 py-1 rounded" style={{ border: '1px solid #D5DBDB', color: '#D13212' }}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AutomationRuleSlideOver
        open={soOpen || !!editing}
        rule={editing}
        companies={companies}
        onClose={() => { setSoOpen(false); setEditing(null) }}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['settings-automation-rules'] })
          setSoOpen(false)
          setEditing(null)
        }}
      />
    </div>
  )
}

function AutomationRuleSlideOver({
  open, rule, companies, onClose, onSuccess,
}: {
  open: boolean
  rule: AutomationRule | null
  companies: { id: string; name: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const isEdit = !!rule
  const [form, setForm] = useState<{
    name: string
    company_id: string
    trigger_type: TriggerType
    action_type: ActionType
    is_active: boolean
    action_config: {
      template_id: string
      email_field: string
      task_title: string
      notify_channel: string
      notify_message: string
    }
  }>({
    name: '', company_id: '', trigger_type: 'project.completed', action_type: 'generate_certificate',
    is_active: true,
    action_config: { template_id: '', email_field: 'client_email', task_title: '', notify_channel: '', notify_message: '' },
  })
  const [err, setErr] = useState('')

  useEffect(() => {
    if (rule) {
      const cfg = (rule.action_config ?? {}) as Record<string, string>
      setForm({
        name:         rule.name,
        company_id:   rule.company_id,
        trigger_type: rule.trigger_type,
        action_type:  rule.action_type,
        is_active:    rule.is_active,
        action_config: {
          template_id:     cfg.template_id     ?? '',
          email_field:     cfg.email_field     ?? 'client_email',
          task_title:      cfg.task_title      ?? '',
          notify_channel:  cfg.notify_channel  ?? '',
          notify_message:  cfg.notify_message  ?? '',
        },
      })
    } else {
      setForm({
        name: '', company_id: companies[0]?.id ?? '',
        trigger_type: 'project.completed', action_type: 'generate_certificate',
        is_active: true,
        action_config: { template_id: '', email_field: 'client_email', task_title: '', notify_channel: '', notify_message: '' },
      })
    }
    setErr('')
  }, [rule, companies])

  const mutation = useMutation({
    mutationFn: (data: typeof form) => {
      const payload = {
        name:              data.name,
        company_id:        data.company_id,
        trigger_type:      data.trigger_type,
        trigger_condition: {},
        action_type:       data.action_type,
        action_config:     data.action_config,
        is_active:         data.is_active,
      }
      if (isEdit) {
        return fetch(`/api/settings/automation-rules/${rule!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        }).then(async (r) => { if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }; return r.json() })
      }
      return fetch('/api/settings/automation-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      }).then(async (r) => { if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }; return r.json() })
    },
    onSuccess,
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit Rule — ${rule?.name}` : 'New Automation Rule'}
    >
      {err && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#FFF3F3', color: '#D13212', border: '1px solid #F5C6C0' }}>{err}</div>
      )}

      <Field label="Rule name *">
        <input
          style={inputStyle}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Auto-generate certificate on project completion"
        />
      </Field>

      {!isEdit && (
        <Field label="Company *">
          <select style={selectStyle} value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
            <option value="">— select —</option>
            {companies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
          </select>
        </Field>
      )}

      {/* Trigger */}
      <div className="mb-5 p-4 rounded" style={{ border: '1px solid #D5DBDB', backgroundColor: '#FAFBFB' }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text2)' }}>
          Trigger — When this happens
        </h3>
        <Field label="Event">
          <select
            style={selectStyle}
            value={form.trigger_type}
            onChange={(e) => setForm({ ...form, trigger_type: e.target.value as TriggerType })}
          >
            {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((k) => (
              <option key={k} value={k}>{TRIGGER_LABELS[k]}</option>
            ))}
          </select>
        </Field>
        <div
          className="mt-2 px-3 py-2 rounded text-xs"
          style={{ backgroundColor: TRIGGER_COLORS[form.trigger_type] + '10', color: TRIGGER_COLORS[form.trigger_type], border: `1px solid ${TRIGGER_COLORS[form.trigger_type]}30` }}
        >
          Fires when a <strong>{form.trigger_type.split('.')[0]}</strong> reaches{' '}
          <strong>{form.trigger_type.split('.')[1]?.replace(/_/g, ' ')}</strong> status.
        </div>
      </div>

      {/* Action */}
      <div className="mb-5 p-4 rounded" style={{ border: '1px solid #D5DBDB', backgroundColor: '#FAFBFB' }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text2)' }}>
          Action — Do this
        </h3>
        <Field label="Action type">
          <select
            style={selectStyle}
            value={form.action_type}
            onChange={(e) => setForm({ ...form, action_type: e.target.value as ActionType })}
          >
            {(Object.keys(ACTION_LABELS) as ActionType[]).map((k) => (
              <option key={k} value={k}>{ACTION_LABELS[k]}</option>
            ))}
          </select>
        </Field>

        {/* Dynamic config fields based on action_type */}
        {(form.action_type === 'generate_certificate' || form.action_type === 'send_email') && (
          <Field label="Template ID (optional)">
            <input
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
              value={form.action_config.template_id}
              onChange={(e) => setForm((f) => ({ ...f, action_config: { ...f.action_config, template_id: e.target.value } }))}
              placeholder="UUID of a template record"
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
              Copy from the Templates page. Leave blank to generate with default layout.
            </p>
          </Field>
        )}
        {(form.action_type === 'generate_certificate' || form.action_type === 'send_email') && (
          <Field label="Email recipient field">
            <input
              style={inputStyle}
              value={form.action_config.email_field}
              onChange={(e) => setForm((f) => ({ ...f, action_config: { ...f.action_config, email_field: e.target.value } }))}
              placeholder="client_email"
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
              Name of the field on the trigger record that holds the recipient email.
            </p>
          </Field>
        )}
        {form.action_type === 'create_task' && (
          <Field label="Task title template">
            <input
              style={inputStyle}
              value={form.action_config.task_title}
              onChange={(e) => setForm((f) => ({ ...f, action_config: { ...f.action_config, task_title: e.target.value } }))}
              placeholder="Follow up on {{project_name}} completion"
            />
          </Field>
        )}
        {form.action_type === 'notify_team' && (
          <>
            <Field label="Notification channel">
              <input
                style={inputStyle}
                value={form.action_config.notify_channel}
                onChange={(e) => setForm((f) => ({ ...f, action_config: { ...f.action_config, notify_channel: e.target.value } }))}
                placeholder="telegram"
              />
            </Field>
            <Field label="Message template">
              <textarea
                value={form.action_config.notify_message}
                onChange={(e) => setForm((f) => ({ ...f, action_config: { ...f.action_config, notify_message: e.target.value } }))}
                rows={3}
                placeholder="Project {{project_name}} has been completed."
                style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'none' }}
              />
            </Field>
          </>
        )}
      </div>

      {/* Active toggle */}
      <div className="mb-4 flex items-center gap-2">
        <input
          type="checkbox"
          id="rule-active"
          checked={form.is_active}
          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
        />
        <label htmlFor="rule-active" className="text-sm cursor-pointer" style={{ color: 'var(--text1)' }}>
          Rule is active (will fire on trigger events)
        </label>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending || !form.name.trim() || (!isEdit && !form.company_id)}
          className="flex-1 py-2 rounded text-sm text-white"
          style={{ backgroundColor: 'var(--blue)', opacity: mutation.isPending ? 0.6 : 1 }}
        >
          {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Rule'}
        </button>
        <button onClick={onClose} className="px-4 py-2 rounded text-sm" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>
          Cancel
        </button>
      </div>
    </SlideOver>
  )
}

// ── Roles & Access Tab (creator only) ────────────────────────────────────────

const PERM_MODULE_LABELS: Record<string, string> = {
  finance:      'Finance',
  mentor:       'Mentor Council',
  sales:        'Sales',
  hiring:       'Hiring',
  campaigns:    'Campaigns',
  blog:         'Blog',
  seo:          'SEO',
  social:       'Social',
  documents:    'Documents',
  email_studio: 'Email Studio',
  subscribers:  'Subscribers',
  templates:    'Templates',
  work:         'Work',
  goals:        'Goals',
  rnd:          'R&D',
  audit:        'Audit',
  settings:     'Settings',
  legal:        'Legal',
}

const PERM_MODULE_KEYS = Object.keys(PERM_MODULE_LABELS)

function RolesTab() {
  const qc = useQueryClient()
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [selectedRole, setSelectedRole]           = useState<CompanyRole | null>(null)
  const [newRoleOpen, setNewRoleOpen]             = useState(false)
  const [permissions, setPermissions] = useState<Record<string, { can_read: boolean; can_write: boolean }>>({})
  const [permSaved, setPermSaved]     = useState(false)

  const { data: companiesData } = useQuery<{ companies: { id: string; name: string }[] }>({
    queryKey: ['settings-companies'],
    queryFn: () => fetch('/api/settings/companies', { credentials: 'include' }).then((r) => r.json()),
  })
  const companies = companiesData?.companies ?? []

  useEffect(() => {
    if (companies.length > 0 && !selectedCompanyId) {
      setSelectedCompanyId(companies[0].id)
    }
  }, [companies, selectedCompanyId])

  const { data: rolesData, isLoading: rolesLoading } = useQuery<{ roles: CompanyRole[] }>({
    queryKey: ['settings-roles', selectedCompanyId],
    queryFn: () => fetch(`/api/settings/roles?company_id=${selectedCompanyId}`, { credentials: 'include' }).then((r) => r.json()),
    enabled: !!selectedCompanyId,
  })
  const roles = rolesData?.roles ?? []

  const { data: permData, isLoading: permLoading } = useQuery<{ role_id: string; permissions: Record<string, { can_read: boolean; can_write: boolean }> }>({
    queryKey: ['settings-role-perms', selectedRole?.id],
    queryFn: () => fetch(`/api/settings/roles/${selectedRole!.id}/permissions`, { credentials: 'include' }).then((r) => r.json()),
    enabled: !!selectedRole,
  })

  useEffect(() => {
    if (permData?.permissions) {
      setPermissions(permData.permissions)
      setPermSaved(false)
    }
  }, [permData])

  useEffect(() => {
    if (selectedRole && roles.length > 0 && !roles.find((r) => r.id === selectedRole.id)) {
      setSelectedRole(null)
    }
  }, [roles, selectedRole])

  const savePermsMut = useMutation({
    mutationFn: () =>
      fetch(`/api/settings/roles/${selectedRole!.id}/permissions`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions }),
      }).then(async (r) => { if (!r.ok) throw new Error('Save failed'); return r.json() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-role-perms', selectedRole?.id] })
      setPermSaved(true)
      setTimeout(() => setPermSaved(false), 2000)
    },
  })

  const deleteRoleMut = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/settings/roles/${id}`, { method: 'DELETE', credentials: 'include' })
        .then(async (r) => { if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-roles', selectedCompanyId] })
      setSelectedRole(null)
    },
  })

  function togglePerm(key: string, field: 'can_read' | 'can_write') {
    setPermissions((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: !prev[key]?.[field] },
    }))
    setPermSaved(false)
  }

  return (
    <div>
      {/* Company selector */}
      {companies.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {companies.map((co) => (
            <button
              key={co.id}
              onClick={() => { setSelectedCompanyId(co.id); setSelectedRole(null) }}
              className="px-4 py-1.5 rounded text-sm font-medium transition-colors"
              style={{
                backgroundColor: selectedCompanyId === co.id ? 'var(--blue)' : '#F2F3F3',
                color: selectedCompanyId === co.id ? '#fff' : 'var(--text1)',
                border: '1px solid',
                borderColor: selectedCompanyId === co.id ? 'var(--blue)' : '#D5DBDB',
              }}
            >
              {co.name}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, alignItems: 'start' }}>

        {/* Left panel: Role list */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text2)' }}>Roles</span>
            <button
              onClick={() => setNewRoleOpen(true)}
              className="text-xs px-2 py-1 rounded text-white"
              style={{ backgroundColor: 'var(--blue)' }}
            >
              + New
            </button>
          </div>

          {rolesLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />)}
            </div>
          ) : (
            <div className="space-y-1">
              {roles.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRole(r)}
                  className="w-full text-left px-3 py-2 rounded text-sm transition-colors"
                  style={{
                    backgroundColor: selectedRole?.id === r.id ? '#EBF5FB' : '#fff',
                    border: '1px solid',
                    borderColor: selectedRole?.id === r.id ? '#0073BB' : '#D5DBDB',
                    color: 'var(--text1)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs" style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                      {r.member_count}
                    </span>
                  </div>
                  {r.is_system && (
                    <span className="text-xs" style={{ color: '#8B5CF6' }}>system</span>
                  )}
                </button>
              ))}
              {roles.length === 0 && (
                <p className="text-sm text-center py-4" style={{ color: 'var(--text3)' }}>No roles yet</p>
              )}
            </div>
          )}
        </div>

        {/* Right panel: Permissions matrix */}
        <div>
          {!selectedRole ? (
            <div className="flex items-center justify-center h-40 rounded" style={{ border: '1px dashed #D5DBDB', color: 'var(--text3)', fontSize: '0.875rem' }}>
              Select a role to view its permissions
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold" style={{ fontFamily: 'var(--font-syne),sans-serif', color: 'var(--text1)' }}>
                    {selectedRole.name}
                  </h3>
                  {selectedRole.description && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{selectedRole.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!selectedRole.is_system && (
                    <button
                      onClick={() => { if (confirm(`Delete role "${selectedRole.name}"? Members will lose their role assignment.`)) deleteRoleMut.mutate(selectedRole.id) }}
                      className="text-xs px-3 py-1.5 rounded"
                      style={{ border: '1px solid #D13212', color: '#D13212', background: '#fff', cursor: 'pointer' }}
                    >
                      Delete role
                    </button>
                  )}
                </div>
              </div>

              {permLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map((i) => <div key={i} className="h-10 rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />)}
                </div>
              ) : (
                <>
                  <div className="rounded overflow-hidden mb-4" style={{ border: '1px solid #D5DBDB' }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ backgroundColor: '#F8F9FA', borderBottom: '1px solid #D5DBDB' }}>
                          <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text2)' }}>Module</th>
                          <th className="text-center px-4 py-2 font-medium" style={{ color: 'var(--text2)', width: 80 }}>Read</th>
                          <th className="text-center px-4 py-2 font-medium" style={{ color: 'var(--text2)', width: 80 }}>Write</th>
                        </tr>
                      </thead>
                      <tbody>
                        {PERM_MODULE_KEYS.map((key, idx) => {
                          const perm = permissions[key] ?? { can_read: false, can_write: false }
                          return (
                            <tr
                              key={key}
                              style={{
                                borderBottom: idx < PERM_MODULE_KEYS.length - 1 ? '1px solid #F2F3F3' : 'none',
                                backgroundColor: perm.can_read ? '#fff' : '#FAFAFA',
                              }}
                            >
                              <td className="px-4 py-2" style={{ color: perm.can_read ? 'var(--text1)' : 'var(--text3)', fontWeight: perm.can_read ? 500 : 400 }}>
                                {PERM_MODULE_LABELS[key] ?? key}
                              </td>
                              <td className="px-4 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={perm.can_read}
                                  onChange={() => togglePerm(key, 'can_read')}
                                  style={{ cursor: 'pointer', width: 16, height: 16 }}
                                />
                              </td>
                              <td className="px-4 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={perm.can_write}
                                  disabled={!perm.can_read}
                                  onChange={() => togglePerm(key, 'can_write')}
                                  style={{ cursor: perm.can_read ? 'pointer' : 'not-allowed', width: 16, height: 16, opacity: perm.can_read ? 1 : 0.4 }}
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => savePermsMut.mutate()}
                      disabled={savePermsMut.isPending}
                      className="px-5 py-2 rounded text-sm font-medium text-white flex items-center gap-1.5"
                      style={{ backgroundColor: permSaved ? '#1D8102' : 'var(--blue)', transition: 'background-color 0.2s' }}
                    >
                      {savePermsMut.isPending ? 'Saving…' : permSaved ? <><CheckCircle2 size={14} /> Saved</> : 'Save Permissions'}
                    </button>
                    {savePermsMut.isError && <span className="text-sm" style={{ color: '#D13212' }}>Save failed</span>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* New Role slide-over */}
      <NewRoleSlideOver
        open={newRoleOpen}
        companyId={selectedCompanyId}
        onClose={() => setNewRoleOpen(false)}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['settings-roles', selectedCompanyId] })
          setNewRoleOpen(false)
        }}
      />
    </div>
  )
}

// ── New Role Slide-over ───────────────────────────────────────────────────────

function NewRoleSlideOver({
  open, companyId, onClose, onSuccess,
}: {
  open: boolean
  companyId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [form, setForm] = useState({ name: '', slug: '', description: '' })
  const [err, setErr]   = useState('')

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      fetch('/api/settings/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...data, company_id: companyId }),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed') }
        return r.json()
      }),
    onSuccess,
    onError: (e: Error) => setErr(e.message),
  })

  function reset() {
    setForm({ name: '', slug: '', description: '' })
    setErr('')
  }

  function autoSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  }

  return (
    <SlideOver open={open} onClose={() => { reset(); onClose() }} title="New Role">
      {err && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#F8F9FA', color: '#D13212', border: '1px solid #E5E7EB' }}>{err}</div>
      )}

      <Field label="Role name *">
        <input
          style={inputStyle}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value, slug: autoSlug(e.target.value) })}
          placeholder="Sales Rep"
        />
      </Field>
      <Field label="Slug *">
        <input
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
          placeholder="sales_rep"
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>Lowercase letters, digits, underscores only. Auto-generated from name.</p>
      </Field>
      <Field label="Description">
        <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Manages sales pipeline" />
      </Field>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending || !form.name.trim() || !form.slug.trim()}
          className="flex-1 py-2 rounded text-sm text-white"
          style={{ backgroundColor: 'var(--blue)', opacity: mutation.isPending ? 0.6 : 1 }}
        >
          {mutation.isPending ? 'Creating…' : 'Create Role'}
        </button>
        <button onClick={() => { reset(); onClose() }} className="px-4 py-2 rounded text-sm" style={{ border: '1px solid #D5DBDB', color: 'var(--text2)' }}>
          Cancel
        </button>
      </div>
    </SlideOver>
  )
}

// ── Main Settings Page ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as SettingsTab | null
  const [tab, setTab] = useState<SettingsTab>(tabParam ?? 'team')

  useEffect(() => {
    if (tabParam) setTab(tabParam)
  }, [tabParam])

  const { data: session, isLoading: sessionLoading } = useQuery<SessionUser>({
    queryKey: ['session'],
    queryFn: () => fetch('/api/session', { credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error('Unauthorized')
      return r.json()
    }),
  })

  const role      = session?.role ?? 'cto'
  const isAdmin   = role === 'ceo' || role === 'creator'
  const isCreator = role === 'creator'

  useEffect(() => {
    if (!session) return
    if (tab === 'roles' && !isCreator) setTab('team')
    else if (!isAdmin && tab !== 'team' && tab !== 'jobs') setTab('team')
  }, [session, isAdmin, isCreator, tab])

  const TABS: { id: SettingsTab; label: string; adminOnly?: boolean; creatorOnly?: boolean }[] = [
    { id: 'team',            label: 'Team' },
    { id: 'jobs',            label: 'System Jobs' },
    { id: 'companies',       label: 'Companies',       adminOnly: true },
    { id: 'roles',           label: 'Roles & Access',  creatorOnly: true },
    { id: 'hiring',          label: 'Hiring',          adminOnly: true },
    { id: 'signatures',      label: 'Signatures',      adminOnly: true },
    { id: 'email-templates', label: 'Email Templates', adminOnly: true },
    { id: 'automation',      label: 'Automation',      adminOnly: true },
    { id: 'modules',         label: 'Modules',         adminOnly: true },
    { id: 'integrations',    label: 'Integrations',    adminOnly: true },
    { id: 'seo',             label: 'SEO Connections', adminOnly: true },
  ]

  const visibleTabs = TABS.filter((t) => {
    if (t.creatorOnly) return isCreator
    if (t.adminOnly)   return isAdmin
    return true
  })

  if (sessionLoading) {
    return (
      <div className="p-6">
        <div className="h-7 w-32 rounded animate-pulse mb-6" style={{ backgroundColor: '#E9EAEB' }} />
        <div className="h-10 w-full rounded animate-pulse" style={{ backgroundColor: '#E9EAEB' }} />
      </div>
    )
  }

  if (!session) return null

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
        {tab === 'team'            && <TeamTab userRole={role} />}
        {tab === 'companies'       && <CompaniesTab />}
        {tab === 'roles'           && <RolesTab />}
        {tab === 'hiring'          && <HiringTab />}
        {tab === 'signatures'      && <SignaturesTab />}
        {tab === 'email-templates' && <EmailTemplatesTab />}
        {tab === 'automation'      && <AutomationTab />}
        {tab === 'modules'         && <ModulesTab />}
        {tab === 'jobs'            && <JobsTab />}
        {tab === 'integrations'    && <IntegrationsTab />}
        {tab === 'seo'             && <SeoConnectionsTab />}
      </div>
    </div>
  )
}
