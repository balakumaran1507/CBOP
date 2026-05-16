'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus    = 'todo' | 'in_progress' | 'review' | 'done'
type TaskPriority  = 'low' | 'medium' | 'high' | 'critical'
type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'cancelled'
type WorkTab       = 'tasks' | 'projects' | 'sessions'

interface Task {
  id: string
  company_id: string
  company_name: string
  project_id: string
  project_name: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  notes: string | null
  owner_id: string | null
  owner_name: string | null
  linked_deal_id: string | null
  created_at: string
}

interface Project {
  id: string
  company_id: string
  company_name: string
  name: string
  status: ProjectStatus
  deadline: string | null
  description: string | null
  owner_id: string | null
  owner_name: string | null
  tasks_count: number
  tasks_done: number
  created_at: string
}

interface Session {
  id: string
  company_id: string
  company_name: string
  project_id: string | null
  project_name: string | null
  goal: string
  output: string | null
  attendees: { user_id: string; name: string }[] | null
  scheduled_at: string | null
  completed_at: string | null
}

interface User    { id: string; name: string; role: string }
interface Company { id: string; name: string; invoice_prefix: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function isOverdue(d: string | null, status: TaskStatus): boolean {
  if (!d || status === 'done') return false
  const today = new Date(); today.setHours(0,0,0,0)
  return new Date(d) < today
}

const PRIORITY_STYLE: Record<TaskPriority, React.CSSProperties> = {
  critical: { backgroundColor: '#FEF0EE', color: '#D13212' },
  high:     { backgroundColor: '#FEF8EE', color: '#E8820C' },
  medium:   { backgroundColor: '#E8F4FB', color: '#0073BB' },
  low:      { backgroundColor: '#F2F3F3', color: '#687078' },
}

const PROJECT_STATUS_STYLE: Record<ProjectStatus, React.CSSProperties> = {
  active:    { backgroundColor: '#EBF5E8', color: '#1D8102' },
  on_hold:   { backgroundColor: '#FEF8EE', color: '#E8820C' },
  completed: { backgroundColor: '#F2F3F3', color: '#687078' },
  cancelled: { backgroundColor: '#FEF0EE', color: '#D13212' },
}

const TASK_COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: 'todo',        label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'review',      label: 'Review' },
  { key: 'done',        label: 'Done' },
]

const inputStyle: React.CSSProperties = {
  height: '36px', border: '1px solid var(--border)', borderRadius: '6px',
  outline: 'none', padding: '0 12px', fontSize: '0.875rem', width: '100%',
  fontFamily: 'var(--font-inter), sans-serif', backgroundColor: '#fff',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.75rem', fontWeight: 500, marginBottom: '4px',
  color: 'var(--text2)', fontFamily: 'var(--font-inter), sans-serif',
}

// ── Priority Chip ─────────────────────────────────────────────────────────────

