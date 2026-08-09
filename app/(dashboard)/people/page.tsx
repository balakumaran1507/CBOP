'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, Building2, Plus, X, Search, ChevronDown,
  Pencil, UserMinus, User, Phone, Mail, CalendarDays,
  Briefcase, AlertTriangle, CheckCircle2, Clock,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type PeopleTab = 'employees' | 'departments'

type EmploymentType = 'full_time' | 'part_time' | 'contractor' | 'intern'

interface Employee {
  id:              string
  company_id:      string
  company_name:    string
  department_id:   string | null
  department_name: string | null
  user_id:         string | null
  cbop_role:       string | null
  first_name:      string
  last_name:       string
  email:           string
  phone:           string | null
  role_title:      string | null
  employment_type: EmploymentType
  start_date:      string | null
  end_date:        string | null
  is_active:       boolean
  manager_id:      string | null
  manager_name:    string | null
  salary:          number | null
  currency:        string
  notes:           string | null
  created_at:      string
  updated_at:      string
}

interface Department {
  id:             string
  company_id:     string
  company_name:   string
  name:           string
  description:    string | null
  manager_id:     string | null
  manager_name:   string | null
  employee_count: number
  created_at:     string
}

interface Company {
  id:   string
  name: string
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await window.fetch(url, { credentials: 'include', ...opts })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── Formatting helpers ────────────────────────────────────────────────────────

const EMP_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time:   'Full-time',
  part_time:   'Part-time',
  contractor:  'Contractor',
  intern:      'Intern',
}

const EMP_TYPE_STYLE: Record<EmploymentType, string> = {
  full_time:   'bg-blue-50 text-blue-700 border border-blue-200',
  part_time:   'bg-purple-50 text-purple-700 border border-purple-200',
  contractor:  'bg-amber-50 text-amber-700 border border-amber-200',
  intern:      'bg-green-50 text-green-700 border border-green-200',
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtSalary(amount: number | null, currency: string): string {
  if (amount === null || amount === undefined) return '—'
  const major = amount / 100
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency }).format(major)
}

