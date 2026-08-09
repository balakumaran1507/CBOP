'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, X, FileText, CheckCircle2, Wrench, Flag, AlertTriangle, Target, CalendarDays } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SlideOver } from '@/app/components/slide-over'

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus    = 'todo' | 'in_progress' | 'review' | 'done'
type TaskPriority  = 'low' | 'medium' | 'high' | 'critical'
type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'cancelled'
type ProjectHealth   = 'on_track' | 'at_risk' | 'blocked'
type ProjectCategory = 'client' | 'product' | 'ops' | 'rnd'
type WorkTab       = 'tasks' | 'projects' | 'rnd' | 'sessions' | 'goals' | 'calendar'

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
  start_date: string | null
  depends_on_task_id: string | null
  notes: string | null
  owner_id: string | null
  owner_name: string | null
  linked_deal_id: string | null
  created_at: string
}

interface Project {
  id: string
  company_id: string | null
  company_name: string | null
  name: string
  status: ProjectStatus
  work_type: 'client' | 'internal'
  category: ProjectCategory
  health: ProjectHealth
  deadline: string | null
  description: string | null
  owner_id: string | null
  owner_name: string | null
  tasks_count: number
  tasks_done: number
  created_at: string
}

interface KeyResult {
  id: string
  description: string
  target_value: number | null
  current_value: number
  unit: string | null
}

interface LinkedProject {
  id: string
  name: string
  status: string
  tasks_count: number
  tasks_done: number
}

interface Goal {
  id: string
  year: number
  quarter: number
  objective: string
  owner_id: string | null
  owner_name: string | null
  progress: number
  key_results: KeyResult[]
  linked_projects: LinkedProject[]
  created_at: string
}

type RndPhase = 'ideation' | 'exploration' | 'development' | 'analysis' | 'documentation' | 'publication'

interface RndInitiative {
  id: string
  title: string
  description: string | null
  domain: string
  status: 'exploring' | 'active' | 'paused' | 'concluded'
  phase: RndPhase
  hypothesis: string | null
  problem_statement: string | null
  budget_estimate: number | null
  milestones_total: number
  milestones_done: number
  resources_pending: number
  company_id: string | null
  company_name: string | null
  outcome: string | null
  tags: string[]
  log_count: number
  created_by_name: string | null
  updated_at: string
  created_at: string
}

interface RndMilestone {
  id: string
  initiative_id: string
  phase: RndPhase
  title: string
  due_date: string | null
  status: 'pending' | 'in_progress' | 'done' | 'blocked'
  sort_order: number
  created_at: string
}

interface RndResource {
  id: string
  initiative_id: string
  resource_type: 'budget' | 'api' | 'hardware' | 'software' | 'human' | 'other'
  name: string
  status: 'needed' | 'requested' | 'approved' | 'available' | 'rejected'
  estimated_cost: number | null
  notes: string | null
  created_at: string
}

interface RndReference {
  id: string
  initiative_id: string
  ref_type: 'paper' | 'code' | 'dataset' | 'tool' | 'competitor' | 'related_work' | 'inspiration' | 'standard'
  title: string
  url: string | null
  notes: string | null
  is_pinned: boolean
  created_at: string
}

interface RndPublication {
  id: string
  initiative_id: string
  pub_type: 'ieee_paper' | 'conference' | 'blog_post' | 'linkedin' | 'internal_report' | 'patent' | 'whitepaper' | 'demo'
  status: 'not_started' | 'drafting' | 'review' | 'submitted' | 'published' | 'rejected'
  target_venue: string | null
  target_date: string | null
  checklist: { id: string; text: string; done: boolean }[]
  notes: string | null
  created_at: string
}

interface RndLogEntry {
  id: string
  body: string
  entry_type: string
  created_by_name: string | null
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

interface CalendarItem {
  id: string
  date: string
  label: string
  color: string
  textColor: string
  onClick: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '-'
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

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
}

const PROJECT_STATUS_STYLE: Record<ProjectStatus, React.CSSProperties> = {
  active:    { backgroundColor: '#EBF5E8', color: '#1D8102' },
  on_hold:   { backgroundColor: '#FEF8EE', color: '#E8820C' },
  completed: { backgroundColor: '#F2F3F3', color: '#687078' },
  cancelled: { backgroundColor: '#FEF0EE', color: '#D13212' },
}

const HEALTH_STYLE: Record<ProjectHealth, { dot: string; label: string }> = {
  on_track: { dot: '#1D8102', label: 'On Track' },
  at_risk:  { dot: '#E8820C', label: 'At Risk'  },
  blocked:  { dot: '#D13212', label: 'Blocked'  },
}

// ── Calendar hook + components ────────────────────────────────────────────────

function useCalendarMonth() {
  const [viewDate, setViewDate] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const monthLabel = viewDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  return {
    year, month, monthLabel,
    prev:  () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1)),
    next:  () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1)),
    today: () => { const d = new Date(); d.setDate(1); setViewDate(d) },
  }
}