function PriorityChip({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className="text-xs px-1.5 py-0.5 font-medium capitalize"
      style={{ ...PRIORITY_STYLE[priority], borderRadius: '3px' }}
    >
      {priority}
    </span>
  )
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onMove,
  onClick,
}: {
  task: Task
  onMove: (taskId: string, status: TaskStatus) => void
  onClick: (task: Task) => void
}) {
  const overdue = isOverdue(task.due_date, task.status)
  return (
    <div
      onClick={() => onClick(task)}
      className="bg-white rounded mb-2 p-3 cursor-pointer"
      style={{
        border: `1px solid ${overdue ? 'var(--amber)' : 'var(--border)'}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <p className="text-sm font-medium mb-1.5 leading-snug" style={{ color: 'var(--text1)' }}>
        {task.title}
      </p>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#F2F3F3', color: 'var(--text2)' }}>
          {task.project_name}
        </span>
        <PriorityChip priority={task.priority} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs truncate" style={{ color: 'var(--text3)' }}>
          {task.owner_name || 'Unassigned'}
        </span>
        {task.due_date && (
          <span
            className="text-xs flex-shrink-0"
            style={{
              fontFamily: 'var(--font-ibm-plex-mono), monospace',
              color: overdue ? 'var(--amber)' : 'var(--text3)',
              fontWeight: overdue ? 600 : 400,
            }}
          >
            {fmtDate(task.due_date)}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Task Slide-over ───────────────────────────────────────────────────────────

function TaskSlideOver({
  task, onClose, onSaved, projects, users,
}: {
  task: Task | null
  onClose: () => void
  onSaved: () => void
  projects: Project[]
  users: User[]
}) {
  const [status,   setStatus]   = useState<TaskStatus>('todo')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [title,    setTitle]    = useState('')
  const [notes,    setNotes]    = useState('')
  const [dueDate,  setDueDate]  = useState('')
  const [ownerId,  setOwnerId]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  // Sync form with selected task
  useState(() => {
    if (task) {
      setTitle(task.title)
      setStatus(task.status)
      setPriority(task.priority)
      setNotes(task.notes || '')
      setDueDate(task.due_date || '')
      setOwnerId(task.owner_id || '')
      setError('')
    }
  })

  // We use a key-based reset instead of effect in this pattern
  if (!task) return null

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!task) return
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:    title.trim() || undefined,
          status,
          priority,
          due_date: dueDate || undefined,
          notes:    notes.trim() || undefined,
          owner_id: ownerId || undefined,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to save'); return }
      onSaved(); onClose()
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col" style={{ width: '480px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-semibold truncate mr-4" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>
            Edit Task
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>

        <form key={task.id} onSubmit={handleSave} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label style={labelStyle}>Title</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Status</label>
                <select value={status} onChange={e => setStatus(e.target.value as TaskStatus)} style={inputStyle}>
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="review">Review</option>
                  <option value="done">Done</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Priority</label>
                <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} style={inputStyle}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Due Date</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ ...inputStyle, fontFamily: 'var(--font-ibm-plex-mono), monospace' }} />
              </div>
              <div>
                <label style={labelStyle}>Owner</label>
                <select value={ownerId} onChange={e => setOwnerId(e.target.value)} style={inputStyle}>
                  <option value="">— Unassigned —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Project</label>
              <p className="text-sm" style={{ color: 'var(--text2)', paddingTop: '4px' }}>{task.project_name}</p>
            </div>
            <div>
              <label style={labelStyle}>Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={4}
                style={{ ...inputStyle, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
              />
            </div>
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>

          <div className="px-6 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="submit" disabled={saving} className="flex-1 text-sm py-2 font-medium"
              style={{ backgroundColor: saving ? '#ccc' : 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose} className="text-sm px-4 py-2"
              style={{ border: '1px solid var(--border)', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: 'var(--text2)' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── New Task Slide-over ───────────────────────────────────────────────────────

function NewTaskSlideOver({
  open, onClose, onCreated, projects, users, defaultProjectId,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  projects: Project[]
  users: User[]
  defaultProjectId?: string
}) {
  const [form, setForm] = useState({
    project_id: defaultProjectId || '', title: '', priority: 'medium', due_date: '', notes: '', owner_id: '',
  })
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)

  // Reset on open
  if (open && !form.project_id && projects.length > 0 && !defaultProjectId) {
    setForm(f => ({ ...f, project_id: projects[0].id }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.project_id) { setError('Project is required'); return }
    if (!form.title.trim()) { setError('Title is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: form.project_id,
          title:      form.title.trim(),
          priority:   form.priority || 'medium',
          due_date:   form.due_date || null,
          notes:      form.notes.trim() || null,
          owner_id:   form.owner_id || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to create task'); return }
      onCreated(); onClose()
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col" style={{ width: '480px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>New Task</h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label style={labelStyle}>Project *</label>
              <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} style={inputStyle}>
                <option value="">— Select project —</option>
                {projects.filter(p => p.status === 'active').map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.company_name})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Title *</label>
              <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="What needs to be done?" style={inputStyle} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Priority</label>
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} style={inputStyle}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Due Date</label>
                <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} style={{ ...inputStyle, fontFamily: 'var(--font-ibm-plex-mono), monospace' }} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Owner</label>
              <select value={form.owner_id} onChange={e => setForm(f => ({ ...f, owner_id: e.target.value }))} style={inputStyle}>
                <option value="">— Assign to me —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                placeholder="Details, context…"
                style={{ ...inputStyle, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
              />
            </div>
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>

          <div className="px-6 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="submit" disabled={saving} className="flex-1 text-sm py-2 font-medium"
              style={{ backgroundColor: saving ? '#ccc' : 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Creating…' : 'Create Task'}
            </button>
            <button type="button" onClick={onClose} className="text-sm px-4 py-2"
              style={{ border: '1px solid var(--border)', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: 'var(--text2)' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Tasks Tab ─────────────────────────────────────────────────────────────────

function TasksTab() {
  const qc = useQueryClient()
  const [mineOnly, setMineOnly]     = useState(false)
  const [newOpen, setNewOpen]       = useState(false)
  const [selectedTask, setSelected] = useState<Task | null>(null)

  const { data: tasksData, isLoading, isError } = useQuery<{ tasks: Task[] }>({
    queryKey: ['tasks', mineOnly],
    queryFn: async () => {
      const url = mineOnly ? '/api/tasks?mine=true' : '/api/tasks'
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load tasks')
      return res.json()
    },
  })

  const { data: projectsData } = useQuery<{ projects: Project[] }>({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch('/api/projects', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load projects')
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

  const moveTask = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TaskStatus }) => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Failed to move task')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const tasks = tasksData?.tasks || []

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], review: [], done: [] }
    tasks.forEach(t => map[t.status]?.push(t))
    return map
  }, [tasks])

  const totalOpen = tasks.filter(t => t.status !== 'done').length

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-6 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)', backgroundColor: '#fff' }}
      >
        <div className="flex items-center gap-4">
          {/* My Tasks / All Tasks toggle */}
          <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {[{ label: 'All Tasks', val: false }, { label: 'My Tasks', val: true }].map(opt => (
              <button
                key={String(opt.val)}
                onClick={() => setMineOnly(opt.val)}
                className="text-xs px-3 py-1.5 font-medium transition-colors"
                style={{
                  backgroundColor: mineOnly === opt.val ? 'var(--blue)' : '#fff',
                  color:           mineOnly === opt.val ? '#fff' : 'var(--text2)',
                  border:          'none',
                  cursor:          'pointer',
                  fontFamily:      'var(--font-inter), sans-serif',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {!isLoading && !isError && (
            <span className="text-sm" style={{ color: 'var(--text2)' }}>
              <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontWeight: 600, color: 'var(--text1)' }}>{totalOpen}</span>
              {' '}open
            </span>
          )}
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="text-sm px-4 py-2 font-medium"
          style={{ backgroundColor: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}
        >
          + New Task
        </button>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--bg)' }}>
        {isLoading ? (
          <div className="flex gap-4 p-6">
            {TASK_COLUMNS.map(col => (
              <div key={col.key} className="flex-shrink-0 rounded animate-pulse" style={{ width: '240px', height: '200px', backgroundColor: '#E0E3E3' }} />
            ))}
          </div>
        ) : isError ? (
          <div className="p-6"><p className="text-sm" style={{ color: 'var(--red)' }}>Failed to load tasks</p></div>
        ) : (
          <div className="flex gap-4 p-6 items-start" style={{ minWidth: 'max-content' }}>
            {TASK_COLUMNS.map(col => {
              const colTasks = byStatus[col.key]
              return (
                <div key={col.key} style={{ width: '260px', flexShrink: 0 }}>
                  <div
                    className="flex items-center justify-between mb-3 px-1"
                  >
                    <span className="text-xs font-semibold uppercase" style={{ color: 'var(--text2)', letterSpacing: '0.06em' }}>
                      {col.label}
                    </span>
                    <span
                      className="text-xs font-semibold"
                      style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text3)' }}
                    >
                      {colTasks.length}
                    </span>
                  </div>
                  <div
                    className="rounded p-2"
                    style={{
                      backgroundColor: col.key === 'done' ? '#F2F3F3' : '#EAECEC',
                      minHeight: '120px',
                    }}
                  >
                    {colTasks.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onMove={(id, status) => moveTask.mutate({ id, status })}
                        onClick={setSelected}
                      />
                    ))}
                    {colTasks.length === 0 && (
                      <p className="text-xs text-center py-4" style={{ color: 'var(--text3)' }}>Empty</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <TaskSlideOver
        task={selectedTask}
        onClose={() => setSelected(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['tasks'] })
          qc.invalidateQueries({ queryKey: ['projects'] })
          qc.invalidateQueries({ queryKey: ['dashboard'] })
        }}
        projects={projectsData?.projects || []}
        users={usersData?.users || []}
      />

      <NewTaskSlideOver
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ['tasks'] })
          qc.invalidateQueries({ queryKey: ['projects'] })
        }}
        projects={projectsData?.projects || []}
        users={usersData?.users || []}
      />
    </div>
  )
}

// ── New Project Slide-over ────────────────────────────────────────────────────

function NewProjectSlideOver({
  open, onClose, onCreated, companies, users,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  companies: Company[]
  users: User[]
}) {
  const [form, setForm] = useState({ company_id: '', name: '', description: '', deadline: '', owner_id: '' })
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)

  if (open && !form.company_id && companies.length > 0) {
    setForm(f => ({ ...f, company_id: companies[0].id }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.company_id)    { setError('Company is required'); return }
    if (!form.name.trim())   { setError('Name is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/projects', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id:  form.company_id,
          name:        form.name.trim(),
          description: form.description.trim() || null,
          deadline:    form.deadline || null,
          owner_id:    form.owner_id || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to create project'); return }
      onCreated(); onClose()
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col" style={{ width: '480px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>New Project</h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label style={labelStyle}>Company *</label>
              <select value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))} style={inputStyle}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Project Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Project name" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Description</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="What is this project about?"
                style={{ ...inputStyle, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Deadline</label>
                <input type="date" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} style={{ ...inputStyle, fontFamily: 'var(--font-ibm-plex-mono), monospace' }} />
              </div>
              <div>
                <label style={labelStyle}>Owner</label>
                <select value={form.owner_id} onChange={e => setForm(f => ({ ...f, owner_id: e.target.value }))} style={inputStyle}>
                  <option value="">— Assign to me —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>

          <div className="px-6 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="submit" disabled={saving} className="flex-1 text-sm py-2 font-medium"
              style={{ backgroundColor: saving ? '#ccc' : 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Creating…' : 'Create Project'}
            </button>
            <button type="button" onClick={onClose} className="text-sm px-4 py-2"
              style={{ border: '1px solid var(--border)', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: 'var(--text2)' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Project Detail Slide-over ─────────────────────────────────────────────────

function ProjectDetailSlideOver({
  project, onClose, onUpdated, users,
}: {
  project: Project | null
  onClose: () => void
  onUpdated: () => void
  users: User[]
}) {
  const qc = useQueryClient()
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)

  const { data: tasksData } = useQuery<{ tasks: Task[] }>({
    queryKey: ['tasks-project', project?.id],
    queryFn: async () => {
      const res = await fetch(`/api/tasks?project_id=${project!.id}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!project,
  })

  const { data: projectsData } = useQuery<{ projects: Project[] }>({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch('/api/projects', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  async function changeStatus(status: ProjectStatus) {
    if (!project) return
    setSavingStatus(true)
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      onUpdated()
    } finally { setSavingStatus(false) }
  }

  if (!project) return null

  const tasks   = tasksData?.tasks || []
  const done    = tasks.filter(t => t.status === 'done').length
  const pct     = tasks.length ? Math.round((done / tasks.length) * 100) : 0

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col" style={{ width: '520px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="min-w-0 mr-4">
            <h2 className="text-base font-semibold truncate" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>
              {project.name}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{project.company_name}</p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-5">
          {/* Status + meta */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs px-2 py-0.5 font-medium capitalize" style={{ ...PROJECT_STATUS_STYLE[project.status], borderRadius: '3px' }}>
              {project.status.replace('_', ' ')}
            </span>
            {project.owner_name && (
              <span className="text-xs" style={{ color: 'var(--text2)' }}>Owner: {project.owner_name}</span>
            )}
            {project.deadline && (
              <span className="text-xs" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)' }}>
                Due: {fmtDate(project.deadline)}
              </span>
            )}
          </div>

          {project.description && (
            <p className="text-sm" style={{ color: 'var(--text2)', lineHeight: 1.6 }}>{project.description}</p>
          )}

          {/* Progress bar */}
          {tasks.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium" style={{ color: 'var(--text2)' }}>Progress</span>
                <span className="text-xs" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)' }}>
                  {done}/{tasks.length} tasks
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#E0E3E3' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: pct === 100 ? 'var(--green)' : 'var(--blue)' }}
                />
              </div>
            </div>
          )}

          {/* Status change */}
          <div className="flex gap-2 flex-wrap">
            {(['active', 'on_hold', 'completed', 'cancelled'] as ProjectStatus[])
              .filter(s => s !== project.status)
              .map(s => (
                <button
                  key={s}
                  onClick={() => changeStatus(s)}
                  disabled={savingStatus}
                  className="text-xs px-3 py-1.5 font-medium capitalize"
                  style={{
                    ...PROJECT_STATUS_STYLE[s],
                    border: `1px solid currentColor`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    opacity: savingStatus ? 0.5 : 1,
                  }}
                >
                  → {s.replace('_', ' ')}
                </button>
              ))}
          </div>

          {/* Task list */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase" style={{ color: 'var(--text2)', letterSpacing: '0.06em' }}>
                Tasks ({tasks.length})
              </p>
              <button
                onClick={() => setNewTaskOpen(true)}
                className="text-xs px-3 py-1.5 font-medium"
                style={{ backgroundColor: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                + Add Task
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              {tasks.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text3)' }}>No tasks yet.</p>
              ) : (
                tasks.map(t => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 px-3 py-2 rounded"
                    style={{ border: '1px solid var(--border)', backgroundColor: '#FAFAFA' }}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: t.status === 'done' ? 'var(--green)' : t.status === 'in_progress' ? 'var(--blue)' : '#D5DBDB' }}
                    />
                    <span className="flex-1 text-sm truncate" style={{ color: t.status === 'done' ? 'var(--text3)' : 'var(--text1)', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                      {t.title}
                    </span>
                    <PriorityChip priority={t.priority} />
                    {t.owner_name && (
                      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text3)' }}>{t.owner_name}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <NewTaskSlideOver
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ['tasks'] })
          qc.invalidateQueries({ queryKey: ['tasks-project', project.id] })
          qc.invalidateQueries({ queryKey: ['projects'] })
        }}
        projects={projectsData?.projects || []}
        users={users}
        defaultProjectId={project.id}
      />
    </>
  )
}

// ── Projects Tab ──────────────────────────────────────────────────────────────

function ProjectsTab() {
  const qc = useQueryClient()
  const [filter, setFilter]         = useState('')
  const [addOpen, setAddOpen]       = useState(false)
  const [selectedProject, setSelected] = useState<Project | null>(null)

  const { data: projectsData, isLoading, isError } = useQuery<{ projects: Project[] }>({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch('/api/projects', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load projects')
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

  const projects = projectsData?.projects || []

  const filtered = useMemo(
    () => filter
      ? projects.filter(p => `${p.name} ${p.company_name}`.toLowerCase().includes(filter.toLowerCase()))
      : projects,
    [projects, filter]
  )

  const activeCount = projects.filter(p => p.status === 'active').length

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-6 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)', backgroundColor: '#fff' }}
      >
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Filter projects…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ ...inputStyle, width: '220px' }}
          />
          {!isLoading && !isError && (
            <span className="text-sm" style={{ color: 'var(--text2)' }}>
              <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontWeight: 600, color: 'var(--text1)' }}>{activeCount}</span>
              {' '}active
            </span>
          )}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="text-sm px-4 py-2 font-medium"
          style={{ backgroundColor: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}
        >
          + New Project
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 flex flex-col gap-2">
            {[1,2,3,4].map(i => <div key={i} className="h-12 rounded animate-pulse" style={{ backgroundColor: '#E0E3E3' }} />)}
          </div>
        ) : isError ? (
          <div className="p-6"><p className="text-sm" style={{ color: 'var(--red)' }}>Failed to load projects</p></div>
        ) : filtered.length === 0 ? (
          <div className="p-6"><p className="text-sm" style={{ color: 'var(--text3)' }}>No projects found{filter ? ' matching that filter' : ''}.</p></div>
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#F2F3F3', borderBottom: '1px solid var(--border)' }}>
                {['Project', 'Company', 'Status', 'Tasks', 'Progress', 'Owner', 'Deadline'].map(h => (
                  <th key={h} className="text-left px-4 py-2 font-medium text-xs uppercase" style={{ color: 'var(--text2)', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const pct = p.tasks_count ? Math.round((p.tasks_done / p.tasks_count) * 100) : 0
                return (
                  <tr
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className="cursor-pointer hover:bg-gray-50"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text1)' }}>{p.name}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{p.company_name}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 font-medium capitalize" style={{ ...PROJECT_STATUS_STYLE[p.status], borderRadius: '3px' }}>
                        {p.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text1)' }}>
                      {p.tasks_done}/{p.tasks_count}
                    </td>
                    <td className="px-4 py-3" style={{ minWidth: '80px' }}>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#E0E3E3', minWidth: '48px' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? 'var(--green)' : 'var(--blue)' }} />
                        </div>
                        <span className="text-xs flex-shrink-0" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text3)' }}>
                          {pct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{p.owner_name || '—'}</td>
                    <td className="px-4 py-3" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)', fontSize: '0.8rem' }}>
                      {p.deadline ? fmtDate(p.deadline) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <ProjectDetailSlideOver
        project={selectedProject}
        onClose={() => setSelected(null)}
        onUpdated={() => {
          qc.invalidateQueries({ queryKey: ['projects'] })
          setSelected(null)
        }}
        users={usersData?.users || []}
      />

      <NewProjectSlideOver
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ['projects'] })}
        companies={companiesData?.companies || []}
        users={usersData?.users || []}
      />
    </div>
  )
}

// ── New Session Slide-over ────────────────────────────────────────────────────

function NewSessionSlideOver({
  open, onClose, onCreated, projects, users,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  projects: Project[]
  users: User[]
}) {
  const [form, setForm] = useState({
    project_id: '', goal: '', scheduled_at: '', attendee_ids: [] as string[],
  })
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)

  if (open && !form.project_id && projects.length > 0) {
    setForm(f => ({ ...f, project_id: projects[0].id }))
  }

  function toggleAttendee(uid: string) {
    setForm(f => ({
      ...f,
      attendee_ids: f.attendee_ids.includes(uid)
        ? f.attendee_ids.filter(id => id !== uid)
        : [...f.attendee_ids, uid],
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.goal.trim())  { setError('Goal is required'); return }
    if (!form.project_id)   { setError('Project is required'); return }
    setSaving(true); setError('')
    try {
      const attendees = form.attendee_ids
        .map(id => users.find(u => u.id === id))
        .filter(Boolean)
        .map(u => ({ user_id: u!.id, name: u!.name }))

      const res = await fetch('/api/sessions', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id:   form.project_id,
          goal:         form.goal.trim(),
          scheduled_at: form.scheduled_at || null,
          attendees:    attendees.length ? attendees : null,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to create session'); return }
      setForm({ project_id: '', goal: '', scheduled_at: '', attendee_ids: [] })
      onCreated(); onClose()
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col" style={{ width: '480px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>New Session</h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label style={labelStyle}>Goal * <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(what will be accomplished?)</span></label>
              <textarea
                value={form.goal}
                onChange={e => setForm(f => ({ ...f, goal: e.target.value }))}
                rows={3}
                placeholder="e.g. Review pentest scope and agree on methodology"
                style={{ ...inputStyle, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
              />
            </div>
            <div>
              <label style={labelStyle}>Project *</label>
              <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} style={inputStyle}>
                <option value="">— Select project —</option>
                {projects.filter(p => p.status === 'active').map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.company_name})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Scheduled At</label>
              <input
                type="datetime-local"
                value={form.scheduled_at}
                onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
                style={{ ...inputStyle, fontFamily: 'var(--font-ibm-plex-mono), monospace' }}
              />
            </div>
            <div>
              <label style={labelStyle}>Attendees</label>
              <div className="flex flex-col gap-1.5 mt-1">
                {users.map(u => (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 cursor-pointer text-sm"
                    style={{ color: 'var(--text1)' }}
                  >
                    <input
                      type="checkbox"
                      checked={form.attendee_ids.includes(u.id)}
                      onChange={() => toggleAttendee(u.id)}
                      style={{ accentColor: 'var(--blue)' }}
                    />
                    {u.name}
                    <span className="text-xs capitalize" style={{ color: 'var(--text3)' }}>({u.role})</span>
                  </label>
                ))}
              </div>
            </div>
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>

          <div className="px-6 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="submit" disabled={saving} className="flex-1 text-sm py-2 font-medium"
              style={{ backgroundColor: saving ? '#ccc' : 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Creating…' : 'Create Session'}
            </button>
            <button type="button" onClick={onClose} className="text-sm px-4 py-2"
              style={{ border: '1px solid var(--border)', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: 'var(--text2)' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Session Detail Slide-over ─────────────────────────────────────────────────

function SessionDetailSlideOver({
  session, onClose, onUpdated,
}: {
  session: Session | null
  onClose: () => void
  onUpdated: () => void
}) {
  const [completing, setCompleting] = useState(false)
  const [output,    setOutput]      = useState('')
  const [error,     setError]       = useState('')
  const [saving,    setSaving]      = useState(false)

  if (!session) return null

  const isComplete = !!session.completed_at

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault()
    if (!output.trim()) { setError('Output is required — describe what was accomplished'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/sessions/${session!.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          output:       output.trim(),
          completed_at: new Date().toISOString(),
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to complete session'); return }
      onUpdated(); onClose()
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col" style={{ width: '520px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="min-w-0 mr-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold truncate" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>
                Session Detail
              </h2>
              <span
                className="text-xs px-2 py-0.5 font-medium flex-shrink-0"
                style={{
                  borderRadius: '3px',
                  backgroundColor: isComplete ? '#EBF5E8' : '#FEF8EE',
                  color: isComplete ? 'var(--green)' : 'var(--amber)',
                }}
              >
                {isComplete ? 'Completed' : 'Open'}
              </span>
            </div>
            {session.project_name && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{session.project_name} · {session.company_name}</p>
            )}
          </div>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-5">
          {/* Goal */}
          <div>
            <p className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text2)', letterSpacing: '0.06em' }}>Goal</p>
            <p className="text-sm" style={{ color: 'var(--text1)', lineHeight: 1.6 }}>{session.goal}</p>
          </div>

          {/* Scheduled at */}
          {session.scheduled_at && (
            <div>
              <p className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text2)', letterSpacing: '0.06em' }}>Scheduled</p>
              <p className="text-sm" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text1)' }}>
                {new Date(session.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </div>
          )}

          {/* Attendees */}
          {session.attendees && session.attendees.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text2)', letterSpacing: '0.06em' }}>Attendees</p>
              <div className="flex flex-wrap gap-1.5">
                {session.attendees.map(a => (
                  <span
                    key={a.user_id}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ backgroundColor: '#F2F3F3', color: 'var(--text1)' }}
                  >
                    {a.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Output (if completed) */}
          {isComplete && session.output && (
            <div>
              <p className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text2)', letterSpacing: '0.06em' }}>What Was Done</p>
              <p className="text-sm" style={{ color: 'var(--text1)', lineHeight: 1.6 }}>{session.output}</p>
              {session.completed_at && (
                <p className="text-xs mt-1" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text3)' }}>
                  Completed {new Date(session.completed_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              )}
            </div>
          )}

          {/* Complete session form */}
          {!isComplete && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
              {!completing ? (
                <button
                  onClick={() => setCompleting(true)}
                  className="text-sm px-4 py-2 font-medium w-full"
                  style={{ backgroundColor: 'var(--green)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Mark as Complete
                </button>
              ) : (
                <form onSubmit={handleComplete} className="flex flex-col gap-3">
                  <div>
                    <label style={labelStyle}>What was accomplished? *</label>
                    <textarea
                      value={output}
                      onChange={e => setOutput(e.target.value)}
                      rows={4}
                      placeholder="Summarise what was done in this session…"
                      style={{ ...inputStyle, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
                      autoFocus
                    />
                  </div>
                  {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={saving} className="flex-1 text-sm py-2 font-medium"
                      style={{ backgroundColor: saving ? '#ccc' : 'var(--green)', color: '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}>
                      {saving ? 'Completing…' : 'Complete Session'}
                    </button>
                    <button type="button" onClick={() => { setCompleting(false); setOutput(''); setError('') }} className="text-sm px-4 py-2"
                      style={{ border: '1px solid var(--border)', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: 'var(--text2)' }}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Sessions Tab ──────────────────────────────────────────────────────────────

function SessionsTab() {
  const qc = useQueryClient()
  const [newOpen, setNewOpen]         = useState(false)
  const [selected, setSelected]       = useState<Session | null>(null)
  const [filter, setFilter]           = useState('')

  const { data: sessionsData, isLoading, isError } = useQuery<{ sessions: Session[] }>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await fetch('/api/sessions', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load sessions')
      return res.json()
    },
  })

  const { data: projectsData } = useQuery<{ projects: Project[] }>({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch('/api/projects', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: usersData } = useQuery<{ users: User[] }>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const sessions = sessionsData?.sessions || []

  const filtered = useMemo(
    () => filter
      ? sessions.filter(s =>
          `${s.goal} ${s.project_name ?? ''} ${s.company_name}`.toLowerCase().includes(filter.toLowerCase())
        )
      : sessions,
    [sessions, filter]
  )

  const openCount = sessions.filter(s => !s.completed_at).length

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-6 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)', backgroundColor: '#fff' }}
      >
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Filter sessions…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ ...inputStyle, width: '220px' }}
          />
          {!isLoading && !isError && (
            <span className="text-sm" style={{ color: 'var(--text2)' }}>
              <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontWeight: 600, color: 'var(--text1)' }}>{openCount}</span>
              {' '}open
            </span>
          )}
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="text-sm px-4 py-2 font-medium"
          style={{ backgroundColor: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}
        >
          + New Session
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 flex flex-col gap-2">
            {[1,2,3,4].map(i => <div key={i} className="h-14 rounded animate-pulse" style={{ backgroundColor: '#E0E3E3' }} />)}
          </div>
        ) : isError ? (
          <div className="p-6"><p className="text-sm" style={{ color: 'var(--red)' }}>Failed to load sessions</p></div>
        ) : filtered.length === 0 ? (
          <div className="p-6"><p className="text-sm" style={{ color: 'var(--text3)' }}>No sessions found{filter ? ' matching that filter' : ''}.</p></div>
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#F2F3F3', borderBottom: '1px solid var(--border)' }}>
                {['Goal', 'Project', 'Company', 'Attendees', 'Scheduled', 'Status'].map(h => (
                  <th key={h} className="text-left px-4 py-2 font-medium text-xs uppercase" style={{ color: 'var(--text2)', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr
                  key={s.id}
                  onClick={() => setSelected(s)}
                  className="cursor-pointer hover:bg-gray-50"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text1)', maxWidth: '280px' }}>
                    <p className="truncate">{s.goal}</p>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{s.project_name || '—'}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{s.company_name}</td>
                  <td className="px-4 py-3" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)' }}>
                    {s.attendees?.length ?? 0}
                  </td>
                  <td className="px-4 py-3" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)', fontSize: '0.8rem' }}>
                    {s.scheduled_at
                      ? new Date(s.scheduled_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs px-2 py-0.5 font-medium"
                      style={{
                        borderRadius: '3px',
                        backgroundColor: s.completed_at ? '#EBF5E8' : '#FEF8EE',
                        color: s.completed_at ? 'var(--green)' : 'var(--amber)',
                      }}
                    >
                      {s.completed_at ? 'Completed' : 'Open'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SessionDetailSlideOver
        session={selected}
        onClose={() => setSelected(null)}
        onUpdated={() => {
          qc.invalidateQueries({ queryKey: ['sessions'] })
          setSelected(null)
        }}
      />

      <NewSessionSlideOver
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ['sessions'] })}
        projects={projectsData?.projects || []}
        users={usersData?.users || []}
      />
    </div>
  )
}

// ── Main Work Page ────────────────────────────────────────────────────────────

const TABS: { key: WorkTab; label: string }[] = [
  { key: 'tasks',    label: 'Tasks' },
  { key: 'projects', label: 'Projects' },
  { key: 'sessions', label: 'Sessions' },
]

export default function WorkPage() {
  const [activeTab, setActiveTab] = useState<WorkTab>('tasks')

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      <div className="px-6 pt-6 flex-shrink-0" style={{ backgroundColor: 'var(--bg)' }}>
        <h1
          className="text-xl font-semibold mb-4"
          style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}
        >
          Work
        </h1>
        <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
          {TABS.map(t => {
            const active = activeTab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className="text-sm px-4 py-2 font-medium transition-colors"
                style={{
                  borderTop: 'none', borderLeft: 'none', borderRight: 'none',
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

      <div className="flex-1" style={{ minHeight: 0 }}>
        {activeTab === 'tasks'    && <TasksTab />}
        {activeTab === 'projects' && <ProjectsTab />}
        {activeTab === 'sessions' && <SessionsTab />}
      </div>
    </div>
  )
}