// ── Role badge ────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    creator: 'bg-purple-100 text-purple-700 border border-purple-200',
    ceo:     'bg-amber-100 text-amber-700 border border-amber-200',
    coo:     'bg-blue-100 text-blue-700 border border-blue-200',
    cto:     'bg-green-100 text-green-700 border border-green-200',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium ${styles[role] ?? 'bg-gray-100 text-gray-600'}`}>
      {role}
    </span>
  )
}

// ── SlideOver wrapper ─────────────────────────────────────────────────────────

function SlideOver({ open, onClose, title, children }: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-xl bg-white shadow-2xl flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D5DBDB]">
          <h2 className="font-syne text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  )
}

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

function Input({
  value, onChange, placeholder, type = 'text', required,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  required?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="w-full h-9 px-3 border border-[#D5DBDB] rounded-md text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0073BB]/30 focus:border-[#0073BB] bg-white"
    />
  )
}

function Select({
  value, onChange, children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-3 pr-8 border border-[#D5DBDB] rounded-md text-sm text-gray-900 bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-[#0073BB]/30 focus:border-[#0073BB]"
      >
        {children}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
  )
}

function Textarea({
  value, onChange, placeholder, rows = 3,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 border border-[#D5DBDB] rounded-md text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0073BB]/30 focus:border-[#0073BB] bg-white resize-none"
    />
  )
}

// ── Employee Form SlideOver ───────────────────────────────────────────────────

interface EmployeeFormProps {
  open:        boolean
  onClose:     () => void
  employee?:   Employee | null
  companies:   Company[]
  employees:   Employee[]
  departments: Department[]
}

function EmployeeSlideOver({ open, onClose, employee, companies, employees, departments }: EmployeeFormProps) {
  const qc = useQueryClient()

  const [companyId,       setCompanyId]       = useState(employee?.company_id       ?? (companies[0]?.id ?? ''))
  const [firstName,       setFirstName]       = useState(employee?.first_name       ?? '')
  const [lastName,        setLastName]        = useState(employee?.last_name        ?? '')
  const [email,           setEmail]           = useState(employee?.email            ?? '')
  const [phone,           setPhone]           = useState(employee?.phone            ?? '')
  const [roleTitle,       setRoleTitle]       = useState(employee?.role_title       ?? '')
  const [employmentType,  setEmploymentType]  = useState<EmploymentType>(employee?.employment_type ?? 'full_time')
  const [startDate,       setStartDate]       = useState(employee?.start_date?.slice(0, 10)  ?? '')
  const [departmentId,    setDepartmentId]    = useState(employee?.department_id    ?? '')
  const [managerId,       setManagerId]       = useState(employee?.manager_id       ?? '')
  const [salary,          setSalary]          = useState(employee?.salary != null ? String(employee.salary / 100) : '')
  const [currency,        setCurrency]        = useState(employee?.currency         ?? 'MYR')
  const [notes,           setNotes]           = useState(employee?.notes            ?? '')
  const [error,           setError]           = useState('')

  const isEdit = !!employee

  // Filter departments and managers to selected company
  const companyDepts = departments.filter(d => d.company_id === companyId)
  const companyEmps  = employees.filter(e => e.company_id === companyId && e.id !== employee?.id && e.is_active)

  const saveM = useMutation({
    mutationFn: async () => {
      const salaryVal = salary ? Math.round(parseFloat(salary) * 100) : null
      const payload = {
        company_id:      companyId,
        first_name:      firstName,
        last_name:        lastName,
        email,
        phone:            phone || undefined,
        role_title:       roleTitle || undefined,
        employment_type:  employmentType,
        start_date:       startDate || undefined,
        department_id:    departmentId || undefined,
        manager_id:       managerId || undefined,
        salary:           salaryVal ?? undefined,
        currency,
        notes:            notes || undefined,
      }
      if (isEdit) {
        return apiFetch(`/api/employees/${employee!.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
      } else {
        return apiFetch('/api/employees', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    setError('')
    if (!firstName || !lastName || !email || !companyId) {
      setError('First name, last name, email, and company are required.')
      return
    }
    saveM.mutate()
  }

  return (
    <SlideOver open={open} onClose={onClose} title={isEdit ? 'Edit Employee' : 'Add Employee'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Company */}
        {!isEdit && (
          <Field label="Company *">
            <Select value={companyId} onChange={setCompanyId}>
              {companies.map(co => (
                <option key={co.id} value={co.id}>{co.name}</option>
              ))}
            </Select>
          </Field>
        )}

        {/* Name row */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First Name *">
            <Input value={firstName} onChange={setFirstName} placeholder="Aisha" required />
          </Field>
          <Field label="Last Name *">
            <Input value={lastName} onChange={setLastName} placeholder="Rahman" required />
          </Field>
        </div>

        {/* Contact */}
        <Field label="Email *">
          <Input value={email} onChange={setEmail} type="email" placeholder="aisha@company.com" required />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChange={setPhone} placeholder="+60 12-345 6789" />
        </Field>

        {/* Role */}
        <Field label="Role Title">
          <Input value={roleTitle} onChange={setRoleTitle} placeholder="Senior Developer" />
        </Field>

        {/* Employment type */}
        <Field label="Employment Type">
          <Select value={employmentType} onChange={(v) => setEmploymentType(v as EmploymentType)}>
            <option value="full_time">Full-time</option>
            <option value="part_time">Part-time</option>
            <option value="contractor">Contractor</option>
            <option value="intern">Intern</option>
          </Select>
        </Field>

        {/* Start date */}
        <Field label="Start Date">
          <Input value={startDate} onChange={setStartDate} type="date" />
        </Field>

        {/* Department */}
        <Field label="Department">
          <Select value={departmentId} onChange={setDepartmentId}>
            <option value="">— No Department —</option>
            {companyDepts.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </Field>

        {/* Manager */}
        <Field label="Manager">
          <Select value={managerId} onChange={setManagerId}>
            <option value="">— No Manager —</option>
            {companyEmps.map(e => (
              <option key={e.id} value={e.id}>{e.first_name} {e.last_name} {e.role_title ? `(${e.role_title})` : ''}</option>
            ))}
          </Select>
        </Field>

        {/* Salary (visible to all in form — salary-in-GET is redacted for coo/cto) */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Salary (major units)">
              <Input value={salary} onChange={setSalary} type="number" placeholder="5000" />
            </Field>
          </div>
          <Field label="Currency">
            <Select value={currency} onChange={setCurrency}>
              <option value="MYR">MYR</option>
              <option value="USD">USD</option>
              <option value="SGD">SGD</option>
              <option value="GBP">GBP</option>
              <option value="EUR">EUR</option>
            </Select>
          </Field>
        </div>

        {/* Notes */}
        <Field label="Notes">
          <Textarea value={notes} onChange={setNotes} placeholder="Any additional context…" />
        </Field>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saveM.isPending}
            className="flex-1 h-9 bg-[#0073BB] hover:bg-[#005f99] text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {saveM.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Employee'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 border border-[#D5DBDB] rounded-md text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </SlideOver>
  )
}

// ── Employee Detail SlideOver ─────────────────────────────────────────────────

interface EmployeeDetailProps {
  open:       boolean
  onClose:    () => void
  employee:   Employee | null
  onEdit:     () => void
  onOffboard: (id: string) => void
}

function EmployeeDetailSlideOver({ open, onClose, employee, onEdit, onOffboard }: EmployeeDetailProps) {
  const [confirmOffboard, setConfirmOffboard] = useState(false)
  const [offboardNotes,   setOffboardNotes]   = useState('')

  if (!employee) return null

  const fullName = `${employee.first_name} ${employee.last_name}`

  return (
    <SlideOver open={open} onClose={onClose} title={fullName}>
      <div className="space-y-6">
        {/* Status banner */}
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium ${
          employee.is_active
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-gray-100 text-gray-600 border border-gray-200'
        }`}>
          {employee.is_active
            ? <><CheckCircle2 size={14} /> Active</>
            : <><Clock size={14} /> Offboarded {fmtDate(employee.end_date)}</>
          }
        </div>

        {/* Basic info */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Role Title</p>
            <p className="text-sm font-medium text-gray-900">{employee.role_title ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Employment</p>
            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${EMP_TYPE_STYLE[employee.employment_type] ?? ''}`}>
              {EMP_TYPE_LABEL[employee.employment_type]}
            </span>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Department</p>
            <p className="text-sm text-gray-900">{employee.department_name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Company</p>
            <p className="text-sm text-gray-900">{employee.company_name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Manager</p>
            <p className="text-sm text-gray-900">{employee.manager_name ?? '—'}</p>
          </div>
          {employee.cbop_role && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">CBOP Role</p>
              <RoleBadge role={employee.cbop_role} />
            </div>
          )}
        </div>

        {/* Contact */}
        <div className="border-t border-[#D5DBDB] pt-4 space-y-2.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</p>
          <a
            href={`mailto:${employee.email}`}
            className="flex items-center gap-2 text-sm text-[#0073BB] hover:underline"
          >
            <Mail size={14} /> {employee.email}
          </a>
          {employee.phone && (
            <p className="flex items-center gap-2 text-sm text-gray-700">
              <Phone size={14} /> {employee.phone}
            </p>
          )}
        </div>

        {/* Dates */}
        <div className="border-t border-[#D5DBDB] pt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Start Date</p>
            <p className="text-sm font-mono text-gray-900">{fmtDate(employee.start_date)}</p>
          </div>
          {employee.end_date && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">End Date</p>
              <p className="text-sm font-mono text-gray-900">{fmtDate(employee.end_date)}</p>
            </div>
          )}
        </div>

        {/* Salary (shown only when present — backend redacts for coo/cto) */}
        {employee.salary != null && (
          <div className="border-t border-[#D5DBDB] pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Salary</p>
            <p className="text-sm font-mono text-gray-900">{fmtSalary(employee.salary, employee.currency)}</p>
          </div>
        )}

        {/* Notes */}
        {employee.notes && (
          <div className="border-t border-[#D5DBDB] pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{employee.notes}</p>
          </div>
        )}

        {/* Actions */}
        {employee.is_active && (
          <div className="border-t border-[#D5DBDB] pt-4 space-y-3">
            {!confirmOffboard ? (
              <div className="flex gap-3">
                <button
                  onClick={onEdit}
                  className="flex-1 flex items-center justify-center gap-2 h-9 border border-[#D5DBDB] rounded-md text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Pencil size={14} /> Edit
                </button>
                <button
                  onClick={() => setConfirmOffboard(true)}
                  className="flex items-center justify-center gap-2 h-9 px-4 border border-red-200 text-red-600 rounded-md text-sm hover:bg-red-50 transition-colors"
                >
                  <UserMinus size={14} /> Offboard
                </button>
              </div>
            ) : (
              <div className="space-y-3 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-medium text-red-700 flex items-center gap-2">
                  <AlertTriangle size={14} /> Confirm offboarding for {fullName}?
                </p>
                <Textarea
                  value={offboardNotes}
                  onChange={setOffboardNotes}
                  placeholder="Optional: reason or notes for offboarding…"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { onOffboard(employee.id); setConfirmOffboard(false) }}
                    className="flex-1 h-8 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md transition-colors"
                  >
                    Confirm Offboard
                  </button>
                  <button
                    onClick={() => setConfirmOffboard(false)}
                    className="h-8 px-3 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </SlideOver>
  )
}

// ── Department Form SlideOver ─────────────────────────────────────────────────

interface DeptFormProps {
  open:        boolean
  onClose:     () => void
  department?: Department | null
  companies:   Company[]
  employees:   Employee[]
}

function DepartmentSlideOver({ open, onClose, department, companies, employees }: DeptFormProps) {
  const qc = useQueryClient()

  const [companyId,   setCompanyId]   = useState(department?.company_id   ?? (companies[0]?.id ?? ''))
  const [name,        setName]        = useState(department?.name         ?? '')
  const [description, setDescription] = useState(department?.description  ?? '')
  const [managerId,   setManagerId]   = useState(department?.manager_id   ?? '')
  const [error,       setError]       = useState('')

  const isEdit = !!department

  const companyEmps = employees.filter(e => e.company_id === companyId && e.is_active)

  const saveM = useMutation({
    mutationFn: async () => {
      const payload = {
        company_id:  companyId,
        name,
        description: description || undefined,
        manager_id:  managerId   || undefined,
      }
      if (isEdit) {
        return apiFetch(`/api/departments/${department!.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
      } else {
        return apiFetch('/api/departments', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['departments'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    setError('')
    if (!name || !companyId) {
      setError('Department name and company are required.')
      return
    }
    saveM.mutate()
  }

  return (
    <SlideOver open={open} onClose={onClose} title={isEdit ? 'Edit Department' : 'Add Department'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isEdit && (
          <Field label="Company *">
            <Select value={companyId} onChange={setCompanyId}>
              {companies.map(co => (
                <option key={co.id} value={co.id}>{co.name}</option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Department Name *">
          <Input value={name} onChange={setName} placeholder="Engineering" required />
        </Field>

        <Field label="Description">
          <Textarea value={description} onChange={setDescription} placeholder="What does this department do?" />
        </Field>

        <Field label="Manager">
          <Select value={managerId} onChange={setManagerId}>
            <option value="">— No Manager —</option>
            {companyEmps.map(e => (
              <option key={e.id} value={e.id}>
                {e.first_name} {e.last_name} {e.role_title ? `(${e.role_title})` : ''}
              </option>
            ))}
          </Select>
        </Field>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saveM.isPending}
            className="flex-1 h-9 bg-[#0073BB] hover:bg-[#005f99] text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {saveM.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Department'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 border border-[#D5DBDB] rounded-md text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </SlideOver>
  )
}

// ── Department Detail SlideOver ───────────────────────────────────────────────

interface DeptDetailProps {
  open:       boolean
  onClose:    () => void
  department: Department | null
  employees:  Employee[]
  onEdit:     () => void
}

function DepartmentDetailSlideOver({ open, onClose, department, employees, onEdit }: DeptDetailProps) {
  if (!department) return null

  const deptEmployees = employees.filter(e => e.department_id === department.id && e.is_active)

  return (
    <SlideOver open={open} onClose={onClose} title={department.name}>
      <div className="space-y-6">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Company</p>
          <p className="text-sm font-medium text-gray-900">{department.company_name}</p>
        </div>

        {department.description && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Description</p>
            <p className="text-sm text-gray-700">{department.description}</p>
          </div>
        )}

        {department.manager_name && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Manager</p>
            <p className="text-sm font-medium text-gray-900">{department.manager_name}</p>
          </div>
        )}

        {/* Employees in this dept */}
        <div className="border-t border-[#D5DBDB] pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Active Employees ({deptEmployees.length})
          </p>
          {deptEmployees.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No active employees in this department.</p>
          ) : (
            <div className="space-y-2">
              {deptEmployees.map(e => (
                <div key={e.id} className="flex items-center gap-3 p-3 bg-[#F2F3F3] rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-[#0073BB]/10 flex items-center justify-center flex-shrink-0">
                    <User size={14} className="text-[#0073BB]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {e.first_name} {e.last_name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{e.role_title ?? e.employment_type}</p>
                  </div>
                  {e.cbop_role && (
                    <div className="ml-auto flex-shrink-0">
                      <RoleBadge role={e.cbop_role} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-[#D5DBDB] pt-4">
          <button
            onClick={onEdit}
            className="flex items-center gap-2 h-9 px-4 border border-[#D5DBDB] rounded-md text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Pencil size={14} /> Edit Department
          </button>
        </div>
      </div>
    </SlideOver>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PeoplePage() {
  const qc = useQueryClient()

  const [tab,              setTab]              = useState<PeopleTab>('employees')
  const [search,           setSearch]           = useState('')
  const [deptFilter,       setDeptFilter]       = useState('')
  const [statusFilter,     setStatusFilter]     = useState<'active' | 'all'>('active')

  // Employee slide-overs
  const [addEmployeeOpen,    setAddEmployeeOpen]    = useState(false)
  const [editEmployee,       setEditEmployee]        = useState<Employee | null>(null)
  const [detailEmployee,     setDetailEmployee]      = useState<Employee | null>(null)
  const [detailOpen,         setDetailOpen]          = useState(false)
  const [editFromDetail,     setEditFromDetail]      = useState(false)

  // Department slide-overs
  const [addDeptOpen,    setAddDeptOpen]    = useState(false)
  const [editDept,       setEditDept]       = useState<Department | null>(null)
  const [detailDept,     setDetailDept]     = useState<Department | null>(null)
  const [deptDetailOpen, setDeptDetailOpen] = useState(false)

  // ── Data fetching ────────────────────────────────────────────────────────────

  const { data: companiesData } = useQuery({
    queryKey: ['companies-list'],
    queryFn:  () => apiFetch<{ companies: Company[] }>('/api/settings/companies'),
    staleTime: 5 * 60 * 1000,
  })

  const companies = companiesData?.companies ?? []

  const { data: employeesData, isLoading: empLoading } = useQuery({
    queryKey: ['employees'],
    queryFn:  () => apiFetch<{ employees: Employee[] }>('/api/employees?is_active=false'),
    staleTime: 30 * 1000,
  })

  const { data: deptsData, isLoading: deptLoading } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => apiFetch<{ departments: Department[] }>('/api/departments'),
    staleTime: 30 * 1000,
  })

  const allEmployees  = employeesData?.employees  ?? []
  const allDepartments = deptsData?.departments   ?? []

  // ── Offboard mutation ────────────────────────────────────────────────────────

  const offboardM = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/employees/${id}/offboard`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      setDetailOpen(false)
    },
  })

  // ── Filtered employee list ───────────────────────────────────────────────────

  const filteredEmployees = useMemo(() => {
    let list = allEmployees
    if (statusFilter === 'active') list = list.filter(e => e.is_active)
    if (deptFilter)               list = list.filter(e => e.department_id === deptFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(e =>
        `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.role_title?.toLowerCase().includes(q) ?? false)
      )
    }
    return list
  }, [allEmployees, statusFilter, deptFilter, search])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function openDetail(emp: Employee) {
    setDetailEmployee(emp)
    setDetailOpen(true)
    setEditFromDetail(false)
  }

  function openEditFromDetail() {
    setEditEmployee(detailEmployee)
    setEditFromDetail(true)
    setDetailOpen(false)
    setAddEmployeeOpen(false)
  }

  function openDeptDetail(d: Department) {
    setDetailDept(d)
    setDeptDetailOpen(true)
  }

  return (
    <div className="min-h-screen bg-[#F2F3F3]">
      {/* Page header */}
      <div className="bg-white border-b border-[#D5DBDB] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-syne text-xl font-bold text-gray-900">People</h1>
            <p className="text-sm text-gray-500 mt-0.5">Employees and department management</p>
          </div>
          <div className="flex items-center gap-3">
            {tab === 'employees' ? (
              <button
                onClick={() => { setEditEmployee(null); setAddEmployeeOpen(true) }}
                className="flex items-center gap-2 h-9 px-4 bg-[#0073BB] hover:bg-[#005f99] text-white text-sm font-medium rounded-md transition-colors"
              >
                <Plus size={15} /> Add Employee
              </button>
            ) : (
              <button
                onClick={() => { setEditDept(null); setAddDeptOpen(true) }}
                className="flex items-center gap-2 h-9 px-4 bg-[#0073BB] hover:bg-[#005f99] text-white text-sm font-medium rounded-md transition-colors"
              >
                <Plus size={15} /> Add Department
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 border-b border-[#D5DBDB]">
          {([ ['employees', 'Employees', Users], ['departments', 'Departments', Building2] ] as const).map(
            ([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  tab === key
                    ? 'border-[#0073BB] text-[#0073BB]'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon size={15} /> {label}
                {key === 'employees' && !empLoading && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-mono">
                    {allEmployees.filter(e => e.is_active).length}
                  </span>
                )}
                {key === 'departments' && !deptLoading && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-mono">
                    {allDepartments.length}
                  </span>
                )}
              </button>
            )
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">

        {/* ── Employees Tab ── */}
        {tab === 'employees' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email, role…"
                  className="w-full h-9 pl-9 pr-3 border border-[#D5DBDB] rounded-md text-sm text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-[#0073BB]/30 focus:border-[#0073BB]"
                />
              </div>

              {/* Department filter */}
              <div className="relative">
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="h-9 pl-3 pr-8 border border-[#D5DBDB] rounded-md text-sm text-gray-700 bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-[#0073BB]/30 focus:border-[#0073BB]"
                >
                  <option value="">All Departments</option>
                  {allDepartments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>

              {/* Status toggle */}
              <div className="flex items-center border border-[#D5DBDB] rounded-md overflow-hidden bg-white">
                {(['active', 'all'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`h-9 px-3 text-sm font-medium transition-colors ${
                      statusFilter === s
                        ? 'bg-[#0073BB] text-white'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {s === 'active' ? 'Active' : 'All'}
                  </button>
                ))}
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg border border-[#D5DBDB] overflow-hidden shadow-sm">
              {empLoading ? (
                <div className="p-12 text-center text-sm text-gray-400">Loading employees…</div>
              ) : filteredEmployees.length === 0 ? (
                <div className="p-12 text-center">
                  <Users size={32} className="mx-auto text-gray-300 mb-3" />
                  <p className="text-sm text-gray-500">
                    {search || deptFilter ? 'No employees match your filters.' : 'No employees yet. Add your first one.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#D5DBDB] bg-[#F2F3F3]">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Department</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Start Date</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#D5DBDB]">
                      {filteredEmployees.map(emp => (
                        <tr
                          key={emp.id}
                          onClick={() => openDetail(emp)}
                          className="hover:bg-[#F2F3F3] cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-[#0073BB]/10 flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-semibold text-[#0073BB]">
                                  {emp.first_name[0]}{emp.last_name[0]}
                                </span>
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">
                                  {emp.first_name} {emp.last_name}
                                </p>
                                <p className="text-xs text-gray-500">{emp.email}</p>
                              </div>
                              {emp.cbop_role && (
                                <RoleBadge role={emp.cbop_role} />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{emp.role_title ?? '—'}</td>
                          <td className="px-4 py-3 text-gray-700">{emp.department_name ?? '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${EMP_TYPE_STYLE[emp.employment_type] ?? ''}`}>
                              {EMP_TYPE_LABEL[emp.employment_type]}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-700">{fmtDate(emp.start_date)}</td>
                          <td className="px-4 py-3">
                            {emp.is_active ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                                <CheckCircle2 size={10} /> Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                                <Clock size={10} /> Offboarded
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Departments Tab ── */}
        {tab === 'departments' && (
          <div>
            {deptLoading ? (
              <div className="p-12 text-center text-sm text-gray-400">Loading departments…</div>
            ) : allDepartments.length === 0 ? (
              <div className="p-12 text-center">
                <Building2 size={32} className="mx-auto text-gray-300 mb-3" />
                <p className="text-sm text-gray-500">No departments yet. Add your first one.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {allDepartments.map(dept => (
                  <button
                    key={dept.id}
                    onClick={() => openDeptDetail(dept)}
                    className="bg-white rounded-lg border border-[#D5DBDB] p-5 text-left hover:shadow-md hover:border-[#0073BB]/40 transition-all shadow-sm group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-lg bg-[#0073BB]/10 flex items-center justify-center">
                        <Building2 size={18} className="text-[#0073BB]" />
                      </div>
                      <span className="font-mono text-2xl font-bold text-[#0073BB]">
                        {dept.employee_count}
                      </span>
                    </div>
                    <p className="font-syne font-semibold text-gray-900 group-hover:text-[#0073BB] transition-colors">
                      {dept.name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{dept.company_name}</p>
                    {dept.manager_name && (
                      <div className="flex items-center gap-1.5 mt-2.5">
                        <User size={11} className="text-gray-400" />
                        <span className="text-xs text-gray-500">
                          <span className="font-medium text-gray-700">{dept.manager_name}</span>
                        </span>
                      </div>
                    )}
                    {dept.description && (
                      <p className="text-xs text-gray-500 mt-2 line-clamp-2">{dept.description}</p>
                    )}
                    <div className="mt-3 pt-3 border-t border-[#D5DBDB] flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        {dept.employee_count === 1 ? '1 active employee' : `${dept.employee_count} active employees`}
                      </span>
                      <div className="flex items-center gap-1">
                        <Briefcase size={10} className="text-gray-400" />
                        <CalendarDays size={10} className="text-gray-400" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Slide-overs ── */}

      {/* Add / Edit Employee */}
      <EmployeeSlideOver
        open={addEmployeeOpen || !!editEmployee}
        onClose={() => { setAddEmployeeOpen(false); setEditEmployee(null) }}
        employee={editEmployee}
        companies={companies}
        employees={allEmployees}
        departments={allDepartments}
      />

      {/* Employee Detail */}
      <EmployeeDetailSlideOver
        open={detailOpen && !editFromDetail}
        onClose={() => { setDetailOpen(false); setDetailEmployee(null) }}
        employee={detailEmployee}
        onEdit={openEditFromDetail}
        onOffboard={(id) => offboardM.mutate(id)}
      />

      {/* Edit from detail */}
      {editFromDetail && editEmployee && (
        <EmployeeSlideOver
          open={true}
          onClose={() => { setEditEmployee(null); setEditFromDetail(false) }}
          employee={editEmployee}
          companies={companies}
          employees={allEmployees}
          departments={allDepartments}
        />
      )}

      {/* Add / Edit Department */}
      <DepartmentSlideOver
        open={addDeptOpen || !!editDept}
        onClose={() => { setAddDeptOpen(false); setEditDept(null) }}
        department={editDept}
        companies={companies}
        employees={allEmployees}
      />

      {/* Department Detail */}
      <DepartmentDetailSlideOver
        open={deptDetailOpen}
        onClose={() => { setDeptDetailOpen(false); setDetailDept(null) }}
        department={detailDept}
        employees={allEmployees}
        onEdit={() => {
          setEditDept(detailDept)
          setDeptDetailOpen(false)
          setAddDeptOpen(false)
        }}
      />
    </div>
  )
}