function CalendarGrid({ items, monthLabel, onPrev, onNext, onToday, year, month }: {
  items: CalendarItem[]
  monthLabel: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  year: number
  month: number
}) {
  const firstDow  = new Date(year, month, 1).getDay()
  const daysInMo  = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMo }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>()
    for (const item of items) {
      if (!map.has(item.date)) map.set(item.date, [])
      map.get(item.date)!.push(item)
    }
    return map
  }, [items])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={onPrev}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, width: 32, height: 32, cursor: 'pointer', color: 'var(--text2)', fontSize: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            ‹
          </button>
          <span style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: '1rem', color: 'var(--text1)', minWidth: 180, textAlign: 'center' }}>
            {monthLabel}
          </span>
          <button onClick={onNext}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, width: 32, height: 32, cursor: 'pointer', color: 'var(--text2)', fontSize: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            ›
          </button>
          <button onClick={onToday}
            style={{ fontSize: 12, color: 'var(--blue)', background: 'none', border: '1px solid var(--blue)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', marginLeft: 8, fontFamily: 'var(--font-inter), sans-serif' }}>
            Today
          </button>
        </div>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)', backgroundColor: '#F8F9FA' }}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
            <div key={d} style={{ padding: '8px', fontSize: 11, fontWeight: 600, color: 'var(--text2)', textAlign: 'center', letterSpacing: '0.04em', fontFamily: 'var(--font-inter), sans-serif' }}>
              {d}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((day, i) => {
            const isLastCol = i % 7 === 6
            if (!day) return (
              <div key={i} style={{ minHeight: 110, borderRight: isLastCol ? 'none' : '1px solid var(--border)', borderBottom: '1px solid var(--border)', backgroundColor: '#FAFAFA' }} />
            )
            const dateKey = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const cellItems = byDate.get(dateKey) || []
            const isToday   = dateKey === todayKey
            const isPast    = dateKey < todayKey
            const shown     = cellItems.slice(0, 3)
            const overflow  = cellItems.length - shown.length
            return (
              <div key={i} style={{
                minHeight: 110,
                borderRight:  isLastCol ? 'none' : '1px solid var(--border)',
                borderBottom: '1px solid var(--border)',
                padding: '6px 5px 4px',
                backgroundColor: isToday ? '#EBF5FB' : '#fff',
              }}>
                <span style={{
                  display: 'block', marginBottom: 4, fontSize: 12,
                  fontFamily: 'var(--font-ibm-plex-mono), monospace',
                  fontWeight: isToday ? 700 : 400,
                  color: isToday ? 'var(--blue)' : isPast ? 'var(--text3)' : 'var(--text1)',
                }}>
                  {day}
                </span>
                {shown.map(item => (
                  <div
                    key={item.id}
                    onClick={item.onClick}
                    title={item.label}
                    style={{
                      fontSize: 11, padding: '2px 5px', borderRadius: 3, marginBottom: 2,
                      cursor: item.onClick.toString() !== '() => {}' ? 'pointer' : 'default',
                      backgroundColor: item.color, color: item.textColor,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  >
                    {item.label}
                  </div>
                ))}
                {overflow > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--text3)', padding: '0 2px' }}>+{overflow} more</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function tasksToCalendarItems(tasks: Task[], onSelect: (t: Task) => void): CalendarItem[] {
  return tasks
    .filter(t => !!t.due_date)
    .map(t => ({
      id:        t.id,
      date:      t.due_date!.slice(0, 10),
      label:     t.title,
      color:     (PRIORITY_STYLE[t.priority].backgroundColor as string) ?? '#F2F3F3',
      textColor: (PRIORITY_STYLE[t.priority].color as string) ?? '#333',
      onClick:   () => onSelect(t),
    }))
}

function rndToCalendarItems(initiatives: RndInitiative[]): CalendarItem[] {
  return initiatives.map(r => ({
    id:        r.id,
    date:      r.created_at.slice(0, 10),
    label:     r.title,
    color:     '#FFF7ED',
    textColor: '#C2410C',
    onClick:   () => {},
  }))
}

const CATEGORY_STYLE: Record<ProjectCategory, { bg: string; color: string; label: string }> = {
  client:  { bg: '#EBF5FB', color: '#0073BB', label: 'Client'  },
  product: { bg: '#EEF2FF', color: '#4338CA', label: 'Product' },
  ops:     { bg: '#F0FFF4', color: '#1D8102', label: 'Ops'     },
  rnd:     { bg: '#FFF7ED', color: '#C2410C', label: 'R&D'     },
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
  onClick,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  task: Task
  onClick: (task: Task) => void
  onDragStart: (taskId: string, fromStatus: TaskStatus) => void
  onDragEnd: () => void
  isDragging: boolean
}) {
  const overdue = isOverdue(task.due_date, task.status)
  return (
    <div
      onClick={() => onClick(task)}
      className="bg-white rounded mb-2 p-3 cursor-pointer"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(task.id, task.status)
      }}
      onDragEnd={onDragEnd}
      style={{
        border: `1px solid ${overdue ? 'var(--amber)' : 'var(--border)'}`,
        boxShadow: isDragging ? '0 4px 14px rgba(0,0,0,0.18)' : '0 1px 3px rgba(0,0,0,0.06)',
        opacity: isDragging ? 0.5 : 1,
        transform: isDragging ? 'rotate(-1.5deg) scale(1.02)' : 'none',
        transition: 'opacity 0.15s, box-shadow 0.15s, transform 0.15s',
        cursor: 'grab',
      }}
    >
      <p className="text-sm font-medium mb-1.5 leading-snug" style={{ color: 'var(--text1)' }}>
        {task.title}
      </p>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#E8F4FB', color: 'var(--blue)' }}>
          {task.company_name}
        </span>
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

// ── Timeline / Gantt view ────────────────────────────────────────────────────
// The real gap vs Linear/Asana - Kanban shows status, Timeline shows when work
// happens and what blocks what. start_date falls back to created_at when unset.

const STATUS_BAR_COLOR: Record<TaskStatus, string> = {
  todo: '#AAB5BB', in_progress: '#0073BB', review: '#E8820C', done: '#1D8102',
}

const STATUS_BAR_GRADIENT: Record<TaskStatus, string> = {
  todo:        'linear-gradient(180deg, #C2CBD0 0%, #AAB5BB 100%)',
  in_progress: 'linear-gradient(180deg, #1C8FDB 0%, #0073BB 100%)',
  review:      'linear-gradient(180deg, #F3993C 0%, #E8820C 100%)',
  done:        'linear-gradient(180deg, #329A21 0%, #1D8102 100%)',
}

const ROW_HEIGHT = 34
const BAR_HEIGHT = 20

function TimelineView({ tasks, onSelect }: { tasks: Task[]; onSelect: (t: Task) => void }) {
  const withDates = tasks.filter(t => t.due_date || t.start_date)

  const byProject = useMemo(() => {
    const map = new Map<string, { name: string; company: string; tasks: Task[] }>()
    for (const t of withDates) {
      if (!map.has(t.project_id)) map.set(t.project_id, { name: t.project_name, company: t.company_name, tasks: [] })
      map.get(t.project_id)!.tasks.push(t)
    }
    // Order each project's rows chronologically so dependency connectors read top-to-bottom.
    for (const g of map.values()) {
      g.tasks.sort((a, b) => new Date(a.start_date || a.created_at).getTime() - new Date(b.start_date || b.created_at).getTime())
    }
    return Array.from(map.values())
  }, [withDates])

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  if (withDates.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}>
        <p className="text-sm" style={{ color: 'var(--text3)' }}>No tasks with dates yet — add a due date to see them on the timeline</p>
      </div>
    )
  }

  const starts = withDates.map(t => new Date(t.start_date || t.created_at).getTime())
  const ends   = withDates.map(t => new Date(t.due_date || t.start_date || t.created_at).getTime())
  const rangeStart = Math.min(...starts, Date.now() - 7 * 86400000)
  const rangeEnd   = Math.max(...ends, Date.now() + 7 * 86400000)
  const rangeSpan  = Math.max(rangeEnd - rangeStart, 86400000)

  const pctNum = (t: number) => ((t - rangeStart) / rangeSpan) * 100
  const pctOf  = (t: number) => `${pctNum(t)}%`
  const todayPct = pctOf(Date.now())

  // Day-level ticks; render a label only every 7 days but shade every weekend.
  const dayMs = 86400000
  const days: number[] = []
  for (let t = rangeStart - (rangeStart % dayMs); t <= rangeEnd; t += dayMs) days.push(t)
  const weekTicks = days.filter((_, i) => i % 7 === 0)

  return (
    <div className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="px-6 py-5" style={{ minWidth: 960 }}>
        {byProject.map(group => {
          const taskById = new Map(group.tasks.map((t, i) => [t.id, i]))
          const done = group.tasks.filter(t => t.status === 'done').length
          const isCollapsed = collapsed.has(group.name)

          return (
            <div
              key={group.name}
              className="rounded mb-4"
              style={{ border: '1px solid var(--border)', backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}
            >
              {/* Group header */}
              <div
                onClick={() => setCollapsed(s => { const n = new Set(s); n.has(group.name) ? n.delete(group.name) : n.add(group.name); return n })}
                className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none"
                style={{ backgroundColor: '#F8F9FA', borderBottom: isCollapsed ? 'none' : '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span style={{ fontSize: 10, color: 'var(--text3)', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▾</span>
                  <span className="text-sm font-semibold truncate" style={{ color: 'var(--text1)', fontFamily: 'var(--font-syne), sans-serif' }}>{group.name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ backgroundColor: '#E8F4FB', color: 'var(--blue)' }}>{group.company}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div style={{ width: 70, height: 5, borderRadius: 3, backgroundColor: '#E5E7EB', overflow: 'hidden' }}>
                    <div style={{ width: `${(done / group.tasks.length) * 100}%`, height: '100%', backgroundColor: 'var(--green)' }} />
                  </div>
                  <span className="text-xs" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text3)' }}>{done}/{group.tasks.length}</span>
                </div>
              </div>

              {!isCollapsed && (
                <div style={{ position: 'relative' }}>
                  {/* Weekend shading + gridlines spanning the full group height */}
                  <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
                    {days.map(d => {
                      const dow = new Date(d).getDay()
                      if (dow !== 0 && dow !== 6) return null
                      return (
                        <div key={d} style={{ position: 'absolute', left: pctOf(d), width: `${(dayMs / rangeSpan) * 100}%`, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.025)' }} />
                      )
                    })}
                    {weekTicks.map(t => (
                      <div key={t} style={{ position: 'absolute', left: pctOf(t), top: 0, bottom: 0, width: 1, backgroundColor: '#EDEFEF' }} />
                    ))}
                    {/* Today marker */}
                    <div style={{ position: 'absolute', left: todayPct, top: 0, bottom: 0, width: 1.5, backgroundColor: '#D13212', opacity: 0.55 }} />
                  </div>

                  {/* Dependency connectors */}
                  <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }}>
                    {group.tasks.map((t, i) => {
                      if (!t.depends_on_task_id) return null
                      const depIdx = taskById.get(t.depends_on_task_id)
                      if (depIdx === undefined) return null
                      const dep = group.tasks[depIdx]
                      const depEnd   = new Date(dep.due_date || dep.start_date || dep.created_at).getTime()
                      const curStart = new Date(t.start_date || t.created_at).getTime()
                      const x1 = pctNum(depEnd)
                      const x2 = pctNum(curStart)
                      const y1 = depIdx * ROW_HEIGHT + ROW_HEIGHT / 2
                      const y2 = i * ROW_HEIGHT + ROW_HEIGHT / 2
                      const yTop = Math.min(y1, y2)
                      const yH   = Math.abs(y2 - y1)
                      return (
                        <div key={t.id}>
                          <div style={{ position: 'absolute', left: `${Math.min(x1, x2)}%`, width: `${Math.max(Math.abs(x2 - x1), 0.3)}%`, top: y1 - 1, height: 1.5, backgroundColor: '#E8820C', opacity: 0.5 }} />
                          <div style={{ position: 'absolute', left: `${x2}%`, top: yTop, height: yH, width: 1.5, backgroundColor: '#E8820C', opacity: 0.5 }} />
                        </div>
                      )
                    })}
                  </div>

                  {/* Rows */}
                  <div style={{ position: 'relative', zIndex: 2 }}>
                    {group.tasks.map(t => {
                      const s = new Date(t.start_date || t.created_at).getTime()
                      const e = new Date(t.due_date || t.start_date || t.created_at).getTime()
                      const overdue = isOverdue(t.due_date, t.status)
                      return (
                        <div
                          key={t.id}
                          className="flex items-center gap-3 px-4 hover:bg-gray-50"
                          style={{ height: ROW_HEIGHT }}
                        >
                          <div className="flex items-center gap-1.5 flex-shrink-0" style={{ width: 220 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: PRIORITY_STYLE[t.priority].color as string, flexShrink: 0 }} />
                            <span
                              className="text-xs truncate"
                              style={{ color: 'var(--text1)', cursor: 'pointer' }}
                              onClick={() => onSelect(t)}
                            >
                              {t.title}
                            </span>
                          </div>
                          <div style={{ flex: 1, position: 'relative', height: BAR_HEIGHT }}>
                            <div
                              onClick={() => onSelect(t)}
                              title={`${t.title}\n${t.owner_name || 'Unassigned'} · ${PRIORITY_LABEL[t.priority]}${t.due_date ? `\nDue ${new Date(t.due_date).toLocaleDateString('en-IN')}` : ''}`}
                              className="hover:brightness-105"
                              style={{
                                position: 'absolute', left: pctOf(s), width: `max(1.5%, ${pctNum(e) - pctNum(s)}%)`,
                                height: BAR_HEIGHT, top: 0, borderRadius: 5,
                                background: STATUS_BAR_GRADIENT[t.status],
                                border: overdue ? '1px solid var(--amber)' : 'none',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                                cursor: 'pointer',
                                opacity: t.status === 'done' ? 0.7 : 1,
                                transition: 'filter 0.1s',
                              }}
                            />
                          </div>
                          <span
                            className="text-xs flex-shrink-0"
                            style={{
                              width: 74, textAlign: 'right',
                              fontFamily: 'var(--font-ibm-plex-mono), monospace',
                              color: overdue ? 'var(--amber)' : 'var(--text3)',
                              fontWeight: overdue ? 600 : 400,
                            }}
                          >
                            {t.due_date ? new Date(t.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Task Slide-over ───────────────────────────────────────────────────────────

function TaskSlideOver({
  task, onClose, onSaved, projects, users, allTasks,
}: {
  task: Task | null
  onClose: () => void
  onSaved: () => void
  projects: Project[]
  users: User[]
  allTasks: Task[]
}) {
  const [status,   setStatus]   = useState<TaskStatus>('todo')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [title,    setTitle]    = useState('')
  const [notes,    setNotes]    = useState('')
  const [dueDate,  setDueDate]  = useState('')
  const [startDate, setStartDate] = useState('')
  const [dependsOn, setDependsOn] = useState('')
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
      setStartDate(task.start_date || '')
      setDependsOn(task.depends_on_task_id || '')
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
          start_date: startDate || null,
          depends_on_task_id: dependsOn || null,
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
    <SlideOver isOpen={true} onClose={onClose} title="Edit Task">
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
                <label style={labelStyle}>Start Date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ ...inputStyle, fontFamily: 'var(--font-ibm-plex-mono), monospace' }} />
              </div>
              <div>
                <label style={labelStyle}>Due Date</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ ...inputStyle, fontFamily: 'var(--font-ibm-plex-mono), monospace' }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Owner</label>
                <select value={ownerId} onChange={e => setOwnerId(e.target.value)} style={inputStyle}>
                  <option value="">- Unassigned -</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Depends On</label>
                <select value={dependsOn} onChange={e => setDependsOn(e.target.value)} style={inputStyle}>
                  <option value="">- None -</option>
                  {allTasks.filter(t => t.id !== task.id).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
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
    </SlideOver>
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

  return (
    <SlideOver isOpen={open} onClose={onClose} title="New Task">
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label style={labelStyle}>Project *</label>
              <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} style={inputStyle}>
                <option value="">- Select project -</option>
                {projects.filter(p => p.status === 'active').map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.company_name ? ` (${p.company_name})` : p.work_type === 'internal' ? ' [Internal]' : ''}</option>
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
                <option value="">- Assign to me -</option>
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
    </SlideOver>
  )
}

// ── Task Kanban Column ────────────────────────────────────────────────────────

function TaskColumn({
  col,
  tasks,
  onSelect,
  onDragStart,
  onDragEnd,
  onDropTask,
  draggingTaskId,
  draggingFromStatus,
}: {
  col: { key: TaskStatus; label: string }
  tasks: Task[]
  onSelect: (task: Task) => void
  onDragStart: (taskId: string, fromStatus: TaskStatus) => void
  onDragEnd: () => void
  onDropTask: (taskId: string, toStatus: TaskStatus) => void
  draggingTaskId: string | null
  draggingFromStatus: TaskStatus | null
}) {
  const [isDragOver, setIsDragOver] = useState(false)
  const isValidDropTarget = draggingTaskId != null && draggingFromStatus !== col.key

  return (
    <div
      style={{ width: '260px', flexShrink: 0 }}
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
        const taskId = e.dataTransfer.getData('text/plain')
        if (taskId) onDropTask(taskId, col.key)
      }}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-xs font-semibold uppercase" style={{ color: 'var(--text2)', letterSpacing: '0.06em' }}>
          {col.label}
        </span>
        <span
          className="text-xs font-semibold"
          style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text3)' }}
        >
          {tasks.length}
        </span>
      </div>
      <div
        className="rounded p-2"
        style={{
          backgroundColor: isDragOver && isValidDropTarget ? '#E8F0F7' : (col.key === 'done' ? '#F2F3F3' : '#EAECEC'),
          border: isDragOver && isValidDropTarget ? '2px dashed var(--blue)' : '2px solid transparent',
          minHeight: '120px',
          transition: 'background-color 0.15s, border-color 0.15s',
        }}
      >
        {tasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            onClick={onSelect}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            isDragging={draggingTaskId === task.id}
          />
        ))}
        {tasks.length === 0 && (
          <p className="text-xs text-center py-4" style={{ color: isDragOver && isValidDropTarget ? 'var(--blue)' : 'var(--text3)' }}>
            {isDragOver && isValidDropTarget ? 'Drop here' : 'Empty'}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Tasks Tab ─────────────────────────────────────────────────────────────────

function TasksTab() {
  const qc = useQueryClient()
  const [mineOnly, setMineOnly]     = useState(false)
  const [newOpen, setNewOpen]       = useState(false)
  const [selectedTask, setSelected] = useState<Task | null>(null)
  const [viewMode, setViewMode]     = useState<'kanban' | 'timeline' | 'calendar'>('kanban')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const taskCal = useCalendarMonth()
  const [draggingTaskId, setDraggingTaskId]         = useState<string | null>(null)
  const [draggingFromStatus, setDraggingFromStatus] = useState<TaskStatus | null>(null)

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies'],
    queryFn: async () => {
      const res = await fetch('/api/companies', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load companies')
      return res.json()
    },
  })

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

  const allTasks = tasksData?.tasks || []
  const companies = companiesData?.companies || []
  const tasks = allTasks
    .filter(t => companyFilter === 'all' || t.company_id === companyFilter)
    .filter(t => projectFilter === 'all' || t.project_id === projectFilter)

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], review: [], done: [] }
    tasks.forEach(t => map[t.status]?.push(t))
    return map
  }, [tasks])

  const totalOpen = tasks.filter(t => t.status !== 'done').length

  function handleDragStart(taskId: string, fromStatus: TaskStatus) {
    setDraggingTaskId(taskId)
    setDraggingFromStatus(fromStatus)
  }

  function handleDragEnd() {
    setDraggingTaskId(null)
    setDraggingFromStatus(null)
  }

  function handleDropTask(taskId: string, toStatus: TaskStatus) {
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.status === toStatus) return
    moveTask.mutate({ id: taskId, status: toStatus })
  }

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
          <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {(['kanban', 'timeline', 'calendar'] as const).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className="text-xs px-3 py-1.5 font-medium transition-colors capitalize"
                style={{
                  backgroundColor: viewMode === v ? 'var(--blue)' : '#fff',
                  color:           viewMode === v ? '#fff' : 'var(--text2)',
                  border:          'none', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif',
                }}
              >
                {v}
              </button>
            ))}
          </div>
          {companies.length > 1 && (
            <select
              value={companyFilter}
              onChange={e => setCompanyFilter(e.target.value)}
              style={{ height: 30, border: '1px solid var(--border)', borderRadius: 6, padding: '0 8px', fontSize: 12.5, background: '#fff', color: 'var(--text1)' }}
            >
              <option value="all">All Companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <select
            value={projectFilter}
            onChange={e => setProjectFilter(e.target.value)}
            style={{ height: 30, border: '1px solid var(--border)', borderRadius: 6, padding: '0 8px', fontSize: 12.5, background: '#fff', color: 'var(--text1)' }}
          >
            <option value="all">All Projects</option>
            {(projectsData?.projects || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {viewMode === 'kanban' && (
            <p className="text-xs hidden md:block" style={{ color: 'var(--text3)' }}>
              Drag a card to another column to change its status
            </p>
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

      {viewMode === 'timeline' && !isLoading && !isError && (
        <TimelineView tasks={tasks} onSelect={setSelected} />
      )}

      {viewMode === 'calendar' && !isLoading && !isError && (
        <div className="flex-1 overflow-auto p-6" style={{ backgroundColor: 'var(--bg)' }}>
          <CalendarGrid
            items={tasksToCalendarItems(tasks, setSelected)}
            monthLabel={taskCal.monthLabel}
            onPrev={taskCal.prev}
            onNext={taskCal.next}
            onToday={taskCal.today}
            year={taskCal.year}
            month={taskCal.month}
          />
        </div>
      )}

      {/* Kanban board */}
      {viewMode === 'kanban' && (
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
            {TASK_COLUMNS.map(col => (
              <TaskColumn
                key={col.key}
                col={col}
                tasks={byStatus[col.key]}
                onSelect={setSelected}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDropTask={handleDropTask}
                draggingTaskId={draggingTaskId}
                draggingFromStatus={draggingFromStatus}
              />
            ))}
          </div>
        )}
      </div>
      )}

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
        allTasks={allTasks}
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
  const [form, setForm] = useState({ category: 'client' as ProjectCategory, company_id: '', name: '', description: '', deadline: '', owner_id: '' })
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)

  if (open && !form.company_id && companies.length > 0 && form.category === 'client') {
    setForm(f => ({ ...f, company_id: companies[0].id }))
  }

  const CATEGORY_HELP: Record<ProjectCategory, string> = {
    client:  'Billable work tied to a client company.',
    product: 'Internal software, tools, CBOP development.',
    ops:     'Administration, HR, compliance, marketing.',
    rnd:     'Research, exploration, security assessments.',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim())                               { setError('Name is required'); return }
    if (form.category === 'client' && !form.company_id) { setError('Company is required for client projects'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/projects', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category:    form.category,
          company_id:  form.category === 'client' ? form.company_id : undefined,
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
          <button onClick={onClose} style={{ color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            {/* Category selector */}
            <div>
              <label style={labelStyle}>Category</label>
              <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                {(['client', 'product', 'ops', 'rnd'] as ProjectCategory[]).map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, category: cat }))}
                    className="flex-1 text-xs py-2 font-medium transition-colors"
                    style={{
                      backgroundColor: form.category === cat ? CATEGORY_STYLE[cat].color : '#fff',
                      color: form.category === cat ? '#fff' : 'var(--text2)',
                      border: 'none', cursor: 'pointer',
                    }}
                  >
                    {CATEGORY_STYLE[cat].label}
                  </button>
                ))}
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
                {CATEGORY_HELP[form.category]}
              </p>
            </div>

            {form.category === 'client' && (
              <div>
                <label style={labelStyle}>Company *</label>
                <select value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))} style={inputStyle}>
                  <option value="">- Select company -</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

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
                  <option value="">- Assign to me -</option>
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
            <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
              {project.company_name ?? (project.work_type === 'internal' ? 'Internal' : '-')}
            </p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}><X size={18} /></button>
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

          {/* Health */}
          <div>
            <p className="text-xs font-semibold uppercase mb-2" style={{ color: 'var(--text2)', letterSpacing: '0.06em' }}>Project Health</p>
            <div className="flex gap-2">
              {(['on_track', 'at_risk', 'blocked'] as ProjectHealth[]).map(h => (
                <button
                  key={h}
                  onClick={async () => {
                    await fetch(`/api/projects/${project.id}`, {
                      method: 'PATCH', credentials: 'include',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ health: h }),
                    })
                    onUpdated()
                  }}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 font-medium"
                  style={{
                    backgroundColor: project.health === h ? HEALTH_STYLE[h].dot : '#fff',
                    color: project.health === h ? '#fff' : HEALTH_STYLE[h].dot,
                    border: `1px solid ${HEALTH_STYLE[h].dot}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: project.health === h ? '#fff' : HEALTH_STYLE[h].dot, flexShrink: 0, display: 'inline-block' }} />
                  {HEALTH_STYLE[h].label}
                </button>
              ))}
            </div>
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
  const [filter,    setFilter]    = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'client' | 'product' | 'ops' | 'rnd'>('all')
  const [companyFilter, setCompanyFilter] = useState('all')
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
  const companies = companiesData?.companies || []

  const filtered = useMemo(() => {
    let list = projects
    if (typeFilter !== 'all') list = list.filter(p => p.category === typeFilter)
    if (companyFilter !== 'all') list = list.filter(p => p.company_id === companyFilter)
    if (filter) list = list.filter(p => `${p.name} ${p.company_name ?? ''}`.toLowerCase().includes(filter.toLowerCase()))
    return list
  }, [projects, filter, typeFilter, companyFilter])

  const activeCount = projects.filter(p => p.status === 'active').length

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-6 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)', backgroundColor: '#fff' }}
      >
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Filter projects…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ ...inputStyle, width: '200px' }}
          />
          {/* Category filter */}
          <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {(['all', 'client', 'product', 'ops', 'rnd'] as const).map(t => (
              <button key={t} type="button"
                onClick={() => setTypeFilter(t)}
                className="text-xs px-3 py-1.5 font-medium transition-colors"
                style={{
                  backgroundColor: typeFilter === t ? 'var(--blue)' : '#fff',
                  color: typeFilter === t ? '#fff' : 'var(--text2)',
                  border: 'none', cursor: 'pointer',
                }}
              >{t === 'all' ? 'All' : t === 'rnd' ? 'R&D' : t.charAt(0).toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
          {companies.length > 1 && (
            <select
              value={companyFilter}
              onChange={e => setCompanyFilter(e.target.value)}
              style={{ height: 34, border: '1px solid var(--border)', borderRadius: 6, padding: '0 10px', fontSize: 13, background: '#fff', color: 'var(--text1)' }}
            >
              <option value="all">All Companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
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
                {['Project', 'Category', 'Health', 'Company', 'Status', 'Tasks', 'Progress', 'Owner', 'Deadline'].map(h => (
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
                    <td className="px-4 py-3">
                      {p.category ? (
                        <span className="text-xs px-2 py-0.5 font-medium" style={{ borderRadius: '3px', backgroundColor: CATEGORY_STYLE[p.category]?.bg, color: CATEGORY_STYLE[p.category]?.color }}>
                          {CATEGORY_STYLE[p.category]?.label}
                        </span>
                      ) : <span style={{ color: 'var(--text3)' }}>-</span>}
                    </td>
                    <td className="px-4 py-3">
                      {p.health ? (
                        <div className="flex items-center gap-1.5">
                          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: HEALTH_STYLE[p.health]?.dot, flexShrink: 0, display: 'inline-block' }} />
                          <span className="text-xs" style={{ color: 'var(--text2)' }}>{HEALTH_STYLE[p.health]?.label}</span>
                        </div>
                      ) : <span style={{ color: 'var(--text3)' }}>-</span>}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{p.company_name ?? <span style={{ color: 'var(--text3)' }}>-</span>}</td>
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
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{p.owner_name || '-'}</td>
                    <td className="px-4 py-3" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)', fontSize: '0.8rem' }}>
                      {p.deadline ? fmtDate(p.deadline) : '-'}
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
          <button onClick={onClose} style={{ color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}><X size={18} /></button>
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
                <option value="">- Select project -</option>
                {projects.filter(p => p.status === 'active').map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.company_name ? ` (${p.company_name})` : p.work_type === 'internal' ? ' [Internal]' : ''}</option>
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
    if (!output.trim()) { setError('Output is required - describe what was accomplished'); return }
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
          <button onClick={onClose} style={{ color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}><X size={18} /></button>
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
  const [companyFilter, setCompanyFilter] = useState('all')

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies'],
    queryFn: async () => {
      const res = await fetch('/api/companies', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load companies')
      return res.json()
    },
  })

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
  const companies = companiesData?.companies || []

  const filtered = useMemo(() => {
    let list = sessions
    if (companyFilter !== 'all') list = list.filter(s => s.company_id === companyFilter)
    if (filter) list = list.filter(s =>
      `${s.goal} ${s.project_name ?? ''} ${s.company_name}`.toLowerCase().includes(filter.toLowerCase())
    )
    return list
  }, [sessions, filter, companyFilter])

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
          {companies.length > 1 && (
            <select
              value={companyFilter}
              onChange={e => setCompanyFilter(e.target.value)}
              style={{ height: 34, border: '1px solid var(--border)', borderRadius: 6, padding: '0 10px', fontSize: 13, background: '#fff', color: 'var(--text1)' }}
            >
              <option value="all">All Companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
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
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{s.project_name || '-'}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{s.company_name}</td>
                  <td className="px-4 py-3" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)' }}>
                    {s.attendees?.length ?? 0}
                  </td>
                  <td className="px-4 py-3" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)', fontSize: '0.8rem' }}>
                    {s.scheduled_at
                      ? new Date(s.scheduled_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
                      : '-'}
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

// ── R&D helpers ───────────────────────────────────────────────────────────────

const DOMAIN_STYLE: Record<string, { bg: string; color: string }> = {
  security:  { bg: '#FEF0EE', color: '#D13212' },
  ctf:       { bg: '#F3E8FF', color: '#7C3AED' },
  design:    { bg: '#EBF5FB', color: '#0073BB' },
  ai:        { bg: '#EBF5E8', color: '#1D8102' },
  infra:     { bg: '#FEF8EE', color: '#E8820C' },
  devops:    { bg: '#F2F3F3', color: '#546474' },
  marketing: { bg: '#FEF0EE', color: '#BE185D' },
  tooling:   { bg: '#E0F7FA', color: '#0891B2' },
  other:     { bg: '#F2F3F3', color: '#687078' },
}

const ENTRY_TYPE_STYLE: Record<string, { bg: string; color: string; Icon: LucideIcon }> = {
  note:       { bg: '#F2F3F3', color: '#687078', Icon: FileText },
  experiment: { bg: '#FEF8EE', color: '#E8820C', Icon: FlaskConical },
  finding:    { bg: '#EBF5E8', color: '#1D8102', Icon: CheckCircle2 },
  prototype:  { bg: '#EBF5FB', color: '#0073BB', Icon: Wrench },
  milestone:  { bg: '#F3E8FF', color: '#7C3AED', Icon: Flag },
  blocker:    { bg: '#FEF0EE', color: '#D13212', Icon: AlertTriangle },
}

const RND_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  exploring: { bg: '#EBF5FB', color: '#0073BB' },
  active:    { bg: '#EBF5E8', color: '#1D8102' },
  paused:    { bg: '#FEF8EE', color: '#E8820C' },
  concluded: { bg: '#F2F3F3', color: '#687078' },
}

const RND_PHASES: { key: RndPhase; label: string; color: string }[] = [
  { key: 'ideation',      label: 'Ideation',      color: '#7C3AED' },
  { key: 'exploration',   label: 'Exploration',   color: '#0073BB' },
  { key: 'development',   label: 'Development',   color: '#E8820C' },
  { key: 'analysis',      label: 'Analysis',      color: '#0891B2' },
  { key: 'documentation', label: 'Documentation', color: '#059669' },
  { key: 'publication',   label: 'Publication',   color: '#1D8102' },
]

const RESOURCE_TYPE_LABEL: Record<string, string> = {
  budget: 'Budget', api: 'API', hardware: 'Hardware',
  software: 'Software', human: 'People', other: 'Other',
}

const RESOURCE_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  needed:    { bg: '#FEF0EE', color: '#D13212' },
  requested: { bg: '#FEF8EE', color: '#E8820C' },
  approved:  { bg: '#EBF5E8', color: '#1D8102' },
  available: { bg: '#E8F4FB', color: '#0073BB' },
  rejected:  { bg: '#F2F3F3', color: '#687078' },
}

const REF_TYPE_LABEL: Record<string, string> = {
  paper: 'Paper', code: 'Code', dataset: 'Dataset', tool: 'Tool',
  competitor: 'Competitor', related_work: 'Related Work',
  inspiration: 'Inspiration', standard: 'Standard',
}

const PUB_TYPE_LABEL: Record<string, string> = {
  ieee_paper: 'IEEE Paper', conference: 'Conference', blog_post: 'Blog Post',
  linkedin: 'LinkedIn', internal_report: 'Internal Report',
  patent: 'Patent', whitepaper: 'Whitepaper', demo: 'Demo',
}

const PUB_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  not_started: { bg: '#F2F3F3', color: '#687078' },
  drafting:    { bg: '#EEF2FF', color: '#4338CA' },
  review:      { bg: '#FEF8EE', color: '#E8820C' },
  submitted:   { bg: '#E8F4FB', color: '#0073BB' },
  published:   { bg: '#EBF5E8', color: '#1D8102' },
  rejected:    { bg: '#FEF0EE', color: '#D13212' },
}

const PUB_DEFAULT_CHECKLISTS: Record<string, { id: string; text: string; done: boolean }[]> = {
  ieee_paper:      [
    { id: '1', text: 'Define research question and scope', done: false },
    { id: '2', text: 'Literature review complete', done: false },
    { id: '3', text: 'Methodology documented', done: false },
    { id: '4', text: 'Experiments / results collected', done: false },
    { id: '5', text: 'Abstract written', done: false },
    { id: '6', text: 'Introduction and related work sections written', done: false },
    { id: '7', text: 'Results and discussion sections written', done: false },
    { id: '8', text: 'Conclusion and future work written', done: false },
    { id: '9', text: 'References formatted in IEEE style', done: false },
    { id: '10', text: 'Figures and tables finalized', done: false },
    { id: '11', text: 'Internal peer review done', done: false },
    { id: '12', text: 'Plagiarism check passed', done: false },
    { id: '13', text: 'Submission portal account created', done: false },
    { id: '14', text: 'Paper submitted to target venue', done: false },
  ],
  conference:      [
    { id: '1', text: 'Call for papers deadline confirmed', done: false },
    { id: '2', text: 'Abstract submitted', done: false },
    { id: '3', text: 'Full paper written', done: false },
    { id: '4', text: 'Presentation slides prepared', done: false },
    { id: '5', text: 'Registration completed', done: false },
    { id: '6', text: 'Travel and accommodation booked', done: false },
  ],
  blog_post:       [
    { id: '1', text: 'Topic and angle defined', done: false },
    { id: '2', text: 'Outline drafted', done: false },
    { id: '3', text: 'First draft written', done: false },
    { id: '4', text: 'Images / diagrams prepared', done: false },
    { id: '5', text: 'Internal review done', done: false },
    { id: '6', text: 'SEO keywords added', done: false },
    { id: '7', text: 'Published on website', done: false },
  ],
  linkedin:        [
    { id: '1', text: 'Key insight identified', done: false },
    { id: '2', text: 'Post drafted (≤3000 chars)', done: false },
    { id: '3', text: 'Visual/graphic attached', done: false },
    { id: '4', text: 'Reviewed and approved', done: false },
    { id: '5', text: 'Posted at optimal time', done: false },
  ],
  internal_report: [
    { id: '1', text: 'Executive summary written', done: false },
    { id: '2', text: 'Findings documented', done: false },
    { id: '3', text: 'Recommendations listed', done: false },
    { id: '4', text: 'Shared with stakeholders', done: false },
  ],
  patent:          [
    { id: '1', text: 'Novelty search completed', done: false },
    { id: '2', text: 'Claims drafted', done: false },
    { id: '3', text: 'Patent attorney consulted', done: false },
    { id: '4', text: 'Application filed', done: false },
  ],
  whitepaper:      [
    { id: '1', text: 'Problem and audience defined', done: false },
    { id: '2', text: 'Research and data collected', done: false },
    { id: '3', text: 'Draft written', done: false },
    { id: '4', text: 'Design/layout finalized', done: false },
    { id: '5', text: 'Published / distributed', done: false },
  ],
  demo:            [
    { id: '1', text: 'Demo scope defined', done: false },
    { id: '2', text: 'Demo environment set up', done: false },
    { id: '3', text: 'Script / walkthrough prepared', done: false },
    { id: '4', text: 'Recording or live session done', done: false },
    { id: '5', text: 'Published or shared', done: false },
  ],
}

const MILESTONE_STATUS_STYLE: Record<string, React.CSSProperties> = {
  pending:     { backgroundColor: '#F2F3F3', color: '#687078' },
  in_progress: { backgroundColor: '#FEF8EE', color: '#E8820C' },
  done:        { backgroundColor: '#EBF5E8', color: '#1D8102' },
  blocked:     { backgroundColor: '#FEF0EE', color: '#D13212' },
}

const DOMAINS = ['security','ctf','design','ai','infra','devops','marketing','tooling','other']
const ENTRY_TYPES = ['note','experiment','finding','prototype','milestone','blocker']

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Reference Card (sub-component) ───────────────────────────────────────────

function ReferenceCard({ ref_, onPin, onDelete }: { ref_: RndReference; onPin: (r: RndReference) => void; onDelete: (id: string) => void }) {
  const tl = REF_TYPE_LABEL[ref_.ref_type] ?? ref_.ref_type
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 12px', background: '#fff', border: `1px solid ${ref_.is_pinned ? '#E8820C' : 'var(--border)'}`, borderRadius: 7, marginBottom: 6 }}>
      <span style={{ fontSize: 10, color: 'var(--text3)', background: '#F2F3F3', padding: '2px 6px', borderRadius: 3, flexShrink: 0, marginTop: 1 }}>{tl}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {ref_.url ? (
          <a href={ref_.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.85rem', color: '#0073BB', fontWeight: 500, textDecoration: 'none', wordBreak: 'break-all' }}>{ref_.title}</a>
        ) : (
          <span style={{ fontSize: '0.85rem', color: 'var(--text1)', fontWeight: 500 }}>{ref_.title}</span>
        )}
        {ref_.notes && <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3)', lineHeight: 1.4 }}>{ref_.notes}</p>}
      </div>
      <button onClick={() => onPin(ref_)} title={ref_.is_pinned ? 'Unpin' : 'Pin'}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: ref_.is_pinned ? '#E8820C' : 'var(--text3)', flexShrink: 0, lineHeight: 1, padding: '0 2px' }}>
        📌
      </button>
      <button onClick={() => onDelete(ref_.id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', lineHeight: 1, display: 'inline-flex', flexShrink: 0, padding: '0 2px' }}>
        <X size={13} />
      </button>
    </div>
  )
}

// ── New Initiative Slide-over ─────────────────────────────────────────────────

function NewInitiativeSlideOver({ open, onClose, onCreated, companies }: {
  open: boolean; onClose: () => void; onCreated: () => void; companies: Company[]
}) {
  const [form, setForm] = useState({ title: '', description: '', domain: 'other', company_id: '' })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) { setError('Title is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/rnd/initiatives', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.title.trim(), description: form.description.trim() || null, domain: form.domain, company_id: form.company_id || null }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed'); return }
      onCreated(); onClose()
      setForm({ title: '', description: '', domain: 'other', company_id: '' })
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col" style={{ width: '480px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, color: 'var(--text1)' }}>New R&D Initiative</h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label style={labelStyle}>Title *</label>
              <input style={inputStyle} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="What are you exploring?" />
            </div>
            <div>
              <label style={labelStyle}>Domain</label>
              <select style={inputStyle} value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}>
                {DOMAINS.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Company (optional)</label>
              <select style={inputStyle} value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))}>
                <option value="">- Not company-specific -</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Description</label>
              <textarea
                style={{ ...inputStyle, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
                rows={4} value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Background, goal, or hypothesis…"
              />
            </div>
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>
          <div className="px-6 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="submit" disabled={saving} className="flex-1 text-sm py-2 font-medium"
              style={{ backgroundColor: saving ? '#ccc' : 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
              {saving ? 'Creating…' : 'Create Initiative'}
            </button>
            <button type="button" onClick={onClose} className="text-sm px-4 py-2"
              style={{ border: '1px solid var(--border)', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: 'var(--text2)' }}>Cancel</button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── R&D Tab ───────────────────────────────────────────────────────────────────

function RndTab() {
  const qc = useQueryClient()
  const [selected, setSelected]   = useState<RndInitiative | null>(null)
  const [newOpen, setNewOpen]     = useState(false)
  const [statusFilter, setStatusF] = useState<string>('all')
  const [domainFilter, setDomainF] = useState<string>('all')
  const [companyFilter, setCompanyF] = useState<string>('all')
  const [logBody, setLogBody]     = useState('')
  const [logType, setLogType]     = useState('note')
  const [postingLog, setPostingLog] = useState(false)
  const [editingOutcome, setEditingOutcome] = useState(false)
  const [outcomeText, setOutcomeText] = useState('')
  const [savingOutcome, setSavingOutcome] = useState(false)
  const [rndViewMode, setRndViewMode] = useState<'list' | 'calendar'>('list')
  const rndCal = useCalendarMonth()
  const [detailTab, setDetailTab] = useState<'overview'|'milestones'|'resources'|'references'|'publications'|'log'|'report'>('overview')
  const [addingPhase, setAddingPhase] = useState<RndPhase | null>(null)
  const [newMsTitle, setNewMsTitle] = useState('')
  const [editingField, setEditingField] = useState<'hypothesis'|'problem_statement'|'budget_estimate'|null>(null)
  const [editingFieldValue, setEditingFieldValue] = useState('')
  const [savingField, setSavingField] = useState(false)
  const [newResource, setNewResource] = useState({ resource_type: 'budget', name: '', status: 'needed', estimated_cost: '', notes: '' })
  const [newReference, setNewReference] = useState({ ref_type: 'paper', title: '', url: '', notes: '', is_pinned: false })
  const [refTypeFilter, setRefTypeFilter] = useState('all')
  const [addingPub, setAddingPub] = useState(false)
  const [newPub, setNewPub] = useState({ pub_type: 'ieee_paper', target_venue: '', target_date: '' })
  const [expandedPubId, setExpandedPubId] = useState<string | null>(null)

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies'],
    queryFn: () => fetch('/api/companies', { credentials: 'include' }).then(r => r.json()),
  })

  const { data: initiativesData, isLoading } = useQuery<{ initiatives: RndInitiative[] }>({
    queryKey: ['rnd-initiatives', statusFilter, domainFilter],
    queryFn: () => {
      const p = new URLSearchParams()
      if (statusFilter !== 'all') p.set('status', statusFilter)
      if (domainFilter !== 'all') p.set('domain', domainFilter)
      return fetch(`/api/rnd/initiatives?${p}`, { credentials: 'include' }).then(r => r.json())
    },
  })

  const { data: logData, isLoading: logLoading } = useQuery<{ entries: RndLogEntry[] }>({
    queryKey: ['rnd-log', selected?.id],
    queryFn:  () => fetch(`/api/rnd/initiatives/${selected!.id}/log`, { credentials: 'include' }).then(r => r.json()),
    enabled: !!selected,
  })

  const { data: rndAllTasksData } = useQuery<{ tasks: Task[] }>({
    queryKey: ['tasks', false],
    queryFn: () => fetch('/api/tasks', { credentials: 'include' }).then(r => r.json()),
    enabled: rndViewMode === 'calendar',
  })
  const { data: rndProjectsData } = useQuery<{ projects: Project[] }>({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/projects', { credentials: 'include' }).then(r => r.json()),
    enabled: rndViewMode === 'calendar',
  })
  const rndProjectIds = useMemo(() => {
    const ps = rndProjectsData?.projects ?? []
    return new Set(ps.filter(p => p.category === 'rnd').map(p => p.id))
  }, [rndProjectsData])
  const rndTasks = useMemo(
    () => (rndAllTasksData?.tasks ?? []).filter(t => rndProjectIds.has(t.project_id)),
    [rndAllTasksData, rndProjectIds]
  )

  const { data: milestonesData, isLoading: msLoading } = useQuery<{ milestones: RndMilestone[] }>({
    queryKey: ['rnd-milestones', selected?.id],
    queryFn: () => fetch(`/api/rnd/initiatives/${selected!.id}/milestones`, { credentials: 'include' }).then(r => r.json()),
    enabled: !!selected && detailTab === 'milestones',
  })

  const { data: resourcesData, isLoading: resLoading } = useQuery<{ resources: RndResource[] }>({
    queryKey: ['rnd-resources', selected?.id],
    queryFn: () => fetch(`/api/rnd/initiatives/${selected!.id}/resources`, { credentials: 'include' }).then(r => r.json()),
    enabled: !!selected && detailTab === 'resources',
  })

  const { data: referencesData, isLoading: refLoading } = useQuery<{ references: RndReference[] }>({
    queryKey: ['rnd-references', selected?.id],
    queryFn: () => fetch(`/api/rnd/initiatives/${selected!.id}/references`, { credentials: 'include' }).then(r => r.json()),
    enabled: !!selected && detailTab === 'references',
  })

  const { data: publicationsData, isLoading: pubLoading } = useQuery<{ publications: RndPublication[] }>({
    queryKey: ['rnd-publications', selected?.id],
    queryFn: () => fetch(`/api/rnd/initiatives/${selected!.id}/publications`, { credentials: 'include' }).then(r => r.json()),
    enabled: !!selected && detailTab === 'publications',
  })

  const { data: reportData, isLoading: reportLoading } = useQuery<{ report: string }>({
    queryKey: ['rnd-report', selected?.id],
    queryFn: () => fetch(`/api/rnd/initiatives/${selected!.id}/report`, { credentials: 'include' }).then(r => r.json()),
    enabled: !!selected && detailTab === 'report',
  })

  useEffect(() => { setDetailTab('overview') }, [selected?.id])

  const companies = companiesData?.companies ?? []
  const allInitiatives = initiativesData?.initiatives ?? []
  const initiatives = companyFilter === 'all' ? allInitiatives : allInitiatives.filter(i => i.company_id === companyFilter)
  const entries     = logData?.entries ?? []
  const milestones  = milestonesData?.milestones ?? []
  const resources   = resourcesData?.resources ?? []
  const references  = referencesData?.references ?? []
  const publications = publicationsData?.publications ?? []

  // Keep selected in sync with refreshed list
  const selectedFresh = initiatives.find(i => i.id === selected?.id) ?? selected

  async function updatePhase(phase: RndPhase) {
    if (!selected) return
    await fetch(`/api/rnd/initiatives/${selected.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase }),
    })
    qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })
  }

  async function saveField() {
    if (!selected || !editingField) return
    setSavingField(true)
    try {
      await fetch(`/api/rnd/initiatives/${selected.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [editingField]: editingFieldValue.trim() || null }),
      })
      qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })
      setEditingField(null)
    } finally { setSavingField(false) }
  }

  async function addMilestone(phase: RndPhase) {
    if (!selected || !newMsTitle.trim()) return
    await fetch(`/api/rnd/initiatives/${selected.id}/milestones`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase, title: newMsTitle.trim() }),
    })
    setNewMsTitle(''); setAddingPhase(null)
    qc.invalidateQueries({ queryKey: ['rnd-milestones', selected.id] })
    qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })
  }

  async function toggleMilestone(ms: RndMilestone) {
    const next = ms.status === 'done' ? 'pending' : 'done'
    await fetch(`/api/rnd/milestones/${ms.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    qc.invalidateQueries({ queryKey: ['rnd-milestones', selected?.id] })
    qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })
  }

  async function deleteMilestone(id: string) {
    await fetch(`/api/rnd/milestones/${id}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['rnd-milestones', selected?.id] })
    qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })
  }

  async function addResource() {
    if (!selected || !newResource.name.trim()) return
    await fetch(`/api/rnd/initiatives/${selected.id}/resources`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newResource, estimated_cost: newResource.estimated_cost ? Number(newResource.estimated_cost) : null }),
    })
    setNewResource({ resource_type: 'budget', name: '', status: 'needed', estimated_cost: '', notes: '' })
    qc.invalidateQueries({ queryKey: ['rnd-resources', selected.id] })
    qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })
  }

  async function deleteResource(id: string) {
    await fetch(`/api/rnd/resources/${id}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['rnd-resources', selected?.id] })
    qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })
  }

  async function addReference() {
    if (!selected || !newReference.title.trim()) return
    await fetch(`/api/rnd/initiatives/${selected.id}/references`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newReference),
    })
    setNewReference({ ref_type: 'paper', title: '', url: '', notes: '', is_pinned: false })
    qc.invalidateQueries({ queryKey: ['rnd-references', selected.id] })
  }

  async function togglePin(ref: RndReference) {
    await fetch(`/api/rnd/references/${ref.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_pinned: !ref.is_pinned }),
    })
    qc.invalidateQueries({ queryKey: ['rnd-references', selected?.id] })
  }

  async function deleteReference(id: string) {
    await fetch(`/api/rnd/references/${id}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['rnd-references', selected?.id] })
  }

  async function addPublication() {
    if (!selected || !newPub.pub_type) return
    await fetch(`/api/rnd/initiatives/${selected.id}/publications`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPub),
    })
    setNewPub({ pub_type: 'ieee_paper', target_venue: '', target_date: '' }); setAddingPub(false)
    qc.invalidateQueries({ queryKey: ['rnd-publications', selected.id] })
  }

  async function toggleChecklistItem(pub: RndPublication, itemId: string) {
    const checklist = pub.checklist.map(item =>
      item.id === itemId ? { ...item, done: !item.done } : item
    )
    await fetch(`/api/rnd/publications/${pub.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checklist }),
    })
    qc.invalidateQueries({ queryKey: ['rnd-publications', selected?.id] })
  }

  async function updatePubStatus(pub: RndPublication, status: string) {
    await fetch(`/api/rnd/publications/${pub.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    qc.invalidateQueries({ queryKey: ['rnd-publications', selected?.id] })
  }

  async function deletePublication(id: string) {
    await fetch(`/api/rnd/publications/${id}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['rnd-publications', selected?.id] })
  }

  async function addLog() {
    if (!logBody.trim() || !selected) return
    setPostingLog(true)
    try {
      await fetch(`/api/rnd/initiatives/${selected.id}/log`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_body: logBody.trim(), entry_type: logType }),
      })
      setLogBody('')
      qc.invalidateQueries({ queryKey: ['rnd-log', selected.id] })
      qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })
    } finally { setPostingLog(false) }
  }

  async function deleteLog(entryId: string) {
    await fetch(`/api/rnd/log/${entryId}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['rnd-log', selected?.id] })
  }

  async function updateStatus(status: string) {
    if (!selected) return
    await fetch(`/api/rnd/initiatives/${selected.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })
  }

  async function saveOutcome() {
    if (!selected) return
    setSavingOutcome(true)
    try {
      await fetch(`/api/rnd/initiatives/${selected.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: outcomeText.trim() || null }),
      })
      qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })
      setEditingOutcome(false)
    } finally { setSavingOutcome(false) }
  }

  async function deleteInitiative(id: string) {
    if (!confirm('Delete this initiative and all its log entries? Cannot be undone.')) return
    await fetch(`/api/rnd/initiatives/${id}`, { method: 'DELETE', credentials: 'include' })
    if (selected?.id === id) setSelected(null)
    qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', flexDirection: 'column' }}>

      {rndViewMode === 'calendar' && (
        <div style={{ flex: 1, overflow: 'auto', padding: 24, backgroundColor: 'var(--bg)' }}>
          <CalendarGrid
            items={[
              ...rndToCalendarItems(initiatives),
              ...tasksToCalendarItems(rndTasks, () => {}),
            ]}
            monthLabel={rndCal.monthLabel}
            onPrev={rndCal.prev}
            onNext={rndCal.next}
            onToday={rndCal.today}
            year={rndCal.year}
            month={rndCal.month}
          />
        </div>
      )}

      {rndViewMode === 'list' && <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

      {/* LEFT - initiative list */}
      <div style={{ width: 320, minWidth: 320, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <select
              value={statusFilter}
              onChange={e => setStatusF(e.target.value)}
              style={{ ...inputStyle, flex: 1, fontSize: '0.8rem' }}
            >
              <option value="all">All statuses</option>
              {['exploring','active','paused','concluded'].map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <select
              value={domainFilter}
              onChange={e => setDomainF(e.target.value)}
              style={{ ...inputStyle, flex: 1, fontSize: '0.8rem' }}
            >
              <option value="all">All domains</option>
              {DOMAINS.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
            </select>
          </div>
          {companies.length > 1 && (
            <select
              value={companyFilter}
              onChange={e => setCompanyF(e.target.value)}
              style={{ ...inputStyle, width: '100%', fontSize: '0.8rem', marginBottom: 8 }}
            >
              <option value="all">All Companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <div style={{ display: 'flex', flex: 1, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {(['list', 'calendar'] as const).map(v => (
                <button key={v} onClick={() => setRndViewMode(v)}
                  style={{ flex: 1, fontSize: '0.8rem', padding: '5px 0', fontWeight: 500, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif', backgroundColor: rndViewMode === v ? 'var(--blue)' : '#fff', color: rndViewMode === v ? '#fff' : 'var(--text2)', textTransform: 'capitalize' }}>
                  {v}
                </button>
              ))}
            </div>
            <button
              onClick={() => setNewOpen(true)}
              style={{ flex: 1, backgroundColor: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6, height: 34, fontSize: '0.875rem', cursor: 'pointer', fontWeight: 500 }}
            >
              + Initiative
            </button>
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {isLoading ? (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 72, borderRadius: 6, backgroundColor: '#E0E3E3', animation: 'pulse 1.5s infinite' }} />)}
            </div>
          ) : initiatives.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: '0.875rem' }}>
              No initiatives yet.<br />Start one with the button above.
            </div>
          ) : initiatives.map(i => {
            const ds = DOMAIN_STYLE[i.domain] ?? DOMAIN_STYLE.other
            const ss = RND_STATUS_STYLE[i.status] ?? RND_STATUS_STYLE.exploring
            const isSel = selected?.id === i.id
            return (
              <div
                key={i.id}
                onClick={() => { setSelected(i); setEditingOutcome(false); setLogBody(''); setLogType('note') }}
                style={{
                  padding: '12px 14px', cursor: 'pointer',
                  borderBottom: '1px solid #F2F3F3',
                  background: isSel ? '#EBF4FB' : 'transparent',
                  borderLeft: isSel ? '3px solid #0073BB' : '3px solid transparent',
                }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#F8F9FA' }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text1)', lineHeight: 1.3 }}>{i.title}</span>
                  <span style={{ ...ss, fontSize: 11, padding: '1px 7px', borderRadius: 3, fontWeight: 600, flexShrink: 0 }}>
                    {i.status}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ ...ds, fontSize: 11, padding: '1px 7px', borderRadius: 3, fontWeight: 500 }}>
                    {i.domain}
                  </span>
                  {i.company_name && (
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>{i.company_name}</span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>
                    {i.log_count} entries · {timeAgo(i.updated_at)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* RIGHT - 7-tab detail panel */}
      <div style={{ flex: 1, overflow: 'hidden', background: '#F8F9FA', display: 'flex', flexDirection: 'column' }}>
        {!selectedFresh ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text3)' }}>
            <div style={{ marginBottom: 12, opacity: 0.3 }}><FlaskConical size={48} /></div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)' }}>Select an initiative</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>Click one on the left to view details</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

            {/* ── Header ── */}
            <div style={{ padding: '14px 20px 0', background: '#fff', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ minWidth: 0, flex: 1, marginRight: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--font-syne)', fontSize: 16, fontWeight: 700, color: 'var(--text1)' }}>
                      {selectedFresh.title}
                    </span>
                    <span style={{ ...(DOMAIN_STYLE[selectedFresh.domain] ?? DOMAIN_STYLE.other), fontSize: 11, padding: '2px 9px', borderRadius: 4, fontWeight: 600 }}>
                      {selectedFresh.domain}
                    </span>
                    {selectedFresh.company_name && (
                      <span style={{ fontSize: 11, color: 'var(--text2)', background: '#F2F3F3', padding: '2px 8px', borderRadius: 4 }}>
                        {selectedFresh.company_name}
                      </span>
                    )}
                    {selectedFresh.milestones_total > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                        {selectedFresh.milestones_done}/{selectedFresh.milestones_total} milestones
                      </span>
                    )}
                    {selectedFresh.resources_pending > 0 && (
                      <span style={{ fontSize: 11, color: '#E8820C', fontWeight: 600 }}>
                        {selectedFresh.resources_pending} resource{selectedFresh.resources_pending > 1 ? 's' : ''} pending
                      </span>
                    )}
                  </div>
                  {selectedFresh.description && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text2)', lineHeight: 1.5, margin: 0 }}>{selectedFresh.description}</p>
                  )}
                </div>
                <button
                  onClick={() => deleteInitiative(selectedFresh.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}
                  title="Delete initiative"
                ><X size={16} /></button>
              </div>

              {/* Status row */}
              <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
                {(['exploring','active','paused','concluded'] as const).map(s => {
                  const ss = RND_STATUS_STYLE[s]; const active = selectedFresh.status === s
                  return (
                    <button key={s} onClick={() => updateStatus(s)}
                      style={{ fontSize: 11, padding: '2px 9px', borderRadius: 4, cursor: 'pointer', fontWeight: active ? 700 : 500, border: '1px solid currentColor', ...ss, opacity: active ? 1 : 0.5 }}>
                      {active ? '● ' : ''}{s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  )
                })}
              </div>

              {/* Phase rail */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 0, overflow: 'hidden', borderRadius: 6, border: '1px solid var(--border)' }}>
                {RND_PHASES.map((ph, idx) => {
                  const isCurrent = selectedFresh.phase === ph.key
                  const isDone    = RND_PHASES.findIndex(p => p.key === selectedFresh.phase) > idx
                  return (
                    <button key={ph.key} onClick={() => updatePhase(ph.key)}
                      title={ph.label}
                      style={{
                        flex: 1, border: 'none', borderRight: idx < RND_PHASES.length - 1 ? '1px solid var(--border)' : 'none',
                        padding: '5px 0', fontSize: 10, fontWeight: isCurrent ? 700 : 500, cursor: 'pointer',
                        backgroundColor: isCurrent ? ph.color : isDone ? '#E8F5E9' : '#fff',
                        color: isCurrent ? '#fff' : isDone ? '#1D8102' : 'var(--text3)',
                        fontFamily: 'var(--font-inter), sans-serif',
                      }}>
                      {ph.label}
                    </button>
                  )
                })}
              </div>

              {/* Tab bar */}
              <div style={{ display: 'flex', marginTop: 10, gap: 0 }}>
                {(['overview','milestones','resources','references','publications','log','report'] as const).map(tab => (
                  <button key={tab} onClick={() => setDetailTab(tab)}
                    style={{
                      fontSize: 12, padding: '6px 12px', border: 'none', borderBottom: detailTab === tab ? '2px solid #0073BB' : '2px solid transparent',
                      background: 'none', cursor: 'pointer', fontWeight: detailTab === tab ? 700 : 500,
                      color: detailTab === tab ? '#0073BB' : 'var(--text2)', fontFamily: 'var(--font-inter), sans-serif', textTransform: 'capitalize',
                    }}>
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Tab content ── */}
            <div style={{ flex: 1, overflowY: 'auto' }}>

              {/* OVERVIEW */}
              {detailTab === 'overview' && (
                <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

                  {/* Problem statement */}
                  <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Problem Statement</span>
                      <button onClick={() => { setEditingField('problem_statement'); setEditingFieldValue(selectedFresh.problem_statement ?? '') }}
                        style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                    </div>
                    {editingField === 'problem_statement' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <textarea value={editingFieldValue} onChange={e => setEditingFieldValue(e.target.value)} rows={4}
                          placeholder="What problem are we solving? Why does it matter?"
                          style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical', fontSize: '0.825rem' }} autoFocus />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={saveField} disabled={savingField} style={{ height: 28, padding: '0 12px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer' }}>{savingField ? '…' : 'Save'}</button>
                          <button onClick={() => setEditingField(null)} style={{ height: 28, padding: '0 12px', background: '#fff', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      </div>
                    ) : selectedFresh.problem_statement ? (
                      <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text1)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedFresh.problem_statement}</p>
                    ) : (
                      <button onClick={() => { setEditingField('problem_statement'); setEditingFieldValue('') }}
                        style={{ fontSize: '0.8rem', color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Define the problem statement</button>
                    )}
                  </div>

                  {/* Hypothesis */}
                  <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hypothesis</span>
                      <button onClick={() => { setEditingField('hypothesis'); setEditingFieldValue(selectedFresh.hypothesis ?? '') }}
                        style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                    </div>
                    {editingField === 'hypothesis' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <textarea value={editingFieldValue} onChange={e => setEditingFieldValue(e.target.value)} rows={3}
                          placeholder="We believe that… [testable prediction]"
                          style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical', fontSize: '0.825rem' }} autoFocus />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={saveField} disabled={savingField} style={{ height: 28, padding: '0 12px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer' }}>{savingField ? '…' : 'Save'}</button>
                          <button onClick={() => setEditingField(null)} style={{ height: 28, padding: '0 12px', background: '#fff', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      </div>
                    ) : selectedFresh.hypothesis ? (
                      <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text1)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedFresh.hypothesis}</p>
                    ) : (
                      <button onClick={() => { setEditingField('hypothesis'); setEditingFieldValue('') }}
                        style={{ fontSize: '0.8rem', color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add hypothesis</button>
                    )}
                  </div>

                  {/* Budget estimate */}
                  <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Budget Estimate</span>
                      <button onClick={() => { setEditingField('budget_estimate'); setEditingFieldValue(selectedFresh.budget_estimate ? String(selectedFresh.budget_estimate) : '') }}
                        style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                    </div>
                    {editingField === 'budget_estimate' ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: 'var(--text2)' }}>₹</span>
                        <input type="number" value={editingFieldValue} onChange={e => setEditingFieldValue(e.target.value)}
                          placeholder="e.g. 50000"
                          style={{ ...inputStyle, flex: 1, fontSize: '0.875rem' }} autoFocus />
                        <button onClick={saveField} disabled={savingField} style={{ height: 34, padding: '0 12px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer' }}>{savingField ? '…' : 'Save'}</button>
                        <button onClick={() => setEditingField(null)} style={{ height: 34, padding: '0 12px', background: '#fff', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    ) : selectedFresh.budget_estimate ? (
                      <span style={{ fontSize: 20, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text1)' }}>
                        ₹{Number(selectedFresh.budget_estimate).toLocaleString('en-IN')}
                      </span>
                    ) : (
                      <button onClick={() => { setEditingField('budget_estimate'); setEditingFieldValue('') }}
                        style={{ fontSize: '0.8rem', color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Set budget estimate</button>
                    )}
                  </div>

                  {/* Outcome */}
                  <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#1D8102', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Outcome / Conclusion</span>
                      <button onClick={() => { setOutcomeText(selectedFresh.outcome ?? ''); setEditingOutcome(true) }}
                        style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                    </div>
                    {editingOutcome ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <textarea value={outcomeText} onChange={e => setOutcomeText(e.target.value)} rows={3}
                          placeholder="What did we learn or build? Summary of results…"
                          style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical', fontSize: '0.825rem' }} autoFocus />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={saveOutcome} disabled={savingOutcome} style={{ height: 28, padding: '0 12px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer' }}>{savingOutcome ? '…' : 'Save'}</button>
                          <button onClick={() => setEditingOutcome(false)} style={{ height: 28, padding: '0 12px', background: '#fff', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      </div>
                    ) : selectedFresh.outcome ? (
                      <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text1)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedFresh.outcome}</p>
                    ) : (
                      <button onClick={() => { setOutcomeText(''); setEditingOutcome(true) }}
                        style={{ fontSize: '0.8rem', color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Record outcome / conclusion</button>
                    )}
                  </div>

                  {/* Milestone progress summary */}
                  {selectedFresh.milestones_total > 0 && (
                    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>Milestone Progress</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, height: 8, background: '#E5E7EB', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.round((selectedFresh.milestones_done / selectedFresh.milestones_total) * 100)}%`, height: '100%', background: '#1D8102', borderRadius: 4, transition: 'width 0.3s' }} />
                        </div>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text1)', fontWeight: 600, flexShrink: 0 }}>
                          {selectedFresh.milestones_done}/{selectedFresh.milestones_total}
                        </span>
                      </div>
                      <button onClick={() => setDetailTab('milestones')}
                        style={{ marginTop: 8, fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        View all milestones →
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* MILESTONES */}
              {detailTab === 'milestones' && (
                <div style={{ padding: '16px 20px' }}>
                  {msLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[1,2,3].map(i => <div key={i} style={{ height: 48, borderRadius: 6, background: '#E0E3E3', animation: 'pulse 1.5s infinite' }} />)}
                    </div>
                  ) : (
                    RND_PHASES.map(ph => {
                      const phaseMilestones = milestones.filter(m => m.phase === ph.key)
                      const doneCount = phaseMilestones.filter(m => m.status === 'done').length
                      return (
                        <div key={ph.key} style={{ marginBottom: 18 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: ph.color }} />
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text1)' }}>{ph.label}</span>
                              {phaseMilestones.length > 0 && (
                                <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{doneCount}/{phaseMilestones.length}</span>
                              )}
                            </div>
                            <button onClick={() => { setAddingPhase(ph.key); setNewMsTitle('') }}
                              style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add</button>
                          </div>

                          {addingPhase === ph.key && (
                            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                              <input
                                value={newMsTitle}
                                onChange={e => setNewMsTitle(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') addMilestone(ph.key); if (e.key === 'Escape') setAddingPhase(null) }}
                                placeholder="Milestone title…"
                                style={{ ...inputStyle, flex: 1, fontSize: '0.8rem' }}
                                autoFocus
                              />
                              <button onClick={() => addMilestone(ph.key)} style={{ height: 34, padding: '0 12px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer' }}>Add</button>
                              <button onClick={() => setAddingPhase(null)} style={{ height: 34, padding: '0 10px', background: '#fff', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer' }}>✕</button>
                            </div>
                          )}

                          {phaseMilestones.length === 0 && addingPhase !== ph.key ? (
                            <div style={{ fontSize: 12, color: 'var(--text3)', padding: '6px 0', fontStyle: 'italic' }}>No milestones yet</div>
                          ) : phaseMilestones.map(ms => {
                            const mss = MILESTONE_STATUS_STYLE[ms.status] ?? MILESTONE_STATUS_STYLE.pending
                            return (
                              <div key={ms.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: ms.status === 'done' ? '#F0FDF4' : '#fff', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 4 }}>
                                <input type="checkbox" checked={ms.status === 'done'} onChange={() => toggleMilestone(ms)}
                                  style={{ cursor: 'pointer', width: 15, height: 15, flexShrink: 0 }} />
                                <span style={{ flex: 1, fontSize: '0.85rem', color: ms.status === 'done' ? 'var(--text3)' : 'var(--text1)', textDecoration: ms.status === 'done' ? 'line-through' : 'none' }}>
                                  {ms.title}
                                </span>
                                {ms.due_date && (
                                  <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                                    {new Date(ms.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                  </span>
                                )}
                                <span style={{ ...mss, fontSize: 10, padding: '1px 6px', borderRadius: 3, fontWeight: 600, flexShrink: 0 }}>{ms.status}</span>
                                <button onClick={() => deleteMilestone(ms.id)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', lineHeight: 1, display: 'inline-flex', padding: '0 2px' }}>
                                  <X size={13} />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })
                  )}
                </div>
              )}

              {/* RESOURCES */}
              {detailTab === 'resources' && (
                <div style={{ padding: '16px 20px' }}>
                  {/* Add resource form */}
                  <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>Add Resource</span>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <select value={newResource.resource_type} onChange={e => setNewResource(p => ({ ...p, resource_type: e.target.value }))}
                        style={{ ...inputStyle, width: 110, fontSize: '0.8rem' }}>
                        {Object.entries(RESOURCE_TYPE_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input value={newResource.name} onChange={e => setNewResource(p => ({ ...p, name: e.target.value }))}
                        placeholder="Resource name…" style={{ ...inputStyle, flex: 1, fontSize: '0.8rem' }} />
                      <input value={newResource.estimated_cost} onChange={e => setNewResource(p => ({ ...p, estimated_cost: e.target.value }))}
                        type="number" placeholder="₹ cost" style={{ ...inputStyle, width: 90, fontSize: '0.8rem' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select value={newResource.status} onChange={e => setNewResource(p => ({ ...p, status: e.target.value }))}
                        style={{ ...inputStyle, width: 120, fontSize: '0.8rem' }}>
                        {Object.entries(RESOURCE_STATUS_STYLE).map(([k]) => <option key={k} value={k}>{k}</option>)}
                      </select>
                      <input value={newResource.notes} onChange={e => setNewResource(p => ({ ...p, notes: e.target.value }))}
                        placeholder="Notes (optional)" style={{ ...inputStyle, flex: 1, fontSize: '0.8rem' }} />
                      <button onClick={addResource} disabled={!newResource.name.trim()}
                        style={{ height: 34, padding: '0 14px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer', flexShrink: 0 }}>
                        Add
                      </button>
                    </div>
                  </div>

                  {resLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[1,2].map(i => <div key={i} style={{ height: 52, borderRadius: 6, background: '#E0E3E3', animation: 'pulse 1.5s infinite' }} />)}
                    </div>
                  ) : resources.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text3)', fontSize: '0.875rem' }}>No resources defined yet</div>
                  ) : (
                    <>
                      {/* Total cost */}
                      {resources.some(r => r.estimated_cost) && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                          <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>
                            Total: ₹{resources.reduce((s, r) => s + (r.estimated_cost ? Number(r.estimated_cost) : 0), 0).toLocaleString('en-IN')}
                          </span>
                        </div>
                      )}
                      {resources.map(res => {
                        const rs = RESOURCE_STATUS_STYLE[res.status] ?? RESOURCE_STATUS_STYLE.needed
                        return (
                          <div key={res.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: '#fff', border: '1px solid var(--border)', borderRadius: 7, marginBottom: 6 }}>
                            <span style={{ fontSize: 11, color: 'var(--text3)', background: '#F2F3F3', padding: '2px 7px', borderRadius: 4, flexShrink: 0 }}>{RESOURCE_TYPE_LABEL[res.resource_type] ?? res.resource_type}</span>
                            <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text1)', fontWeight: 500 }}>{res.name}</span>
                            {res.estimated_cost && (
                              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text2)', flexShrink: 0 }}>₹{Number(res.estimated_cost).toLocaleString('en-IN')}</span>
                            )}
                            <select value={res.status}
                              onChange={async e => {
                                await fetch(`/api/rnd/resources/${res.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: e.target.value }) })
                                qc.invalidateQueries({ queryKey: ['rnd-resources', selected?.id] })
                                qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })
                              }}
                              style={{ ...inputStyle, width: 110, fontSize: '0.75rem', height: 28, padding: '0 6px', ...rs }}>
                              {Object.keys(RESOURCE_STATUS_STYLE).map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <button onClick={() => deleteResource(res.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', lineHeight: 1, display: 'inline-flex', padding: '0 2px' }}>
                              <X size={13} />
                            </button>
                          </div>
                        )
                      })}
                    </>
                  )}
                </div>
              )}

              {/* REFERENCES */}
              {detailTab === 'references' && (
                <div style={{ padding: '16px 20px' }}>
                  {/* Add reference form */}
                  <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>Add Reference / Pin</span>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <select value={newReference.ref_type} onChange={e => setNewReference(p => ({ ...p, ref_type: e.target.value }))}
                        style={{ ...inputStyle, width: 120, fontSize: '0.8rem' }}>
                        {Object.entries(REF_TYPE_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input value={newReference.title} onChange={e => setNewReference(p => ({ ...p, title: e.target.value }))}
                        placeholder="Title" style={{ ...inputStyle, flex: 1, fontSize: '0.8rem' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input value={newReference.url} onChange={e => setNewReference(p => ({ ...p, url: e.target.value }))}
                        placeholder="URL (optional)" style={{ ...inputStyle, flex: 1, fontSize: '0.8rem' }} />
                      <input value={newReference.notes} onChange={e => setNewReference(p => ({ ...p, notes: e.target.value }))}
                        placeholder="Notes" style={{ ...inputStyle, flex: 1, fontSize: '0.8rem' }} />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', cursor: 'pointer', flexShrink: 0 }}>
                        <input type="checkbox" checked={newReference.is_pinned} onChange={e => setNewReference(p => ({ ...p, is_pinned: e.target.checked }))} />
                        Pin
                      </label>
                      <button onClick={addReference} disabled={!newReference.title.trim()}
                        style={{ height: 34, padding: '0 14px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer', flexShrink: 0 }}>
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Type filter */}
                  <div style={{ display: 'flex', gap: 5, marginBottom: 12, flexWrap: 'wrap' }}>
                    {['all', ...Object.keys(REF_TYPE_LABEL)].map(t => (
                      <button key={t} onClick={() => setRefTypeFilter(t)}
                        style={{ fontSize: 11, padding: '3px 9px', borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer', background: refTypeFilter === t ? '#0073BB' : '#fff', color: refTypeFilter === t ? '#fff' : 'var(--text2)', fontFamily: 'var(--font-inter), sans-serif' }}>
                        {t === 'all' ? 'All' : REF_TYPE_LABEL[t]}
                      </button>
                    ))}
                  </div>

                  {refLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[1,2].map(i => <div key={i} style={{ height: 52, borderRadius: 6, background: '#E0E3E3', animation: 'pulse 1.5s infinite' }} />)}
                    </div>
                  ) : (() => {
                    const filtered = refTypeFilter === 'all' ? references : references.filter(r => r.ref_type === refTypeFilter)
                    const pinned  = filtered.filter(r => r.is_pinned)
                    const unpinned = filtered.filter(r => !r.is_pinned)
                    if (filtered.length === 0) return <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text3)', fontSize: '0.875rem' }}>No references yet</div>
                    return (
                      <>
                        {pinned.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#E8820C', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>📌 Pinned</div>
                            {pinned.map(ref => <ReferenceCard key={ref.id} ref_={ref} onPin={togglePin} onDelete={deleteReference} />)}
                          </div>
                        )}
                        {unpinned.map(ref => <ReferenceCard key={ref.id} ref_={ref} onPin={togglePin} onDelete={deleteReference} />)}
                      </>
                    )
                  })()}
                </div>
              )}

              {/* PUBLICATIONS */}
              {detailTab === 'publications' && (
                <div style={{ padding: '16px 20px' }}>
                  {!addingPub ? (
                    <button onClick={() => setAddingPub(true)}
                      style={{ width: '100%', height: 38, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.875rem', cursor: 'pointer', marginBottom: 14, fontWeight: 500 }}>
                      + Add Publication Target
                    </button>
                  ) : (
                    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>New Publication Target</span>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <select value={newPub.pub_type} onChange={e => setNewPub(p => ({ ...p, pub_type: e.target.value }))}
                          style={{ ...inputStyle, flex: 1, fontSize: '0.8rem' }}>
                          {Object.entries(PUB_TYPE_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <input value={newPub.target_venue} onChange={e => setNewPub(p => ({ ...p, target_venue: e.target.value }))}
                          placeholder="Target venue / journal / platform" style={{ ...inputStyle, flex: 2, fontSize: '0.8rem' }} />
                        <input type="date" value={newPub.target_date} onChange={e => setNewPub(p => ({ ...p, target_date: e.target.value }))}
                          style={{ ...inputStyle, width: 140, fontSize: '0.8rem' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={addPublication} style={{ height: 32, padding: '0 14px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer' }}>Create</button>
                        <button onClick={() => setAddingPub(false)} style={{ height: 32, padding: '0 12px', background: '#fff', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {pubLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[1,2].map(i => <div key={i} style={{ height: 80, borderRadius: 8, background: '#E0E3E3', animation: 'pulse 1.5s infinite' }} />)}
                    </div>
                  ) : publications.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text3)', fontSize: '0.875rem' }}>No publication targets yet. Add one to get a pre-filled checklist.</div>
                  ) : publications.map(pub => {
                    const isExpanded = expandedPubId === pub.id
                    const checklist = Array.isArray(pub.checklist) ? pub.checklist : []
                    const doneCount = checklist.filter(i => i.done).length
                    const pct = checklist.length > 0 ? Math.round((doneCount / checklist.length) * 100) : 0
                    const ps = PUB_STATUS_STYLE[pub.status] ?? PUB_STATUS_STYLE.not_started
                    return (
                      <div key={pub.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
                        <div style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)' }}>{PUB_TYPE_LABEL[pub.pub_type] ?? pub.pub_type}</span>
                                <select value={pub.status} onChange={e => updatePubStatus(pub, e.target.value)}
                                  style={{ ...inputStyle, fontSize: '0.75rem', height: 24, padding: '0 5px', ...ps }}>
                                  {Object.keys(PUB_STATUS_STYLE).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                                </select>
                              </div>
                              {pub.target_venue && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{pub.target_venue}</div>}
                              {pub.target_date && <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>Due: {new Date(pub.target_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>}
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <button onClick={() => setExpandedPubId(isExpanded ? null : pub.id)}
                                style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}>
                                {isExpanded ? 'Hide' : 'Checklist'}
                              </button>
                              <button onClick={() => deletePublication(pub.id)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', lineHeight: 1, display: 'inline-flex' }}>
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                          {/* Progress bar */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#1D8102' : '#0073BB', borderRadius: 3, transition: 'width 0.3s' }} />
                            </div>
                            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text3)', flexShrink: 0 }}>{doneCount}/{checklist.length}</span>
                          </div>
                        </div>
                        {/* Checklist */}
                        {isExpanded && (
                          <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', background: '#FAFBFB', maxHeight: 320, overflowY: 'auto' }}>
                            {checklist.map((item) => (
                              <label key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 7, cursor: 'pointer' }}>
                                <input type="checkbox" checked={item.done} onChange={() => toggleChecklistItem(pub, item.id)}
                                  style={{ marginTop: 2, cursor: 'pointer', flexShrink: 0 }} />
                                <span style={{ fontSize: '0.825rem', color: item.done ? 'var(--text3)' : 'var(--text1)', textDecoration: item.done ? 'line-through' : 'none', lineHeight: 1.5 }}>
                                  {item.text}
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* LOG */}
              {detailTab === 'log' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
                    {logLoading ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {[1,2].map(i => <div key={i} style={{ height: 60, borderRadius: 6, background: '#E0E3E3', animation: 'pulse 1.5s infinite' }} />)}
                      </div>
                    ) : entries.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text3)', fontSize: '0.875rem' }}>No log entries yet. Add the first one below.</div>
                    ) : entries.map(entry => {
                      const ts = ENTRY_TYPE_STYLE[entry.entry_type] ?? ENTRY_TYPE_STYLE.note
                      return (
                        <div key={entry.id} style={{ marginBottom: 10, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <span style={{ ...ts, fontSize: 11, padding: '1px 8px', borderRadius: 3, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <ts.Icon size={12} /> {entry.entry_type}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{timeAgo(entry.created_at)}</span>
                            {entry.created_by_name && <span style={{ fontSize: 11, color: 'var(--text3)' }}>· {entry.created_by_name}</span>}
                            <button onClick={() => deleteLog(entry.id)}
                              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}>
                              <X size={14} />
                            </button>
                          </div>
                          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text1)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{entry.body}</p>
                        </div>
                      )
                    })}
                  </div>
                  {/* Add log entry */}
                  <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px', background: '#fff', flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      {ENTRY_TYPES.map(t => {
                        const ts = ENTRY_TYPE_STYLE[t]
                        return (
                          <button key={t} onClick={() => setLogType(t)}
                            style={{ fontSize: 11, padding: '3px 9px', borderRadius: 4, border: '1px solid currentColor', cursor: 'pointer', fontWeight: logType === t ? 700 : 500, ...ts, opacity: logType === t ? 1 : 0.45, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <ts.Icon size={12} /> {t}
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <textarea value={logBody} onChange={e => setLogBody(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && logBody.trim()) { e.preventDefault(); addLog() } }}
                        placeholder="Add a log entry… (Enter to post, Shift+Enter for new line)"
                        style={{ ...inputStyle, flex: 1, height: 'auto', minHeight: 60, padding: '8px 12px', resize: 'none', fontSize: '0.875rem' }} />
                      <button onClick={addLog} disabled={!logBody.trim() || postingLog}
                        style={{ height: 60, padding: '0 16px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.875rem', flexShrink: 0 }}>
                        {postingLog ? '…' : 'Post'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* REPORT */}
              {detailTab === 'report' && (
                <div style={{ padding: '16px 20px' }}>
                  {reportLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[1,2,3,4,5].map(i => <div key={i} style={{ height: 40, borderRadius: 6, background: '#E0E3E3', animation: 'pulse 1.5s infinite' }} />)}
                    </div>
                  ) : reportData?.report ? (
                    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Auto-Generated Report</span>
                        <button
                          onClick={() => {
                            const blob = new Blob([reportData.report], { type: 'text/markdown' })
                            const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
                            a.download = `rnd-report-${selectedFresh?.title?.replace(/\s+/g, '-').toLowerCase() ?? 'initiative'}.md`
                            a.click()
                          }}
                          style={{ fontSize: 12, color: 'var(--blue)', background: 'none', border: '1px solid var(--blue)', borderRadius: 5, padding: '4px 12px', cursor: 'pointer' }}>
                          Download .md
                        </button>
                      </div>
                      <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text1)', whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: 0 }}>
                        {reportData.report}
                      </pre>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text3)', fontSize: '0.875rem' }}>Could not load report</div>
                  )}
                </div>
              )}

            </div>
          </div>
        )}
      </div>

      <NewInitiativeSlideOver
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ['rnd-initiatives'] })}
        companies={companiesData?.companies ?? []}
      />
      </div>}

    </div>
  )
}

// ── Goal Slide-over ───────────────────────────────────────────────────────────

function GoalSlideOver({
  mode, goal, year, quarter, users, onClose, onSaved,
}: {
  mode: 'create' | 'edit'
  goal?: Goal
  year: number
  quarter: number
  users: User[]
  onClose: () => void
  onSaved: () => void
}) {
  const [objective, setObjective] = useState(goal?.objective || '')
  const [ownerId, setOwnerId] = useState(goal?.owner_id || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!objective.trim()) { setError('Objective is required'); return }
    setSaving(true); setError('')
    try {
      const url  = mode === 'edit' ? `/api/goals/${goal!.id}` : '/api/goals'
      const meth = mode === 'edit' ? 'PATCH' : 'POST'
      const body = mode === 'edit'
        ? { objective: objective.trim(), owner_id: ownerId || null }
        : { year, quarter, objective: objective.trim(), owner_id: ownerId || null }
      const res = await fetch(url, { method: meth, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed'); return }
      onSaved()
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col" style={{ width: '480px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>
            {mode === 'create' ? `New Q${quarter} ${year} Goal` : 'Edit Goal'}
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label style={labelStyle}>Objective *</label>
              <textarea
                value={objective}
                onChange={e => setObjective(e.target.value)}
                rows={3}
                placeholder="What do we want to achieve this quarter?"
                style={{ ...inputStyle, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
              />
            </div>
            <div>
              <label style={labelStyle}>Owner</label>
              <select value={ownerId} onChange={e => setOwnerId(e.target.value)} style={inputStyle}>
                <option value="">- No owner -</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>
          <div className="px-6 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="submit" disabled={saving} className="flex-1 text-sm py-2 font-medium"
              style={{ backgroundColor: saving ? '#ccc' : 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : mode === 'create' ? 'Create Goal' : 'Save'}
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

// ── Add KR Slide-over ─────────────────────────────────────────────────────────

function AddKrSlideOver({ goalId, onClose, onSaved }: { goalId: string; onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState('')
  const [targetValue, setTargetValue] = useState('')
  const [unit, setUnit] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) { setError('Description is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/goals/${goalId}/key-results`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim(), target_value: targetValue ? Number(targetValue) : null, unit: unit.trim() || null }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed'); return }
      onSaved()
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col" style={{ width: '440px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>Add Key Result</h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label style={labelStyle}>Description *</label>
              <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Pipeline value ≥ ₹15L" style={inputStyle} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Target Value</label>
                <input type="number" value={targetValue} onChange={e => setTargetValue(e.target.value)} placeholder="1500000" style={{ ...inputStyle, fontFamily: 'var(--font-ibm-plex-mono), monospace' }} />
              </div>
              <div>
                <label style={labelStyle}>Unit</label>
                <input type="text" value={unit} onChange={e => setUnit(e.target.value)} placeholder="INR, %, contracts…" style={inputStyle} />
              </div>
            </div>
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>
          <div className="px-6 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="submit" disabled={saving} className="flex-1 text-sm py-2 font-medium"
              style={{ backgroundColor: saving ? '#ccc' : 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Adding…' : 'Add Key Result'}
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

// ── Link Project Slide-over ───────────────────────────────────────────────────

function LinkProjectSlideOver({ goalId, allProjects, onClose, onSaved }: { goalId: string; allProjects: Project[]; onClose: () => void; onSaved: () => void }) {
  const [projectId, setProjectId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId) { setError('Select a project'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/goals/${goalId}/projects`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed'); return }
      onSaved()
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col" style={{ width: '400px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>Link Project to Goal</h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label style={labelStyle}>Project</label>
              <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inputStyle}>
                <option value="">- Select project -</option>
                {allProjects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.company_name ? ` (${p.company_name})` : ''}</option>
                ))}
              </select>
            </div>
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>
          <div className="px-6 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="submit" disabled={saving} className="flex-1 text-sm py-2 font-medium"
              style={{ backgroundColor: saving ? '#ccc' : 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Linking…' : 'Link Project'}
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

// ── Goals Tab ─────────────────────────────────────────────────────────────────

function GoalsTab() {
  const qc = useQueryClient()
  const currentYear = new Date().getFullYear()
  const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3)

  const [year, setYear] = useState(currentYear)
  const [quarter, setQuarter] = useState(currentQuarter)
  const [newGoalOpen, setNewGoalOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [addKrGoalId, setAddKrGoalId] = useState<string | null>(null)
  const [linkProjectGoalId, setLinkProjectGoalId] = useState<string | null>(null)

  const { data: goalsData, isLoading } = useQuery<{ goals: Goal[] }>({
    queryKey: ['goals', year, quarter],
    queryFn: async () => {
      const res = await fetch(`/api/goals?year=${year}&quarter=${quarter}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
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

  const goals = goalsData?.goals || []
  const allProjects = projectsData?.projects || []
  const users = usersData?.users || []

  async function deleteGoal(goalId: string) {
    await fetch(`/api/goals/${goalId}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['goals'] })
  }

  async function deleteKr(goalId: string, krId: string) {
    await fetch(`/api/goals/${goalId}/key-results/${krId}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['goals'] })
  }

  async function unlinkProject(goalId: string, projectId: string) {
    await fetch(`/api/goals/${goalId}/projects/${projectId}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['goals'] })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)', backgroundColor: '#fff' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button onClick={() => setYear(y => y - 1)}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, width: 26, height: 26, cursor: 'pointer', color: 'var(--text2)', fontSize: 14 }}>‹</button>
            <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: 14, fontWeight: 600, color: 'var(--text1)', width: 42, textAlign: 'center' }}>{year}</span>
            <button onClick={() => setYear(y => y + 1)}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, width: 26, height: 26, cursor: 'pointer', color: 'var(--text2)', fontSize: 14 }}>›</button>
          </div>
          <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {[1,2,3,4].map(q => (
              <button key={q} onClick={() => setQuarter(q)}
                className="text-xs px-3 py-1.5 font-medium"
                style={{
                  backgroundColor: quarter === q ? 'var(--blue)' : '#fff',
                  color: quarter === q ? '#fff' : 'var(--text2)',
                  border: 'none', cursor: 'pointer',
                }}>Q{q}</button>
            ))}
          </div>
          {!isLoading && (
            <span className="text-sm" style={{ color: 'var(--text2)' }}>
              <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontWeight: 600, color: 'var(--text1)' }}>{goals.length}</span> objectives
            </span>
          )}
        </div>
        <button onClick={() => setNewGoalOpen(true)}
          className="text-sm px-4 py-2 font-medium"
          style={{ backgroundColor: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}>
          + New Goal
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6" style={{ backgroundColor: 'var(--bg)' }}>
        {isLoading ? (
          <div className="flex flex-col gap-3">
            {[1,2,3].map(i => <div key={i} className="h-24 rounded animate-pulse" style={{ backgroundColor: '#E0E3E3' }} />)}
          </div>
        ) : goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm" style={{ color: 'var(--text3)' }}>No goals for Q{quarter} {year}. Add one to start planning.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4" style={{ maxWidth: 860 }}>
            {goals.map(goal => {
              const pct = goal.progress
              return (
                <div key={goal.id} className="rounded" style={{ backgroundColor: '#fff', border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                  <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-semibold leading-snug" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>
                          {goal.objective}
                        </p>
                        {goal.owner_name && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>Owner: {goal.owner_name}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => setEditingGoal(goal)}
                          style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: '1px solid var(--blue)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>
                          Edit
                        </button>
                        <button onClick={() => deleteGoal(goal.id)}
                          style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: '1px solid var(--red)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#E0E3E3' }}>
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: pct === 100 ? 'var(--green)' : pct >= 50 ? 'var(--blue)' : '#E8820C' }} />
                      </div>
                      <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: 12, color: 'var(--text2)', width: 34, textAlign: 'right' }}>{pct}%</span>
                    </div>
                  </div>

                  <div className="px-5 py-4 flex flex-col gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold uppercase" style={{ color: 'var(--text2)', letterSpacing: '0.06em' }}>Key Results</p>
                        <button onClick={() => setAddKrGoalId(goal.id)}
                          style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                          + Add
                        </button>
                      </div>
                      {goal.key_results.length === 0 ? (
                        <p className="text-xs" style={{ color: 'var(--text3)' }}>No key results yet.</p>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          {goal.key_results.map(kr => {
                            const krPct = kr.target_value ? Math.min(100, Math.round((kr.current_value / kr.target_value) * 100)) : null
                            return (
                              <div key={kr.id} className="flex items-center gap-3 px-3 py-2 rounded" style={{ backgroundColor: '#F8F9FA', border: '1px solid var(--border)' }}>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs" style={{ color: 'var(--text1)' }}>{kr.description}</p>
                                  {kr.target_value != null && (
                                    <p className="text-xs mt-0.5" style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text3)' }}>
                                      {kr.current_value.toLocaleString()} / {kr.target_value.toLocaleString()}{kr.unit ? ` ${kr.unit}` : ''}
                                    </p>
                                  )}
                                </div>
                                {krPct !== null && (
                                  <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: 11, color: 'var(--text2)', flexShrink: 0 }}>{krPct}%</span>
                                )}
                                <button onClick={() => deleteKr(goal.id, kr.id)}
                                  style={{ color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, flexShrink: 0, lineHeight: 1 }}>×</button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold uppercase" style={{ color: 'var(--text2)', letterSpacing: '0.06em' }}>Linked Projects</p>
                        <button onClick={() => setLinkProjectGoalId(goal.id)}
                          style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                          + Link
                        </button>
                      </div>
                      {goal.linked_projects.length === 0 ? (
                        <p className="text-xs" style={{ color: 'var(--text3)' }}>No projects linked. Link projects to auto-calculate progress.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {goal.linked_projects.map(lp => {
                            const lPct = lp.tasks_count ? Math.round((lp.tasks_done / lp.tasks_count) * 100) : 0
                            return (
                              <div key={lp.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded" style={{ backgroundColor: '#EBF5FB', border: '1px solid #BDD7EE' }}>
                                <span className="text-xs font-medium" style={{ color: '#0073BB' }}>{lp.name}</span>
                                <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: 11, color: '#5A9FC8' }}>{lp.tasks_done}/{lp.tasks_count}</span>
                                <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: 11, color: '#5A9FC8' }}>{lPct}%</span>
                                <button onClick={() => unlinkProject(goal.id, lp.id)}
                                  style={{ color: '#5A9FC8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {newGoalOpen && (
        <GoalSlideOver
          mode="create"
          year={year}
          quarter={quarter}
          users={users}
          onClose={() => setNewGoalOpen(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['goals'] }); setNewGoalOpen(false) }}
        />
      )}

      {editingGoal && (
        <GoalSlideOver
          mode="edit"
          goal={editingGoal}
          year={year}
          quarter={quarter}
          users={users}
          onClose={() => setEditingGoal(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['goals'] }); setEditingGoal(null) }}
        />
      )}

      {addKrGoalId && (
        <AddKrSlideOver
          goalId={addKrGoalId}
          onClose={() => setAddKrGoalId(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['goals'] }); setAddKrGoalId(null) }}
        />
      )}

      {linkProjectGoalId && (
        <LinkProjectSlideOver
          goalId={linkProjectGoalId}
          allProjects={allProjects}
          onClose={() => setLinkProjectGoalId(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['goals'] }); setLinkProjectGoalId(null) }}
        />
      )}
    </div>
  )
}

// ── Main Work Page ────────────────────────────────────────────────────────────

// ── Calendar Tab ──────────────────────────────────────────────────────────────

function CalendarTab() {
  const qc = useQueryClient()
  const [mineOnly, setMineOnly]           = useState(false)
  const [companyFilter, setCompanyFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'client' | 'product' | 'ops' | 'rnd'>('all')
  const [selectedTask, setSelectedTask]   = useState<Task | null>(null)
  const cal = useCalendarMonth()

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies'],
    queryFn: () => fetch('/api/companies', { credentials: 'include' }).then(r => r.json()),
  })
  const { data: tasksData, isLoading } = useQuery<{ tasks: Task[] }>({
    queryKey: ['tasks', mineOnly],
    queryFn: () => fetch(mineOnly ? '/api/tasks?mine=true' : '/api/tasks', { credentials: 'include' }).then(r => r.json()),
  })
  const { data: projectsData } = useQuery<{ projects: Project[] }>({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/projects', { credentials: 'include' }).then(r => r.json()),
  })
  const { data: initiativesData } = useQuery<{ initiatives: RndInitiative[] }>({
    queryKey: ['rnd-initiatives', 'all', 'all'],
    queryFn: () => fetch('/api/rnd/initiatives', { credentials: 'include' }).then(r => r.json()),
  })

  const allTasks       = tasksData?.tasks ?? []
  const allProjects    = projectsData?.projects ?? []
  const allInitiatives = initiativesData?.initiatives ?? []
  const companies      = companiesData?.companies ?? []

  const filteredTasks = useMemo(() => {
    let list = allTasks
    if (companyFilter !== 'all') list = list.filter(t => t.company_id === companyFilter)
    if (categoryFilter !== 'all') {
      const ids = new Set(allProjects.filter(p => p.category === categoryFilter).map(p => p.id))
      list = list.filter(t => ids.has(t.project_id))
    }
    return list
  }, [allTasks, companyFilter, categoryFilter, allProjects])

  const calendarItems = useMemo(() => {
    const taskItems = tasksToCalendarItems(filteredTasks, setSelectedTask)
    const rndItems  = (categoryFilter === 'all' || categoryFilter === 'rnd')
      ? rndToCalendarItems(allInitiatives) : []
    return [...taskItems, ...rndItems]
  }, [filteredTasks, allInitiatives, categoryFilter])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 flex-shrink-0 flex-wrap gap-2"
        style={{ borderBottom: '1px solid var(--border)', backgroundColor: '#fff' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {[{ label: 'All Tasks', val: false }, { label: 'My Tasks', val: true }].map(opt => (
              <button key={String(opt.val)} onClick={() => setMineOnly(opt.val)}
                className="text-xs px-3 py-1.5 font-medium"
                style={{ backgroundColor: mineOnly === opt.val ? 'var(--blue)' : '#fff', color: mineOnly === opt.val ? '#fff' : 'var(--text2)', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}>
                {opt.label}
              </button>
            ))}
          </div>
          {companies.length > 1 && (
            <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
              style={{ height: 30, border: '1px solid var(--border)', borderRadius: 6, padding: '0 8px', fontSize: 12.5, background: '#fff', color: 'var(--text1)' }}>
              <option value="all">All Companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {(['all', 'client', 'product', 'ops', 'rnd'] as const).map(cat => (
              <button key={cat} onClick={() => setCategoryFilter(cat)}
                className="text-xs px-3 py-1.5 font-medium"
                style={{ backgroundColor: categoryFilter === cat ? 'var(--blue)' : '#fff', color: categoryFilter === cat ? '#fff' : 'var(--text2)', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}>
                {cat === 'all' ? 'All' : cat === 'rnd' ? 'R&D' : cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6" style={{ backgroundColor: 'var(--bg)' }}>
        {isLoading ? (
          <div className="animate-pulse rounded" style={{ height: 500, backgroundColor: '#E0E3E3' }} />
        ) : (
          <CalendarGrid
            items={calendarItems}
            monthLabel={cal.monthLabel}
            onPrev={cal.prev}
            onNext={cal.next}
            onToday={cal.today}
            year={cal.year}
            month={cal.month}
          />
        )}
      </div>
      <TaskSlideOver
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ['tasks'] }); setSelectedTask(null) }}
        projects={allProjects}
        users={[]}
        allTasks={allTasks}
      />
    </div>
  )
}

const TABS: { key: WorkTab; label: string; Icon?: React.ElementType }[] = [
  { key: 'tasks',    label: 'Tasks' },
  { key: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { key: 'projects', label: 'Projects' },
  { key: 'rnd',      label: 'R&D' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'goals',    label: 'Goals', Icon: Target },
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
                className="text-sm px-4 py-2 font-medium transition-colors flex items-center gap-1.5"
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
                {t.Icon && <t.Icon size={14} />}
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1" style={{ minHeight: 0, overflow: activeTab === 'rnd' ? 'hidden' : undefined }}>
        {activeTab === 'tasks'    && <TasksTab />}
        {activeTab === 'calendar' && <CalendarTab />}
        {activeTab === 'projects' && <ProjectsTab />}
        {activeTab === 'rnd'      && <RndTab />}
        {activeTab === 'sessions' && <SessionsTab />}
        {activeTab === 'goals'    && <GoalsTab />}
      </div>
    </div>
  )
}
