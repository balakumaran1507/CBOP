'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { PdfViewer } from '@/app/components/pdf-viewer'
import { Mail, ClipboardList, ChevronUp, ChevronDown, Paperclip, ExternalLink, ArrowRight, UserCircle, CheckCircle2, X, Plus, AlertTriangle, Link as LinkIcon, FileText, Shield } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type HiringTab  = 'applications' | 'roles' | 'batches' | 'interns' | 'settings'
type StageFilter = 'all' | 'applied' | 'reviewed' | 'shortlisted' | 'interview_scheduled' |
                   'interview_done' | 'on_hold' | 'selected' | 'offer_sent' | 'accepted' | 'onboarding' |
                   'active_intern' | 'rejected'

interface Applicant {
  id: string
  name: string
  email: string
  phone: string | null
  college: string | null
  year_of_study: number | null
  role_id: string | null
  role_title: string | null
  role_type: string | null
  is_technical: boolean | null
  company_id: string | null
  company_name: string | null
  ai_score: number
  ai_score_breakdown: ScoreBreakdown | null
  ai_summary: string | null
  ai_scored_at: string | null
  stage: string
  rejection_reason: string | null
  review_notes: string | null
  interview_at: string | null
  interview_meet_link: string | null
  interview_panel: { user_id: string; name: string }[] | null
  offer_sent_at: string | null
  rejection_queued_at: string | null
  rejection_sent_at: string | null
  source: string
  portfolio_url: string | null
  linkedin_url: string | null
  github_url: string | null
  resume_url: string | null
  resume_text: string | null
  stated_role: string | null
  tags: string[]
  created_at: string
}

interface ScoreBreakdown {
  skills_score: number
  projects_score: number
  prizes_score: number
  experience_score: number
  year_penalty: number
  total: number
  matched_skills: string[]
  missing_skills: string[]
  flags: string[]
}

interface HiringRole {
  id: string
  company_id: string
  company_name: string
  title: string
  role_type: string | null
  employment_type: string
  is_technical: boolean
  description: string | null
  required_skills: string[]
  preferred_skills: string[]
  min_year: number
  active: boolean
  slots: number
  applicant_count: number
  created_at: string
}

interface Intern {
  id: string
  applicant_id: string
  applicant_name: string
  email: string
  role_title: string | null
  company_name: string | null
  team_lead_name: string | null
  start_date: string | null
  end_date: string | null
  status: string
  created_at: string
}

interface HiringSettings {
  company_id: string
  rejection_delay_hours: number
  auto_reject_threshold: number
  auto_shortlist_threshold: number
  rejection_email_template: string | null
  interview_email_template: string | null
  offer_email_template: string | null
  welcome_email_template: string | null
  google_calendar_id: string | null
  slack_workspace_invite_url: string | null
  discord_invite_url: string | null
}

interface Company { id: string; name: string }
interface User    { id: string; name: string; role: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60)     return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)      return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function scoreBadgeStyle(score: number): React.CSSProperties {
  if (score >= 75) return { backgroundColor: '#EBF5E8', color: '#1D8102', border: '1px solid #1D8102' }
  if (score >= 50) return { backgroundColor: '#FEF8EE', color: '#E8820C', border: '1px solid #E8820C' }
  if (score >= 25) return { backgroundColor: '#FEF0EE', color: '#D13212', border: '1px solid #D13212' }
  return { backgroundColor: '#F2F3F3', color: '#687078', border: '1px solid #D5DBDB' }
}

const STAGE_STYLE: Record<string, React.CSSProperties> = {
  applied:              { backgroundColor: '#F2F3F3',  color: '#687078' },
  reviewed:             { backgroundColor: '#E8F4FB',  color: '#0073BB' },
  shortlisted:          { backgroundColor: '#EBF5E8',  color: '#1D8102' },
  interview_scheduled:  { backgroundColor: '#FEF8EE',  color: '#E8820C' },
  interview_done:       { backgroundColor: '#FEF8EE',  color: '#E8820C' },
  on_hold:              { backgroundColor: '#F3F0FF',  color: '#6D28D9' },
  selected:             { backgroundColor: '#E8F4FB',  color: '#0073BB' },
  offer_sent:           { backgroundColor: '#E8F4FB',  color: '#0073BB' },
  accepted:             { backgroundColor: '#EBF5E8',  color: '#1D8102' },
  onboarding:           { backgroundColor: '#EBF5E8',  color: '#1D8102' },
  active_intern:        { backgroundColor: '#EBF5E8',  color: '#1D8102' },
  rejected:             { backgroundColor: '#FEF0EE',  color: '#D13212' },
}

const STAGE_LABELS: Record<string, string> = {
  applied: 'Applied', reviewed: 'Reviewed', shortlisted: 'Shortlisted',
  interview_scheduled: 'Interview', interview_done: 'Int. Done', on_hold: 'On Hold',
  selected: 'Selected', offer_sent: 'Offer Sent', accepted: 'Accepted',
  onboarding: 'Onboarding', active_intern: 'Active Intern', rejected: 'Rejected',
}

const STAGE_GUIDANCE: Record<string, string> = {
  applied:              'Just submitted. Not yet reviewed by the team.',
  reviewed:             'Someone on the team has looked at this. Decide: shortlist or reject.',
  shortlisted:          'Moving forward. Will be contacted for an interview.',
  interview_scheduled:  'Interview scheduled. Awaiting completion.',
  interview_done:       'Interview complete. Make a decision: Select, Hold, or Reject.',
  on_hold:              'Parked - not rejected, not moving forward yet. Revisit later.',
  selected:             'Chosen for the role. Offer letter to be sent.',
  offer_sent:           'Offer email sent. Awaiting acceptance.',
  accepted:             'Candidate accepted the offer.',
  onboarding:           'Joining process in progress.',
  active_intern:        'Currently working with the team.',
  rejected:             'Not moving forward.',
}

// Quick rejection-reason presets - full, verbose, personalized paragraphs (not one-liners).
// This text becomes {{rejection_reason_line}} in the outgoing email - it IS the email,
// slotted between "we will not be moving forward" and "we encourage you to apply again."
// Multi-paragraph (blank-line separated) so it renders as proper paragraphs, not a wall of text.
function rejectionPresets(roleTitle: string): { label: string; text: string }[] {
  const role = roleTitle || 'this role'
  return [
    {
      label: 'Skills mismatch',
      text: `While your application showed promise, the specific technical skills we're looking for in the ${role} role don't yet fully match what you've demonstrated. This is often a timing issue rather than a reflection of your overall potential.\n\nWe'd encourage you to keep strengthening your hands-on project experience in this area - it would make a real difference in future applications.`,
    },
    {
      label: 'Position filled - competitive cycle',
      text: `This was an unusually competitive hiring cycle for the ${role} role, and we've already filled the available slots with candidates whose experience aligned most closely with our immediate needs.\n\nThis decision isn't a reflection of your ability, and we'd genuinely encourage you to apply again in our next hiring cycle.`,
    },
    {
      label: 'Limited experience',
      text: `Given where you are in your academic/professional journey, we're looking for a bit more hands-on project or internship experience before bringing someone on for the ${role} role.\n\nWe'd strongly encourage you to keep building - contribute to open-source projects, ship something end-to-end, and apply again as you gain more experience.`,
    },
    {
      label: 'Not selected - after interview',
      text: `Thank you for taking the time to interview with us. After speaking with you and comparing notes across the panel, we've decided to move forward with other candidates whose experience was a closer fit for what the ${role} role needs right now.\n\nWe genuinely enjoyed the conversation and would encourage you to apply again in the future.`,
    },
    {
      label: 'Already committed elsewhere',
      text: `We understand from your application that you may already be committed elsewhere, or that your availability may not align with what the ${role} role requires.\n\nIf that changes, we'd love for you to apply again in a future cycle.`,
    },
  ]
}

// Mirrors the live structure of hiring_settings.rejection_email_template - used to render
// an accurate "what will actually be sent" preview before queuing/sending. If a company has
// customized its template in Settings, the real send will follow that instead of this preview.
function previewRejectionEmail(applicantName: string, roleTitle: string, companyName: string, reason: string): string {
  const reasonLine = reason.trim() ? `\n\n${reason.trim()}` : ''
  return `Hi ${applicantName},\n\nThank you for applying for the ${roleTitle || 'role'} position at ${companyName}.\n\nAfter reviewing your application, we will not be moving forward at this time.${reasonLine}\n\nWe encourage you to continue building your skills and apply again in the future.\n\nBest,\n${companyName} Team`
}

const inputStyle: React.CSSProperties = {
  height: '36px', border: '1px solid var(--border)', borderRadius: '6px',
  outline: 'none', padding: '0 12px', fontSize: '0.875rem', width: '100%',
  fontFamily: 'var(--font-inter), sans-serif', backgroundColor: '#fff',
}

const textareaStyle: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: '6px', outline: 'none',
  padding: '8px 12px', fontSize: '0.875rem', width: '100%',
  fontFamily: 'var(--font-inter), sans-serif', backgroundColor: '#fff',
  resize: 'vertical', minHeight: '80px',
}

const btnPrimary: React.CSSProperties = {
  backgroundColor: 'var(--blue)', color: '#fff', border: 'none',
  borderRadius: '6px', padding: '0 16px', height: '36px', cursor: 'pointer',
  fontSize: '0.875rem', fontFamily: 'var(--font-inter), sans-serif',
}

const btnSecondary: React.CSSProperties = {
  backgroundColor: '#fff', color: 'var(--blue)', border: '1px solid var(--blue)',
  borderRadius: '6px', padding: '0 16px', height: '36px', cursor: 'pointer',
  fontSize: '0.875rem', fontFamily: 'var(--font-inter), sans-serif',
}

const btnDanger: React.CSSProperties = {
  backgroundColor: '#FEF0EE', color: '#D13212', border: '1px solid #D13212',
  borderRadius: '6px', padding: '0 16px', height: '36px', cursor: 'pointer',
  fontSize: '0.875rem', fontFamily: 'var(--font-inter), sans-serif',
}

function ScoreBar({ label, value, max, detail }: { label: string; value: number; max: number; detail?: string }) {
  const pct  = Math.round((value / max) * 100)
  const color = value >= max * 0.6 ? '#1D8102' : value >= max * 0.3 ? '#E8820C' : '#D13212'
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#16191F' }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, color }}>{value}<span style={{ fontSize: '0.75rem', color: '#687078', fontWeight: 400 }}>/{max}</span></span>
      </div>
      <div style={{ height: '10px', backgroundColor: '#F2F3F3', borderRadius: '6px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: '6px', transition: 'width 0.4s ease' }} />
      </div>
      {detail && <div style={{ fontSize: '0.75rem', color: '#687078', marginTop: '4px' }}>{detail}</div>}
    </div>
  )
}

// ── Score Tab ─────────────────────────────────────────────────────────────────

function ScoreTab({ applicant }: { applicant: Applicant }) {
  const bd = applicant.ai_score_breakdown
  if (!bd || !applicant.ai_scored_at) {
    return (
      <div style={{ padding: '32px 24px', color: '#687078', fontSize: '0.95rem', textAlign: 'center' }}>
        Not yet scored - go to Overview and click &quot;Run AI Score&quot;.
      </div>
    )
  }

  const verdictColor = bd.total >= 75 ? '#1D8102' : bd.total >= 50 ? '#E8820C' : '#D13212'
  const verdictLabel = bd.total >= 75 ? 'Strong' : bd.total >= 50 ? 'Average' : bd.total >= 25 ? 'Weak' : 'Auto-reject'

  return (
    <div style={{ padding: '24px' }}>

      {/* Score hero */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', marginBottom: '8px' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '3rem', fontWeight: 700, lineHeight: 1, color: verdictColor }}>{bd.total}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', color: '#687078', marginBottom: '6px' }}>/100</span>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: verdictColor, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{verdictLabel}</span>
      </div>

      {/* 3-line narrative */}
      {applicant.ai_summary && !applicant.ai_summary.includes('offline') && (
        <div style={{ marginBottom: '24px', padding: '14px 16px', backgroundColor: '#F8F9FA', borderRadius: '8px', borderLeft: `4px solid ${verdictColor}` }}>
          {applicant.ai_summary.split(/(?<=[.!?])\s+/).filter(Boolean).map((sentence, i) => (
            <p key={i} style={{ margin: i === 0 ? 0 : '8px 0 0', fontSize: '0.9rem', lineHeight: 1.6, color: '#16191F' }}>{sentence}</p>
          ))}
        </div>
      )}

      {/* Breakdown bars */}
      <div style={{ marginBottom: '8px' }}>
        <ScoreBar label="Skills"      value={bd.skills_score}     max={40} detail={bd.matched_skills.length ? `Matched: ${bd.matched_skills.join(', ')}` : undefined} />
        <ScoreBar label="Projects"    value={bd.projects_score}   max={30} />
        <ScoreBar label="Prizes"      value={bd.prizes_score}     max={20} />
        <ScoreBar label="Experience"  value={bd.experience_score} max={10} />
      </div>

      {/* Year adjustment */}
      {bd.year_penalty !== 0 && (
        <div style={{ marginBottom: '16px', padding: '8px 12px', backgroundColor: bd.year_penalty < 0 ? '#FEF0EE' : '#EBF5E8', borderRadius: '6px', fontSize: '0.85rem', color: bd.year_penalty < 0 ? '#D13212' : '#1D8102', fontWeight: 600 }}>
          Year adjustment: {bd.year_penalty > 0 ? '+' : ''}{bd.year_penalty} pts
        </div>
      )}

      {/* Skills */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {bd.matched_skills.length > 0 && (
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '8px', color: '#1D8102', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Matched</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {bd.matched_skills.map((s) => (
                <span key={s} style={{ backgroundColor: '#EBF5E8', color: '#1D8102', padding: '4px 10px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 500 }}>{s}</span>
              ))}
            </div>
          </div>
        )}
        {bd.missing_skills.length > 0 && (
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '8px', color: '#D13212', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Missing</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {bd.missing_skills.map((s) => (
                <span key={s} style={{ backgroundColor: '#FEF0EE', color: '#D13212', padding: '4px 10px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 500 }}>{s}</span>
              ))}
            </div>
          </div>
        )}
        {bd.flags.length > 0 && (
          <div style={{ padding: '10px 14px', backgroundColor: '#FEF8EE', borderRadius: '8px', fontSize: '0.85rem', color: '#92400E', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} /> {bd.flags.join(' · ')}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Applicant Detail Panel ────────────────────────────────────────────────────

function ApplicantDetailPanel({
  applicant,
  onClose,
  companies,
  users,
  roles,
  onRefresh,
}: {
  applicant: Applicant
  onClose: () => void
  companies: Company[]
  users: User[]
  roles: HiringRole[]
  onRefresh: () => void
}) {
  const qc = useQueryClient()
  const [tab, setTab]         = useState<'overview' | 'score' | 'timeline' | 'comments'>('overview')
  const [showInterview, setShowInterview] = useState(false)
  const [rejectReason, setRejectReason]   = useState('')
  const [showRejectBox, setShowRejectBox] = useState(false)
  const [showRejectPreview, setShowRejectPreview] = useState(false)
  const [showResume, setShowResume]       = useState(false)
  const [resumeUploading, setResumeUploading] = useState(false)
  const [resumeUrl, setResumeUrl]         = useState<string | null>(applicant.resume_url)
  const [roleUpdating, setRoleUpdating]   = useState(false)
  const resumeInputRef                    = useRef<HTMLInputElement>(null)

  const [interviewAt, setInterviewAt]         = useState('')
  const [meetLink, setMeetLink]               = useState('')
  const [panelIds, setPanelIds]               = useState<string[]>([])

  // Tags state
  const [tagInput, setTagInput] = useState('')
  const tagInputRef = useRef<HTMLInputElement>(null)

  // Comments state
  const [commentBody, setCommentBody] = useState('')

  const stageMut = useMutation({
    mutationFn: async (data: { stage: string; rejection_reason?: string; review_notes?: string }) => {
      const res = await fetch(`/api/hiring/applicants/${applicant.id}/stage`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => { onRefresh() },
  })

  const scoreMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/hiring/applicants/${applicant.id}/score`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => { onRefresh() },
  })

  const rejectNowMut = useMutation({
    mutationFn: async (reason?: string) => {
      const res = await fetch(`/api/hiring/applicants/${applicant.id}/reject-now`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rejection_reason: reason ?? '' }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => { onRefresh() },
  })

  const interviewMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/hiring/applicants/${applicant.id}/schedule-interview`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ interview_at: interviewAt, meet_link: meetLink, panel_user_ids: panelIds }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => { onRefresh(); setShowInterview(false) },
  })

  // Offer letter slide-over state
  const [showOffer, setShowOffer]               = useState(false)
  const [offerTemplates, setOfferTemplates]     = useState<{ id: string; name: string; tags: string[] }[]>([])
  const [offerTemplateId, setOfferTemplateId]   = useState('')
  const [offerSubject, setOfferSubject]         = useState('')
  const [offerMessage, setOfferMessage]         = useState('')
  const [offerSending, setOfferSending]         = useState(false)
  const [offerError, setOfferError]             = useState('')

  async function openOfferSlideOver() {
    setOfferError(''); setOfferTemplateId(''); setOfferSubject(''); setOfferMessage('')
    const res = await fetch('/api/documents/templates')
    if (res.ok) {
      const rows = await res.json() as { id: string; name: string; tags: string[]; company_id: string }[]
      setOfferTemplates(rows.filter(t => t.company_id === applicant.company_id))
    }
    setShowOffer(true)
  }

  async function submitOffer() {
    if (!offerTemplateId) { setOfferError('Pick a template'); return }
    setOfferSending(true); setOfferError('')
    try {
      const res = await fetch(`/api/hiring/applicants/${applicant.id}/generate-offer-from-template`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ template_id: offerTemplateId, email_subject: offerSubject || undefined, email_message: offerMessage || undefined }),
      })
      const d = await res.json() as { ok?: boolean; batch_id?: string; error?: string }
      if (!res.ok) { setOfferError(d.error ?? 'Failed'); return }
      setShowOffer(false)
      onRefresh()
    } catch (e) {
      setOfferError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setOfferSending(false)
    }
  }

  async function handleResumeUpload(file: File) {
    setResumeUploading(true)
    try {
      const fd = new FormData()
      fd.append('resume', file)
      const res = await fetch(`/api/hiring/applicants/${applicant.id}/resume`, { method: 'POST', body: fd })
      const data = await res.json() as { ok?: boolean; resume_url?: string; error?: string }
      if (!res.ok) { alert(data.error || 'Upload failed'); return }
      setResumeUrl(data.resume_url ?? null)
      onRefresh()
    } catch {
      alert('Upload failed')
    } finally {
      setResumeUploading(false)
    }
  }

  async function handleRoleChange(newRoleId: string) {
    setRoleUpdating(true)
    try {
      const res = await fetch(`/api/hiring/applicants/${applicant.id}/role`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ role_id: newRoleId || null }),
      })
      if (!res.ok) { alert('Failed to update role'); return }
      onRefresh()
    } finally {
      setRoleUpdating(false)
    }
  }

  // Tags mutation
  const tagsMut = useMutation({
    mutationFn: async (tags: string[]) => {
      const res = await fetch(`/api/hiring/applicants/${applicant.id}/tags`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tags }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => { onRefresh() },
  })

  function handleAddTag() {
    const val = tagInput.trim().toLowerCase()
    if (!val) return
    if (val.length > 30) { alert('Tag must be 30 characters or fewer'); return }
    const current = applicant.tags || []
    if (current.includes(val)) { setTagInput(''); return }
    if (current.length >= 10) { alert('Max 10 tags'); return }
    tagsMut.mutate([...current, val])
    setTagInput('')
  }

  function handleRemoveTag(tag: string) {
    const current = applicant.tags || []
    tagsMut.mutate(current.filter((t) => t !== tag))
  }

  // Comments query
  const commentsQuery = useQuery({
    queryKey: ['applicant-comments', applicant.id],
    queryFn: () => fetch(`/api/hiring/applicants/${applicant.id}/comments`).then((r) => r.json()) as Promise<{ comments: { id: string; user_id: string; user_name: string; body: string; created_at: string }[] }>,
    enabled: tab === 'comments',
  })

  // Me query (for comment ownership check)
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn:  () => fetch('/api/session').then((r) => r.json()) as Promise<{ userId: string; role: string; name: string }>,
  })

  const postCommentMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/hiring/applicants/${applicant.id}/comments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: commentBody }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      setCommentBody('')
      qc.invalidateQueries({ queryKey: ['applicant-comments', applicant.id] })
    },
  })

  const deleteCommentMut = useMutation({
    mutationFn: async (commentId: string) => {
      const res = await fetch(`/api/hiring/comments/${commentId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['applicant-comments', applicant.id] }) },
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', fontWeight: 700, ...scoreBadgeStyle(applicant.ai_score), padding: '2px 8px', borderRadius: '6px' }}>
                  {applicant.ai_score}
                </span>
                <span style={{ fontFamily: 'var(--font-syne)', fontSize: '1.1rem', fontWeight: 600 }}>{applicant.name}</span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#687078', marginTop: '4px' }}>
                {applicant.role_title || 'No role'} · {applicant.company_name || ''}
              </div>
              {applicant.stated_role && applicant.stated_role.toLowerCase() !== (applicant.role_title || '').toLowerCase() && (
                <div style={{ fontSize: '0.75rem', marginTop: '3px' }}>
                  <span style={{ backgroundColor: '#FEF3C7', color: '#92400E', padding: '1px 7px', borderRadius: '4px', fontWeight: 600 }}>
                    Applied for: {applicant.stated_role}
                  </span>
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#687078' }}><X size={19} /></button>
          </div>
          <div style={{ marginTop: '8px' }}>
            <span style={{ ...STAGE_STYLE[applicant.stage], padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>
              {STAGE_LABELS[applicant.stage] || applicant.stage}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {(['overview', 'score', 'timeline', 'comments'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '10px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: '0.8rem', fontWeight: tab === t ? 600 : 400,
                borderBottom: tab === t ? '2px solid var(--blue)' : '2px solid transparent',
                color: tab === t ? 'var(--blue)' : '#687078',
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {tab === 'overview' && (
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#687078', marginBottom: '2px' }}>EMAIL</div>
                  <div style={{ fontSize: '0.875rem' }}>{applicant.email}</div>
                </div>
                {applicant.phone && (
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#687078', marginBottom: '2px' }}>PHONE</div>
                    <div style={{ fontSize: '0.875rem' }}>{applicant.phone}</div>
                  </div>
                )}
                {applicant.college && (
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#687078', marginBottom: '2px' }}>COLLEGE</div>
                    <div style={{ fontSize: '0.875rem' }}>{applicant.college}</div>
                  </div>
                )}
                {applicant.year_of_study && (
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#687078', marginBottom: '2px' }}>YEAR</div>
                    <div style={{ fontSize: '0.875rem' }}>Year {applicant.year_of_study}</div>
                  </div>
                )}
              </div>

              {/* Role assignment */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '0.7rem', color: '#687078', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Assigned Role</div>
                <select
                  value={applicant.role_id || ''}
                  onChange={(e) => handleRoleChange(e.target.value)}
                  disabled={roleUpdating}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #D5DBDB', borderRadius: '6px', fontSize: '0.875rem', background: '#fff', color: '#16191F', cursor: 'pointer' }}
                >
                  <option value="">- No role assigned -</option>
                  {roles.filter((r) => r.company_id === applicant.company_id && r.active).map((r) => (
                    <option key={r.id} value={r.id}>{r.title}</option>
                  ))}
                  {roles.filter((r) => r.company_id === applicant.company_id && !r.active).map((r) => (
                    <option key={r.id} value={r.id}>{r.title} (closed)</option>
                  ))}
                </select>
              </div>

              {/* Links */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                {applicant.linkedin_url && (
                  <a href={applicant.linkedin_url} target="_blank" rel="noreferrer" style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', fontSize: '0.75rem' }}>LinkedIn</a>
                )}
                {applicant.github_url && (
                  <a href={applicant.github_url} target="_blank" rel="noreferrer" style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', fontSize: '0.75rem' }}>GitHub</a>
                )}
                {applicant.portfolio_url && (
                  <a href={applicant.portfolio_url} target="_blank" rel="noreferrer" style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', fontSize: '0.75rem' }}>Portfolio</a>
                )}
              </div>

              {applicant.ai_summary && (
                <div style={{ padding: '10px 12px', backgroundColor: applicant.ai_summary.includes('offline') ? '#FEF3C7' : '#F2F3F3', borderRadius: '6px', fontSize: '0.875rem', marginBottom: '16px', color: applicant.ai_summary.includes('offline') ? '#92400E' : '#546474' }}>
                  {applicant.ai_summary.split(/(?<=[.!?])\s+/)[0]}
                  {applicant.ai_summary.split(/(?<=[.!?])\s+/).length > 1 && (
                    <span style={{ color: 'var(--blue)', cursor: 'pointer', marginLeft: '6px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 3 }} onClick={() => setTab('score')}>
                      Full analysis <ArrowRight size={12} />
                    </span>
                  )}
                </div>
              )}

              {/* Tags */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#687078', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>Tags</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                  {(applicant.tags || []).length === 0 && (
                    <span style={{ fontSize: '0.8rem', color: '#687078' }}>No tags</span>
                  )}
                  {(applicant.tags || []).map((tag) => (
                    <span
                      key={tag}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#F2F3F3', color: '#16191F', border: '1px solid #D5DBDB', borderRadius: '20px', fontSize: '0.75rem', padding: '2px 10px' }}
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 2px', color: '#687078', fontSize: '0.85rem', lineHeight: 1, display: 'flex', alignItems: 'center' }}
                        title="Remove tag"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    ref={tagInputRef}
                    type="text"
                    placeholder="Add tag..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag() } }}
                    maxLength={30}
                    style={{ flex: 1, height: '32px', border: '1px solid #D5DBDB', borderRadius: '6px', padding: '0 10px', fontSize: '0.8rem', fontFamily: 'var(--font-inter), sans-serif' }}
                  />
                  <button
                    onClick={handleAddTag}
                    disabled={!tagInput.trim() || tagsMut.isPending}
                    style={{ height: '32px', padding: '0 12px', backgroundColor: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Resume file upload + viewer */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#687078', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Resume</span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {resumeUrl && (
                      <a
                        href={`/api/hiring/applicants/${applicant.id}/resume/file`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: '0.75rem', color: 'var(--blue)', textDecoration: 'none' }}
                      >
                        Open in new tab
                      </a>
                    )}
                    <button
                      onClick={() => resumeInputRef.current?.click()}
                      disabled={resumeUploading}
                      style={{ fontSize: '0.75rem', color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      {resumeUploading ? 'Uploading...' : resumeUrl ? 'Replace' : 'Upload PDF/Image'}
                    </button>
                    <input
                      ref={resumeInputRef}
                      type="file"
                      accept="image/*,application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) handleResumeUpload(f)
                        e.target.value = ''
                      }}
                    />
                  </div>
                </div>

                {resumeUrl ? (
                  resumeUrl.startsWith('http') ? (
                    // Google Drive / Dropbox / external link
                    <div style={{ padding: '20px', backgroundColor: '#F9FAFB', borderRadius: '6px', border: '1px solid #D5DBDB', textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}><LinkIcon size={32} /></div>
                      <div style={{ fontSize: '0.8rem', color: '#687078', marginBottom: '12px' }}>
                        Resume shared via link
                      </div>
                      <a
                        href={resumeUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: 'inline-block', padding: '7px 16px', backgroundColor: '#0073BB', color: '#fff', borderRadius: '6px', fontSize: '0.8rem', textDecoration: 'none', fontWeight: 500 }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ExternalLink size={14} /> Open Resume</span>
                      </a>
                    </div>
                  ) : /\.pdf$/i.test(resumeUrl) ? (
                    <PdfViewer url={`/api/hiring/applicants/${applicant.id}/resume/file`} height="600px" />
                  ) : /\.docx$/i.test(resumeUrl) ? (
                    <DocxViewer applicantId={applicant.id} fileName={resumeUrl.split('/').pop() ?? 'resume.docx'} />
                  ) : /\.doc$/i.test(resumeUrl) ? (
                    <div style={{ padding: '20px', backgroundColor: '#F9FAFB', borderRadius: '6px', border: '1px solid #D5DBDB', textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}><FileText size={32} /></div>
                      <div style={{ fontSize: '0.85rem', color: '#16191F', marginBottom: '12px', fontWeight: 500 }}>{resumeUrl.split('/').pop()}</div>
                      <a href={`/api/hiring/applicants/${applicant.id}/resume/file`} download style={{ display: 'inline-block', padding: '7px 16px', backgroundColor: '#0073BB', color: '#fff', borderRadius: '6px', fontSize: '0.8rem', textDecoration: 'none', fontWeight: 500 }}>
                        Download DOC
                      </a>
                    </div>
                  ) : (
                    <img src={`/api/hiring/applicants/${applicant.id}/resume/file`} alt="Resume" style={{ width: '100%', borderRadius: '4px', border: '1px solid var(--border)' }} />
                  )
                ) : (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#687078', backgroundColor: '#F9FAFB', borderRadius: '6px', border: '1px dashed #D5DBDB', fontSize: '0.875rem' }}>
                    No resume file - applicant may have sent text only.
                    <div style={{ marginTop: '8px' }}>
                      <button onClick={() => resumeInputRef.current?.click()} style={{ fontSize: '0.8rem', color: '#0073BB', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                        Upload manually
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Original email / resume text */}
              {applicant.resume_text && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#687078', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {applicant.source === 'gmail_imap' ? 'Original Email' : 'Resume Text'}
                    </span>
                    <button
                      onClick={() => setShowResume(!showResume)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--blue)', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      {showResume ? <><ChevronUp size={14} /> Hide</> : <><ChevronDown size={14} /> Show</>}
                    </button>
                  </div>
                  {applicant.source === 'gmail_imap' && !showResume && (
                    <div style={{ padding: '8px 12px', backgroundColor: '#F8F9FA', border: '1px solid #E5E7EB', borderRadius: '6px', fontSize: '0.8rem', color: '#0073BB' }}>
                      Received via Gmail - click Show to view the original email body
                    </div>
                  )}
                  {showResume && (
                    <pre style={{ fontSize: '0.75rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', backgroundColor: '#F2F3F3', borderRadius: '6px', padding: '12px', maxHeight: '400px', overflowY: 'auto', color: '#16191F', fontFamily: 'var(--font-mono)', border: '1px solid #D5DBDB' }}>
                      {applicant.resume_text}
                    </pre>
                  )}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(!applicant.ai_scored_at || applicant.ai_summary?.includes('offline')) && (
                  <button style={btnPrimary} onClick={() => scoreMut.mutate()} disabled={scoreMut.isPending}>
                    {scoreMut.isPending ? 'Scoring with AI...' : applicant.ai_scored_at ? 'Re-score with AI' : 'Run AI Score'}
                  </button>
                )}
                {!['shortlisted','interview_scheduled','interview_done','on_hold','selected','offer_sent','accepted','onboarding','active_intern','rejected'].includes(applicant.stage) && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...btnPrimary, flex: 1 }} onClick={() => stageMut.mutate({ stage: 'shortlisted' })} disabled={stageMut.isPending}>
                      Shortlist
                    </button>
                    <button style={{ ...btnSecondary, flex: 1, borderColor: '#6D28D9', color: '#6D28D9' }} onClick={() => stageMut.mutate({ stage: 'on_hold' })} disabled={stageMut.isPending}>
                      Put On Hold
                    </button>
                  </div>
                )}
                {applicant.stage === 'on_hold' && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...btnPrimary, flex: 1 }} onClick={() => stageMut.mutate({ stage: 'shortlisted' })} disabled={stageMut.isPending}>
                      Shortlist
                    </button>
                    <button style={{ ...btnSecondary, flex: 1 }} onClick={() => stageMut.mutate({ stage: 'reviewed' })} disabled={stageMut.isPending}>
                      Resume Review
                    </button>
                  </div>
                )}
                {applicant.stage === 'shortlisted' && (
                  <button style={btnPrimary} onClick={() => setShowInterview(true)}>
                    Schedule Interview
                  </button>
                )}
                {applicant.stage === 'interview_done' && (
                  <>
                    <button style={btnPrimary} onClick={() => stageMut.mutate({ stage: 'selected' })}>Mark Selected</button>
                    <button style={{ ...btnSecondary, borderColor: '#6D28D9', color: '#6D28D9' }} onClick={() => stageMut.mutate({ stage: 'on_hold' })} disabled={stageMut.isPending}>Put On Hold</button>
                    <button
                      style={btnDanger}
                      onClick={() => {
                        setRejectReason(rejectionPresets(applicant.role_title || '').find(p => p.label.startsWith('Not selected'))?.text ?? '')
                        setShowRejectBox(true)
                      }}
                    >
                      Reject after Interview
                    </button>
                  </>
                )}
                {applicant.stage === 'selected' && (
                  <button style={btnPrimary} onClick={openOfferSlideOver}>
                    Send Offer Letter
                  </button>
                )}
                {(applicant.stage !== 'rejected' || (!applicant.rejection_queued_at && !applicant.rejection_sent_at)) && (
                  <>
                    {!showRejectBox ? (
                      <button style={btnDanger} onClick={() => setShowRejectBox(true)}>
                        {applicant.stage === 'rejected' ? 'Send Rejection Email' : 'Reject'}
                      </button>
                    ) : (
                      <div style={{ border: '1px solid #FECACA', borderRadius: '8px', padding: '16px', backgroundColor: '#FFF5F5' }}>
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#D13212', marginBottom: '4px' }}>
                            {applicant.stage === 'rejected' ? 'AI auto-rejected - confirm rejection email' : 'Confirm rejection'}
                          </div>
                          <div style={{ fontSize: '0.82rem', color: '#687078' }}>
                            {applicant.name} · Score {applicant.ai_score}/100<br />
                            {applicant.stage === 'rejected'
                              ? 'AI marked this as rejected (low score). No email has been sent yet - you decide.'
                              : 'Bala & Nabeelah will be notified on Telegram.'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                          {rejectionPresets(applicant.role_title || '').map((p) => (
                            <button
                              key={p.label}
                              type="button"
                              onClick={() => setRejectReason(p.text)}
                              style={{
                                fontSize: '0.72rem', padding: '4px 10px', borderRadius: '12px',
                                border: '1px solid #FECACA', background: rejectReason === p.text ? '#FEE2E2' : '#fff',
                                color: '#9F1239', cursor: 'pointer', fontWeight: 600,
                              }}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                        <textarea
                          style={{ ...textareaStyle, minHeight: '110px', marginBottom: '4px', borderColor: '#FECACA' }}
                          placeholder="e.g. Already enrolled in another program, skills gap in backend..."
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <div style={{ fontSize: '0.72rem', color: '#9CA3AF', marginBottom: '10px' }}>
                          This reason becomes a paragraph inside the actual rejection email (and is also sent to the internal Telegram notification). Pick a preset above - fully editable - or write your own.
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowRejectPreview(!showRejectPreview)}
                          style={{ ...btnSecondary, width: '100%', marginBottom: '10px', borderColor: '#9F1239', color: '#9F1239', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                        >
                          {showRejectPreview ? <><ChevronUp size={16} /> Hide full email preview</> : <><ChevronDown size={16} /> Preview full email that will be sent</>}
                        </button>
                        {showRejectPreview && (
                          <div style={{ marginBottom: '12px', border: '1px solid #FECACA', borderRadius: '8px', overflow: 'hidden' }}>
                            <div style={{ background: '#FEE2E2', padding: '6px 12px', fontSize: '0.7rem', fontWeight: 700, color: '#9F1239', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              To: {applicant.email}
                            </div>
                            <pre style={{
                              margin: 0, padding: '14px', fontSize: '0.8rem', lineHeight: 1.6, color: '#16191F',
                              whiteSpace: 'pre-wrap', wordBreak: 'break-word', backgroundColor: '#fff',
                              fontFamily: 'var(--font-inter), sans-serif',
                            }}>
                              {previewRejectionEmail(applicant.name, applicant.role_title || '', applicant.company_name || '', rejectReason)}
                            </pre>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            style={{ ...btnDanger, flex: 1 }}
                            onClick={() => stageMut.mutate({ stage: 'rejected', rejection_reason: rejectReason })}
                            disabled={stageMut.isPending}
                          >
                            {stageMut.isPending ? 'Queuing...' : 'Queue (sends in 48h)'}
                          </button>
                          <button
                            style={{ flex: 1, height: '36px', borderRadius: '6px', backgroundColor: '#D13212', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}
                            onClick={() => rejectNowMut.mutate(rejectReason)}
                            disabled={rejectNowMut.isPending}
                          >
                            {rejectNowMut.isPending ? 'Sending...' : 'Send Now'}
                          </button>
                        </div>
                        <button style={{ ...btnSecondary, width: '100%', marginTop: '8px' }} onClick={() => { setShowRejectBox(false); setRejectReason(''); setShowRejectPreview(false) }}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </>
                )}

                {applicant.stage === 'rejected' && !applicant.rejection_sent_at && (
                  <button
                    style={{ ...btnSecondary, width: '100%', marginTop: '8px', borderColor: '#E8820C', color: '#E8820C' }}
                    onClick={() => stageMut.mutate({ stage: 'reviewed' })}
                    disabled={stageMut.isPending}
                  >
                    Cancel Queued Rejection
                  </button>
                )}

                <button
                  style={{ ...btnDanger, width: '100%', marginTop: '8px', opacity: 0.7 }}
                  onClick={async () => {
                    if (!confirm(`Delete ${applicant.name} permanently? This cannot be undone.`)) return
                    const res = await fetch(`/api/hiring/applicants/${applicant.id}`, { method: 'DELETE', credentials: 'include' })
                    if (!res.ok) {
                      const d = await res.json().catch(() => ({})) as { error?: string }
                      alert(`Failed to delete: ${d.error ?? res.status}`)
                      return
                    }
                    onRefresh()
                    onClose()
                  }}
                >
                  Delete Record
                </button>
              </div>
            </div>
          )}

          {tab === 'score' && <ScoreTab applicant={applicant} />}

          {tab === 'timeline' && (
            <div style={{ padding: '24px' }}>
              <div style={{ fontSize: '0.875rem', color: '#687078' }}>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                  <span style={{ ...STAGE_STYLE.applied, padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>Applied</span>
                  <span style={{ color: '#687078' }}>{fmtDate(applicant.created_at)} · {applicant.source}</span>
                </div>
                {applicant.ai_scored_at && (
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <span style={{ ...STAGE_STYLE.reviewed, padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>AI Scored</span>
                    <span>{fmtDate(applicant.ai_scored_at)} · Score: {applicant.ai_score}/100</span>
                  </div>
                )}
                {applicant.interview_at && (
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <span style={{ ...STAGE_STYLE.interview_scheduled, padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>Interview</span>
                    <span>{fmtDate(applicant.interview_at)}</span>
                  </div>
                )}
                {applicant.offer_sent_at && (
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <span style={{ ...STAGE_STYLE.offer_sent, padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>Offer Sent</span>
                    <span>{fmtDate(applicant.offer_sent_at)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '12px' }}>
                  <span style={{ ...STAGE_STYLE[applicant.stage], padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>Current: {STAGE_LABELS[applicant.stage]}</span>
                </div>
              </div>
            </div>
          )}

          {tab === 'comments' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Comment list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                {commentsQuery.isLoading && (
                  <div style={{ textAlign: 'center', padding: '40px', fontSize: '0.875rem', color: '#687078' }}>Loading...</div>
                )}
                {!commentsQuery.isLoading && (commentsQuery.data?.comments || []).length === 0 && (
                  <div style={{ textAlign: 'center', padding: '40px', fontSize: '0.875rem', color: '#687078' }}>
                    No comments yet. Be the first.
                  </div>
                )}
                {(commentsQuery.data?.comments || []).map((comment) => (
                  <div
                    key={comment.id}
                    style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: '6px', padding: '12px', marginBottom: '8px', position: 'relative' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: '0.8rem', fontFamily: 'var(--font-inter), sans-serif' }}>{comment.user_name}</span>
                        <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: '#687078', fontFamily: 'var(--font-mono)' }}>{timeAgo(comment.created_at)}</span>
                      </div>
                      {(meQuery.data?.userId === comment.user_id || meQuery.data?.role === 'ceo') && (
                        <button
                          onClick={() => deleteCommentMut.mutate(comment.id)}
                          disabled={deleteCommentMut.isPending}
                          title="Delete comment"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 8px', fontSize: '1rem', color: '#D5DBDB', lineHeight: 1 }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#D13212' }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#D5DBDB' }}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#16191F', fontFamily: 'var(--font-inter), sans-serif' }}>
                      {comment.body}
                    </div>
                  </div>
                ))}
              </div>

              {/* Post comment input - sticky at bottom */}
              <div style={{ borderTop: '1px solid #D5DBDB', padding: '12px 24px', flexShrink: 0, background: '#fff' }}>
                <textarea
                  placeholder="Add a comment... (Enter to send, Shift+Enter for new line)"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (commentBody.trim() && !postCommentMut.isPending) postCommentMut.mutate()
                    }
                  }}
                  style={{ width: '100%', minHeight: '80px', border: '1px solid #D5DBDB', borderRadius: '6px', padding: '8px', resize: 'vertical', fontSize: '0.875rem', fontFamily: 'var(--font-inter), sans-serif', boxSizing: 'border-box' }}
                />
                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => { if (commentBody.trim()) postCommentMut.mutate() }}
                    disabled={!commentBody.trim() || postCommentMut.isPending}
                    style={btnPrimary}
                  >
                    {postCommentMut.isPending ? 'Posting...' : 'Post'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Interview scheduling panel */}
        {showOffer && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }}>
            <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowOffer(false)} />
            <div style={{ width: '520px', background: '#fff', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)' }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontFamily: 'var(--font-syne)', fontWeight: 700, fontSize: '1.1rem' }}>Send Offer Letter</div>
                <button onClick={() => setShowOffer(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#687078' }}><X size={19} /></button>
              </div>
              <div style={{ padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#687078', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Template</div>
                  {offerTemplates.length === 0 ? (
                    <div style={{ fontSize: '0.875rem', color: '#687078', padding: '12px', background: '#F9FAFB', borderRadius: '6px', border: '1px solid var(--border)' }}>
                      No document templates for this company. Create one in <a href="/documents" style={{ color: '#0073BB' }}>/documents</a> first.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {offerTemplates.map((t) => (
                        <div
                          key={t.id}
                          onClick={() => setOfferTemplateId(t.id)}
                          style={{
                            padding: '12px 14px', borderRadius: '8px', cursor: 'pointer',
                            border: `2px solid ${offerTemplateId === t.id ? '#0073BB' : 'var(--border)'}`,
                            background: offerTemplateId === t.id ? '#EBF5FB' : '#fff',
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '4px' }}>{t.name}</div>
                          {t.tags.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {t.tags.map((tag) => (
                                <span key={tag} style={{ fontSize: '0.7rem', background: '#E8F4FD', color: '#0073BB', borderRadius: '4px', padding: '1px 6px', fontFamily: 'var(--font-mono)' }}>
                                  {`{{${tag}}}`}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#687078', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email Subject <span style={{ color: '#A0A0A0', fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
                  <input
                    style={inputStyle}
                    placeholder={`Internship Offer - ${applicant.role_title || 'Intern'} at ${applicant.company_name || ''}`}
                    value={offerSubject}
                    onChange={(e) => setOfferSubject(e.target.value)}
                  />
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#687078', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email Message <span style={{ color: '#A0A0A0', fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
                  <textarea
                    style={{ ...inputStyle, height: '100px', resize: 'vertical' }}
                    placeholder={`Dear ${applicant.name},\n\nPlease find your offer letter attached.\n\nBest regards,`}
                    value={offerMessage}
                    onChange={(e) => setOfferMessage(e.target.value)}
                  />
                </div>
                {offerError && <div style={{ color: '#D13212', fontSize: '0.85rem' }}>{offerError}</div>}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button style={btnPrimary} onClick={submitOffer} disabled={offerSending || !offerTemplateId}>
                    {offerSending ? 'Generating & Sending...' : 'Generate & Send'}
                  </button>
                  <button style={btnSecondary} onClick={() => setShowOffer(false)}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}
        {showInterview && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', backgroundColor: '#F9FAFB', flexShrink: 0 }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '12px' }}>Schedule Interview</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="datetime-local"
                style={inputStyle}
                value={interviewAt}
                onChange={(e) => setInterviewAt(e.target.value)}
                placeholder="Interview date & time"
              />
              <input
                style={inputStyle}
                placeholder="Google Meet link (optional)"
                value={meetLink}
                onChange={(e) => setMeetLink(e.target.value)}
              />
              <div style={{ fontSize: '0.75rem', color: '#687078', marginBottom: '4px' }}>Panel members:</div>
              {users.map((u) => (
                <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem' }}>
                  <input
                    type="checkbox"
                    checked={panelIds.includes(u.id)}
                    onChange={(e) => setPanelIds(e.target.checked ? [...panelIds, u.id] : panelIds.filter((id) => id !== u.id))}
                  />
                  {u.name} ({u.role})
                </label>
              ))}
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button style={btnPrimary} onClick={() => interviewMut.mutate()} disabled={!interviewAt || interviewMut.isPending}>
                  {interviewMut.isPending ? 'Scheduling...' : 'Schedule'}
                </button>
                <button style={btnSecondary} onClick={() => setShowInterview(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
    </div>
  )
}

// ── Applicant Card ─────────────────────────────────────────────────────────────

function ApplicantCard({ applicant, onClick }: { applicant: Applicant; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: '#fff', border: '1px solid var(--border)', borderRadius: '8px',
        padding: '16px', cursor: 'pointer', transition: 'box-shadow 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ ...scoreBadgeStyle(applicant.ai_score), fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', padding: '4px 8px', borderRadius: '6px', minWidth: '44px', textAlign: 'center' }}>
            {applicant.ai_scored_at ? applicant.ai_score : '-'}
          </span>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', fontFamily: 'var(--font-syne)' }}>{applicant.name}</div>
            <div style={{ fontSize: '0.75rem', color: '#687078' }}>
              {applicant.role_title || 'No role'} · {applicant.company_name || ''}{applicant.year_of_study ? ` · Year ${applicant.year_of_study}` : ''}
            </div>
            {applicant.stated_role && applicant.stated_role.toLowerCase() !== (applicant.role_title || '').toLowerCase() && (
              <div style={{ fontSize: '0.7rem', marginTop: '2px' }}>
                <span style={{ color: '#E8820C', fontWeight: 600 }}>Applied for: </span>
                <span style={{ color: '#687078' }}>{applicant.stated_role}</span>
              </div>
            )}
          </div>
        </div>
        <span style={{ ...STAGE_STYLE[applicant.stage], padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {STAGE_LABELS[applicant.stage] || applicant.stage}
        </span>
      </div>

      {applicant.ai_summary && (
        <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#546474' }}>
          {applicant.ai_summary.split(/(?<=[.!?])\s+/)[0]}
        </div>
      )}

      {(applicant.tags || []).length > 0 && (
        <div style={{ marginTop: '8px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {(applicant.tags || []).slice(0, 3).map((tag) => (
            <span
              key={tag}
              style={{ background: '#F2F3F3', color: '#16191F', border: '1px solid #D5DBDB', borderRadius: '20px', fontSize: '0.7rem', padding: '1px 8px' }}
            >
              {tag}
            </span>
          ))}
          {(applicant.tags || []).length > 3 && (
            <span style={{ fontSize: '0.7rem', color: '#687078' }}>+{(applicant.tags || []).length - 3}</span>
          )}
        </div>
      )}

      <div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#687078', display: 'flex', gap: '12px' }}>
        <span>{timeAgo(applicant.created_at)}</span>
        {applicant.college && <span>{applicant.college}</span>}
      </div>
    </div>
  )
}

// ── Hiring Board (Kanban - Greenhouse/Lever-style column-per-stage) ────────────

const BOARD_STAGES: string[] = [
  'applied', 'reviewed', 'shortlisted', 'interview_scheduled', 'interview_done',
  'on_hold', 'selected', 'offer_sent', 'accepted', 'onboarding', 'active_intern', 'rejected',
]

function BoardCard({ applicant, onClick, onMoveStage, isMoving }: {
  applicant: Applicant
  onClick: () => void
  onMoveStage: (stage: string) => void
  isMoving: boolean
}) {
  const [moveOpen, setMoveOpen] = useState(false)
  const moveRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!moveOpen) return
    function close(e: MouseEvent) {
      if (moveRef.current && !moveRef.current.contains(e.target as Node)) setMoveOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [moveOpen])

  return (
    <div style={{ marginBottom: 8, opacity: isMoving ? 0.5 : 1, transition: 'opacity 0.15s' }}>
      <ApplicantCard applicant={applicant} onClick={onClick} />
      {applicant.stage !== 'rejected' && (
        <div ref={moveRef} style={{ position: 'relative', marginTop: -4 }}>
          <button
            onClick={() => setMoveOpen(v => !v)}
            style={{
              width: '100%', padding: '4px 8px', fontSize: '0.7rem', fontWeight: 500,
              background: '#F2F3F3', color: '#546474', border: '1px solid #D5DBDB', borderTop: 'none',
              borderRadius: '0 0 8px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            Move <ChevronDown size={10} />
          </button>
          {moveOpen && (
            <div style={{
              position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 2, zIndex: 20,
              background: '#fff', border: '1px solid #D5DBDB', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              maxHeight: 220, overflowY: 'auto',
            }}>
              {BOARD_STAGES.filter(s => s !== applicant.stage && s !== 'rejected').map(s => (
                <button
                  key={s}
                  onClick={() => { setMoveOpen(false); onMoveStage(s) }}
                  style={{ width: '100%', textAlign: 'left', padding: '6px 10px', fontSize: '0.75rem', background: 'transparent', border: 'none', cursor: 'pointer', color: '#16191F' }}
                >
                  {STAGE_LABELS[s] || s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HiringBoard({ applicants, onMoveStage, movingId, onSelect }: {
  applicants: Applicant[]
  onMoveStage: (id: string, stage: string) => void
  movingId: string | null
  onSelect: (id: string) => void
}) {
  const byStage = useMemo(() => {
    const map: Record<string, Applicant[]> = {}
    for (const s of BOARD_STAGES) map[s] = []
    for (const a of applicants) (map[a.stage] ?? (map[a.stage] = [])).push(a)
    return map
  }, [applicants])

  return (
    <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', gap: 12, padding: '16px 20px', background: '#F8F9FA' }}>
      {BOARD_STAGES.map(stage => {
        const cards = byStage[stage] ?? []
        return (
          <div key={stage} className="flex flex-col flex-shrink-0" style={{ width: 260, background: '#F2F3F3', border: '1px solid #D5DBDB', borderRadius: 8, height: 'fit-content', maxHeight: '100%' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #D5DBDB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#546474' }}>
                {STAGE_LABELS[stage] || stage}
              </span>
              <span style={{ fontSize: '0.7rem', padding: '1px 7px', borderRadius: 10, background: 'rgba(0,0,0,0.06)', color: '#546474', fontFamily: 'var(--font-mono)' }}>
                {cards.length}
              </span>
            </div>
            <div style={{ padding: 8, overflowY: 'auto' }}>
              {cards.length === 0 ? (
                <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#AAB5BB', padding: '16px 0' }}>Empty</p>
              ) : (
                cards.map(a => (
                  <BoardCard
                    key={a.id}
                    applicant={a}
                    onClick={() => onSelect(a.id)}
                    onMoveStage={(stage) => onMoveStage(a.id, stage)}
                    isMoving={movingId === a.id}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Role Slide-over ───────────────────────────────────────────────────────────

function RoleSlideOver({ role, companies, onClose, onRefresh }: {
  role: HiringRole | null
  companies: Company[]
  onClose: () => void
  onRefresh: () => void
}) {
  const [form, setForm] = useState({
    company_id:      role?.company_id || companies[0]?.id || '',
    title:           role?.title      || '',
    required_skills: (role?.required_skills || []).join(', '),
    active:          role?.active     ?? true,
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        required_skills: form.required_skills.split(',').map((s) => s.trim()).filter(Boolean),
      }
      const url    = role ? `/api/hiring/roles/${role.id}` : '/api/hiring/roles'
      const method = role ? 'PATCH' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => { onRefresh(); onClose() },
  })

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 40 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '380px',
        backgroundColor: '#fff', zIndex: 50, display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', overflow: 'hidden',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-syne)', fontWeight: 600 }}>{role ? 'Edit Role' : 'Add Role'}</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#687078' }}><X size={19} /></button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Company</label>
            <select style={inputStyle} value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
              {companies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Role Title</label>
            <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Full Stack Developer" />
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              Required Skills
              <span style={{ fontWeight: 400, color: '#687078', marginLeft: '6px' }}>comma-separated - used for AI scoring</span>
            </label>
            <input style={inputStyle} value={form.required_skills} onChange={(e) => setForm({ ...form, required_skills: e.target.value })} placeholder="React, Node.js, PostgreSQL" />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active (open for applications)
          </label>
        </div>
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: '8px' }}>
          <button style={btnPrimary} onClick={() => saveMut.mutate()} disabled={!form.title || saveMut.isPending}>
            {saveMut.isPending ? 'Saving...' : 'Save Role'}
          </button>
          <button style={btnSecondary} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  )
}

// ── Add Applicant Slide-over ───────────────────────────────────────────────────

function AddApplicantSlideOver({ companies, roles, onClose, onRefresh }: {
  companies: Company[]
  roles: HiringRole[]
  onClose: () => void
  onRefresh: () => void
}) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', college: '',
    year_of_study: '', role_id: '', company_id: companies[0]?.id || '',
    resume_text: '', portfolio_url: '', linkedin_url: '', github_url: '',
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/hiring/applicants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, year_of_study: form.year_of_study ? Number(form.year_of_study) : null }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => { onRefresh(); onClose() },
  })

  const filteredRoles = roles.filter((r) => r.company_id === form.company_id && r.active)

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 40 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '440px',
        backgroundColor: '#fff', zIndex: 50, display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', overflow: 'hidden',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--font-syne)', fontWeight: 600 }}>Add Applicant</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#687078' }}><X size={19} /></button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[
            { label: 'Name *', key: 'name', placeholder: 'Full name' },
            { label: 'Email *', key: 'email', placeholder: 'email@example.com' },
            { label: 'Phone', key: 'phone', placeholder: '+91 98765 43210' },
            { label: 'College', key: 'college', placeholder: 'PSG Tech' },
            { label: 'Year of Study', key: 'year_of_study', placeholder: '3' },
            { label: 'LinkedIn URL', key: 'linkedin_url', placeholder: 'https://linkedin.com/in/...' },
            { label: 'GitHub URL', key: 'github_url', placeholder: 'https://github.com/...' },
            { label: 'Portfolio URL', key: 'portfolio_url', placeholder: 'https://...' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>{label}</label>
              <input style={inputStyle} placeholder={placeholder} value={(form as Record<string, string>)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            </div>
          ))}

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Company</label>
            <select style={inputStyle} value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value, role_id: '' })}>
              {companies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Role</label>
            <select style={inputStyle} value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
              <option value="">-- select --</option>
              {filteredRoles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Resume Text</label>
            <textarea style={{ ...textareaStyle, minHeight: '120px' }} placeholder="Paste resume text here for AI scoring..." value={form.resume_text} onChange={(e) => setForm({ ...form, resume_text: e.target.value })} />
          </div>
        </div>
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: '8px' }}>
          <button style={btnPrimary} onClick={() => saveMut.mutate()} disabled={!form.name || !form.email || saveMut.isPending}>
            {saveMut.isPending ? 'Adding...' : 'Add Applicant'}
          </button>
          <button style={btnSecondary} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HiringPage() {
  const qc = useQueryClient()

  const [tab, setTab]                   = useState<HiringTab>('applications')
  const [viewMode, setViewMode]         = useState<'list' | 'board'>('list')
  const [stageFilter, setStageFilter]   = useState<StageFilter>('all')
  const [companyFilter, setCompanyFilter] = useState('')
  const [roleFilter, setRoleFilter]     = useState('')
  const [minScore, setMinScore]         = useState(0)
  const [search, setSearch]             = useState('')
  const [selectedApplicantId, setSelectedApplicantId] = useState<string | null>(null)
  const [hoveredStage, setHoveredStage] = useState<string | null>(null)
  const [showAddApplicant, setShowAddApplicant]   = useState(false)
  const [showRoleSlideOver, setShowRoleSlideOver] = useState(false)
  const [showNotifySlideOver, setShowNotifySlideOver] = useState(false)
  const [showBatchSlideOver, setShowBatchSlideOver]   = useState(false)
  const [editRole, setEditRole]         = useState<HiringRole | null>(null)
  const [settingsCompanyId, setSettingsCompanyId] = useState('')

  const router = useRouter()

  const { data: sessionData } = useQuery({
    queryKey: ['session'],
    queryFn:  () => fetch('/api/session').then((r) => r.json()),
  })
  const userRole = sessionData?.role || ''

  const { data: companiesData } = useQuery({
    queryKey: ['companies'],
    queryFn:  () => fetch('/api/settings/companies').then((r) => r.json()),
  })
  const companies: Company[] = companiesData?.companies || []

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn:  () => fetch('/api/settings/users').then((r) => r.json()),
  })
  const users: User[] = usersData?.users || []

  const { data: applicantsData, refetch: refetchApplicants } = useQuery({
    queryKey: ['hiring-applicants', companyFilter, roleFilter, viewMode === 'board' ? 'all' : stageFilter],
    queryFn:  () => {
      const params = new URLSearchParams()
      if (companyFilter) params.set('company_id', companyFilter)
      if (roleFilter)    params.set('role_id', roleFilter)
      // Board view always shows every stage as columns - ignore the list's stage pill filter
      if (viewMode !== 'board' && stageFilter !== 'all') params.set('stage', stageFilter)
      return fetch(`/api/hiring/applicants?${params}`).then((r) => { if (!r.ok) throw new Error('api'); return r.json() })
    },
  })
  const allApplicants: Applicant[] = applicantsData?.applicants || []

  const boardStageMut = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: string }) => {
      const res = await fetch(`/api/hiring/applicants/${id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hiring-applicants'] })
      qc.invalidateQueries({ queryKey: ['hiring-stats'] })
    },
  })

  const { data: rolesData, refetch: refetchRoles } = useQuery({
    queryKey: ['hiring-roles'],
    queryFn:  () => fetch('/api/hiring/roles').then((r) => { if (!r.ok) throw new Error('api'); return r.json() }),
  })
  const roles: HiringRole[] = rolesData?.roles || []

  const { data: internsData } = useQuery({
    queryKey: ['hiring-interns'],
    queryFn:  () => fetch('/api/hiring/interns').then((r) => { if (!r.ok) throw new Error('api'); return r.json() }),
    enabled:  tab === 'interns',
  })
  const interns: Intern[] = internsData?.interns || []

  const { data: batchesData, refetch: refetchBatches } = useQuery({
    queryKey: ['hiring-batches-list'],
    queryFn:  () => fetch('/api/hiring/batches').then((r) => { if (!r.ok) throw new Error('api'); return r.json() }),
    enabled:  tab === 'batches',
  })
  const batches: {
    id: string; name: string | null; company_name: string; role_title: string | null;
    status: string; candidate_count: number; scheduled_at: string | null;
    meet_link: string | null; created_at: string
  }[] = batchesData?.batches || []

  const { data: statsData } = useQuery({
    queryKey: ['hiring-stats', companyFilter],
    queryFn:  () => {
      const params = new URLSearchParams()
      if (companyFilter) params.set('company_id', companyFilter)
      return fetch(`/api/hiring/stats?${params}`).then((r) => { if (!r.ok) throw new Error('api'); return r.json() })
    },
  })

  const { data: settingsData, refetch: refetchSettings } = useQuery({
    queryKey: ['hiring-settings', settingsCompanyId],
    queryFn:  () => settingsCompanyId ? fetch(`/api/hiring/settings/${settingsCompanyId}`).then((r) => r.json()) : Promise.resolve({ settings: null }),
    enabled:  tab === 'settings' && !!settingsCompanyId,
  })
  const currentSettings: HiringSettings | null = settingsData?.settings || null

  // Set default settings company when companies load
  useEffect(() => {
    if (!settingsCompanyId && companies.length > 0) setSettingsCompanyId(companies[0].id)
  }, [companies, settingsCompanyId])

  const filteredApplicants = useMemo(() => {
    return allApplicants.filter((a) => {
      if (minScore > 0 && a.ai_score < minScore) return false
      if (search) {
        const q = search.toLowerCase()
        if (!a.name.toLowerCase().includes(q) && !a.email.toLowerCase().includes(q) && !(a.college || '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [allApplicants, minScore, search])

  // Derive from live list so panel always shows fresh data after any mutation/refetch
  const selectedApplicant = useMemo(
    () => allApplicants.find((a) => a.id === selectedApplicantId) ?? null,
    [allApplicants, selectedApplicantId]
  )

  const stats = statsData || { total_applications: 0, by_stage: {}, this_week_count: 0, interviews_today: 0, avg_score: 0 }

  const saveSettingsMut = useMutation({
    mutationFn: async (data: Partial<HiringSettings>) => {
      const res = await fetch(`/api/hiring/settings/${settingsCompanyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => refetchSettings(),
  })

  const STAGES_FOR_FILTER: { key: StageFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'applied', label: 'Applied' },
    { key: 'reviewed', label: 'Reviewed' },
    { key: 'shortlisted', label: 'Shortlisted' },
    { key: 'interview_scheduled', label: 'Interview' },
    { key: 'on_hold', label: 'On Hold' },
    { key: 'selected', label: 'Selected' },
    { key: 'rejected', label: 'Rejected' },
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-syne)', fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>Hiring</h1>
            <div style={{ fontSize: '0.8rem', color: '#687078', marginTop: '2px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{stats.total_applications} total · {stats.this_week_count} this week · {stats.interviews_today} today</span>
              {companyFilter && companies.find(c => c.id === companyFilter) && (
                <span style={{ padding: '1px 8px', backgroundColor: '#EBF4FB', color: '#0073BB', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600 }}>
                  {companies.find(c => c.id === companyFilter)!.name}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {tab === 'applications' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ display: 'flex', borderRadius: 6, border: '1px solid #D5DBDB', overflow: 'hidden' }}>
                  {(['list', 'board'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setViewMode(v)}
                      style={{
                        padding: '0 14px', height: 32, border: 'none', cursor: 'pointer',
                        fontSize: '0.8125rem', fontWeight: 600, textTransform: 'capitalize',
                        background: viewMode === v ? '#0073BB' : '#fff',
                        color: viewMode === v ? '#fff' : '#546474',
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <button
                  style={{ ...btnPrimary, background: '#1D8102', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={() => setShowNotifySlideOver(true)}
                >
                  <Mail size={14} /> Notify Shortlisted
                </button>
                <button
                  style={{ ...btnPrimary, background: '#0073BB', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={() => setShowBatchSlideOver(true)}
                >
                  <ClipboardList size={14} /> Schedule Batch
                </button>
                <button style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setShowAddApplicant(true)}><Plus size={14} /> Add Applicant</button>
              </div>
            )}
            {tab === 'roles' && userRole === 'ceo' && (
              <button style={btnPrimary} onClick={() => { setEditRole(null); setShowRoleSlideOver(true) }}>+ Add Role</button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)' }}>
          {(['applications', 'roles', 'batches', 'interns', ...(userRole === 'ceo' ? ['settings'] : [])] as HiringTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: '0.875rem', fontWeight: tab === t ? 600 : 400,
                borderBottom: tab === t ? '2px solid var(--blue)' : '2px solid transparent',
                color: tab === t ? 'var(--blue)' : '#687078',
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'applications' && stats.by_stage?.applied ? ` (${stats.by_stage.applied})` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

        {/* Applications Tab - Board view (Kanban columns per stage, Greenhouse/Lever-style) */}
        {tab === 'applications' && viewMode === 'board' && (
          <HiringBoard
            applicants={filteredApplicants}
            onMoveStage={(id, stage) => boardStageMut.mutate({ id, stage })}
            movingId={boardStageMut.isPending ? boardStageMut.variables?.id ?? null : null}
            onSelect={setSelectedApplicantId}
          />
        )}
        {tab === 'applications' && viewMode === 'board' && selectedApplicant && (
          <>
            <div onClick={() => setSelectedApplicantId(null)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 40 }} />
            <div style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: '680px', maxWidth: '90vw',
              backgroundColor: '#F2F3F3', zIndex: 50, boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', overflow: 'hidden',
            }}>
              <ApplicantDetailPanel
                key={selectedApplicant.id}
                applicant={selectedApplicant}
                onClose={() => setSelectedApplicantId(null)}
                companies={companies}
                users={users}
                roles={roles}
                onRefresh={() => qc.invalidateQueries({ queryKey: ['hiring-applicants'] })}
              />
            </div>
          </>
        )}

        {/* Applications Tab - Ashby-style split panel */}
        {tab === 'applications' && viewMode === 'list' && (
          <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>

            {/* LEFT: applicant list (380px) */}
            <div style={{
              width: 380, minWidth: 380, borderRight: '1px solid #D5DBDB',
              display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden',
            }}>
              {/* Search + filters header */}
              <div style={{ padding: '12px 14px', borderBottom: '1px solid #D5DBDB', flexShrink: 0 }}>
                <input
                  style={{ ...inputStyle, marginBottom: '10px' }}
                  placeholder="Search name, email, college..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  <select style={{ ...inputStyle, flex: 1, fontSize: '0.8125rem' }} value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
                    <option value="">All companies</option>
                    {companies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
                  </select>
                  <select style={{ ...inputStyle, flex: 1, fontSize: '0.8125rem' }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                    <option value="">All roles</option>
                    {roles.filter((r) => !companyFilter || r.company_id === companyFilter).map((r) => (
                      <option key={r.id} value={r.id}>{r.title}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', fontSize: '0.8rem', color: '#687078', alignItems: 'center', gap: 6 }}>
                  <span>Score ≥ {minScore}</span>
                  <input type="range" min={0} max={100} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} style={{ flex: 1 }} />
                </div>
              </div>

              {/* Stage filter pills */}
              <div style={{ padding: '10px 14px 0', flexShrink: 0 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {STAGES_FOR_FILTER.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setStageFilter(s.key)}
                      onMouseEnter={() => setHoveredStage(s.key)}
                      onMouseLeave={() => setHoveredStage(null)}
                      style={{
                        padding: '4px 11px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                        fontSize: '0.8125rem', fontWeight: stageFilter === s.key ? 700 : 500,
                        backgroundColor: stageFilter === s.key ? '#0073BB' : '#F2F3F3',
                        color: stageFilter === s.key ? '#fff' : '#546474',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.label}{s.key !== 'all' && stats.by_stage?.[s.key] ? ` (${stats.by_stage[s.key]})` : ''}
                    </button>
                  ))}
                </div>
                <div style={{
                  height: '24px', marginTop: '6px', paddingBottom: '8px',
                  fontSize: '0.8rem', color: '#687078', fontStyle: 'italic',
                  borderBottom: '1px solid #D5DBDB',
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }}>
                  {hoveredStage && hoveredStage !== 'all' && STAGE_GUIDANCE[hoveredStage]
                    ? STAGE_GUIDANCE[hoveredStage]
                    : ' '}
                </div>
              </div>

              {/* Scrollable applicant list */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {filteredApplicants.length === 0 ? (
                  <div style={{ padding: '40px 16px', textAlign: 'center', color: '#687078', fontSize: '0.875rem' }}>
                    No applicants match your filters.
                  </div>
                ) : (
                  filteredApplicants.map((a) => (
                    <div
                      key={a.id}
                      onClick={() => setSelectedApplicantId(a.id)}
                      style={{
                        padding: '10px 16px',
                        borderBottom: '1px solid #F2F3F3',
                        cursor: 'pointer',
                        background: selectedApplicantId === a.id ? '#EBF4FB' : 'transparent',
                        borderLeft: selectedApplicantId === a.id ? '3px solid #0073BB' : '3px solid transparent',
                      }}
                      onMouseEnter={(e) => { if (selectedApplicantId !== a.id) e.currentTarget.style.background = '#F8F9FA' }}
                      onMouseLeave={(e) => { if (selectedApplicantId !== a.id) e.currentTarget.style.background = 'transparent' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 15, color: '#16191F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                          <div style={{ fontSize: 13, color: '#687078', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.role_title ?? 'No role'}</div>
                        </div>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, fontWeight: 700, ...scoreBadgeStyle(a.ai_score), padding: '2px 7px', borderRadius: 4, flexShrink: 0, marginLeft: 8 }}>
                          {a.ai_scored_at ? a.ai_score : '-'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                        <span title={STAGE_GUIDANCE[a.stage]} style={{ ...STAGE_STYLE[a.stage], fontSize: 12, padding: '2px 8px', borderRadius: 3, fontWeight: 600, cursor: 'help' }}>
                          {STAGE_LABELS[a.stage] || a.stage}
                        </span>
                        <span style={{ fontSize: 12, color: '#687078' }}>{timeAgo(a.created_at)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* RIGHT: detail panel */}
            <div style={{ flex: 1, overflow: 'hidden', background: '#F2F3F3' }}>
              {selectedApplicant ? (
                <ApplicantDetailPanel
                  key={selectedApplicant.id}
                  applicant={selectedApplicant}
                  onClose={() => setSelectedApplicantId(null)}
                  companies={companies}
                  users={users}
                  roles={roles}
                  onRefresh={() => qc.invalidateQueries({ queryKey: ['hiring-applicants'] })}
                />
              ) : (
                <div style={{
                  height: '100%', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', color: '#687078',
                }}>
                  <div style={{ marginBottom: 16, opacity: 0.3 }}><UserCircle size={48} /></div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#16191F' }}>Select a candidate</div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>Click a name on the left to review their application</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Batches Tab */}
        {tab === 'batches' && (
          <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <thead>
                <tr style={{ backgroundColor: '#F2F3F3' }}>
                  {['Batch', 'Company', 'Role', 'Candidates', 'Scheduled', 'Status', ''].map((h) => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#687078', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const statusStyle: Record<string, React.CSSProperties> = {
                    pending:    { backgroundColor: '#F2F3F3', color: '#687078' },
                    active:     { backgroundColor: '#FEF8EE', color: '#E8820C' },
                    complete:   { backgroundColor: '#EBF5E8', color: '#1D8102' },
                    cancelled:  { backgroundColor: '#FEF0EE', color: '#D13212' },
                  }
                  return (
                    <tr key={b.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, fontSize: '0.875rem' }}>
                        {b.name || `Batch - ${fmtDate(b.scheduled_at)}`}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '0.875rem', color: '#687078' }}>{b.company_name}</td>
                      <td style={{ padding: '10px 12px', fontSize: '0.875rem', color: '#687078' }}>{b.role_title || '-'}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{b.candidate_count}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: '#687078', whiteSpace: 'nowrap' }}>
                        {b.scheduled_at ? new Date(b.scheduled_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ ...(statusStyle[b.status] || statusStyle.pending), padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>
                          {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', display: 'flex', gap: '8px' }}>
                        <button
                          style={{ ...btnSecondary, height: '28px', fontSize: '0.75rem' }}
                          onClick={() => router.push(`/hiring/batch/${b.id}`)}
                        >
                          {b.status === 'active' ? 'Continue' : 'View'}
                        </button>
                        {b.meet_link && (
                          <a
                            href={b.meet_link}
                            target="_blank"
                            rel="noreferrer"
                            style={{ ...btnPrimary, height: '28px', fontSize: '0.75rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                          >
                            Join
                          </a>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {batches.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#687078' }}>No batches yet. Create one from the Applications tab.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Roles Tab */}
        {tab === 'roles' && (
          <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <thead>
                <tr style={{ backgroundColor: '#F2F3F3' }}>
                  {['Role', 'Company', 'Type', 'Technical', 'Slots', 'Applicants', 'Status', ''].map((h) => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#687078', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, fontSize: '0.875rem' }}>{r.title}</td>
                    <td style={{ padding: '10px 12px', fontSize: '0.875rem', color: '#687078' }}>{r.company_name}</td>
                    <td style={{ padding: '10px 12px', fontSize: '0.8rem', color: '#687078' }}>{(r.role_type || '').replace(/_/g, ' ')}</td>
                    <td style={{ padding: '10px 12px', fontSize: '0.8rem' }}>{r.is_technical ? 'Yes' : 'No'}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{r.slots}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{r.applicant_count}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ ...r.active ? { backgroundColor: '#EBF5E8', color: '#1D8102' } : { backgroundColor: '#F2F3F3', color: '#687078' }, padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>
                        {r.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {userRole === 'ceo' && (
                        <button style={{ ...btnSecondary, height: '28px', fontSize: '0.75rem' }} onClick={() => { setEditRole(r); setShowRoleSlideOver(true) }}>Edit</button>
                      )}
                    </td>
                  </tr>
                ))}
                {roles.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#687078' }}>No roles yet. Add one to get started.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Interns Tab */}
        {tab === 'interns' && (
          <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <thead>
                <tr style={{ backgroundColor: '#F2F3F3' }}>
                  {['Name', 'Role', 'Company', 'Team Lead', 'Start Date', 'Status'].map((h) => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#687078', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {interns.map((i) => (
                  <tr key={i.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, fontSize: '0.875rem' }}>{i.applicant_name}</td>
                    <td style={{ padding: '10px 12px', fontSize: '0.875rem' }}>{i.role_title || '-'}</td>
                    <td style={{ padding: '10px 12px', fontSize: '0.875rem', color: '#687078' }}>{i.company_name || '-'}</td>
                    <td style={{ padding: '10px 12px', fontSize: '0.875rem' }}>{i.team_lead_name || '-'}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{fmtDate(i.start_date)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ ...i.status === 'active' ? { backgroundColor: '#EBF5E8', color: '#1D8102' } : i.status === 'completed' ? { backgroundColor: '#F2F3F3', color: '#687078' } : { backgroundColor: '#FEF0EE', color: '#D13212' }, padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>
                        {i.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {interns.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#687078' }}>No active interns yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Settings Tab */}
        {tab === 'settings' && userRole === 'ceo' && (
          <div style={{ flex: 1, overflow: 'auto', padding: '24px', maxWidth: '680px' }}>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#687078', display: 'block', marginBottom: '6px' }}>COMPANY</label>
              <select style={{ ...inputStyle, width: '280px' }} value={settingsCompanyId} onChange={(e) => setSettingsCompanyId(e.target.value)}>
                {companies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
              </select>
            </div>

            {settingsCompanyId && (
              <SettingsForm companyId={settingsCompanyId} settings={currentSettings} onSave={(data) => saveSettingsMut.mutate(data)} saving={saveSettingsMut.isPending} />
            )}
          </div>
        )}
      </div>

      {/* Slide-overs */}
      {showAddApplicant && (
        <AddApplicantSlideOver
          companies={companies}
          roles={roles}
          onClose={() => setShowAddApplicant(false)}
          onRefresh={() => { refetchApplicants(); setShowAddApplicant(false) }}
        />
      )}
      {showRoleSlideOver && (
        <RoleSlideOver
          role={editRole}
          companies={companies}
          onClose={() => { setShowRoleSlideOver(false); setEditRole(null) }}
          onRefresh={() => { refetchRoles(); setShowRoleSlideOver(false); setEditRole(null) }}
        />
      )}
      {showNotifySlideOver && (
        <NotifyShortlistedSlideOver
          companies={companies}
          roles={roles}
          onClose={() => setShowNotifySlideOver(false)}
        />
      )}
      {showBatchSlideOver && (
        <BatchSlideOver
          companies={companies}
          roles={roles}
          onClose={() => setShowBatchSlideOver(false)}
          onCreated={(batchId) => { setShowBatchSlideOver(false); router.push(`/hiring/batch/${batchId}`) }}
        />
      )}
    </div>
  )
}

// ── DOCX Viewer ───────────────────────────────────────────────────────────────

function DocxViewer({ applicantId, fileName }: { applicantId: string; fileName: string }) {
  const [html, setHtml]       = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  useEffect(() => {
    setLoading(true); setError(false); setHtml(null)
    fetch(`/api/hiring/applicants/${applicantId}/resume/html`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: { html?: string }) => { setHtml(d.html ?? ''); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [applicantId])

  if (loading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#687078', backgroundColor: '#F9FAFB', borderRadius: '6px', border: '1px solid #D5DBDB' }}>
        <div style={{ fontSize: '0.875rem' }}>Loading document…</div>
      </div>
    )
  }

  if (error || html === null) {
    return (
      <div style={{ padding: '20px', backgroundColor: '#F9FAFB', borderRadius: '6px', border: '1px solid #D5DBDB', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}><FileText size={32} /></div>
        <div style={{ fontSize: '0.85rem', color: '#16191F', marginBottom: '12px', fontWeight: 500 }}>{fileName}</div>
        <a href={`/api/hiring/applicants/${applicantId}/resume/file`} download style={{ display: 'inline-block', padding: '7px 16px', backgroundColor: '#0073BB', color: '#fff', borderRadius: '6px', fontSize: '0.8rem', textDecoration: 'none', fontWeight: 500 }}>
          Download DOCX
        </a>
      </div>
    )
  }

  const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#16191F;padding:20px;margin:0;}h1,h2,h3{color:#232F3E;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #D5DBDB;padding:6px 8px;}a{color:#0073BB;}</style></head><body>${html}</body></html>`

  return (
    <iframe
      srcDoc={wrappedHtml}
      style={{ width: '100%', height: '700px', border: '1px solid #D5DBDB', borderRadius: '6px', display: 'block' }}
      title="Resume"
      sandbox="allow-same-origin"
    />
  )
}

// ── Batch Slide-over ──────────────────────────────────────────────────────────

interface BatchCandidateRow {
  applicant_id: string
  applicant_name: string
  applicant_email: string
  ai_score: number
  stage: string
  position: number
}

function BatchSlideOver({
  companies,
  roles,
  onClose,
  onCreated,
}: {
  companies: Company[]
  roles:     HiringRole[]
  onClose:   () => void
  onCreated: (batchId: string) => void
}) {
  const qc = useQueryClient()

  const [companyId, setCompanyId]     = useState(companies[0]?.id ?? '')
  const [roleId, setRoleId]           = useState('')
  const [batchName, setBatchName]     = useState('')
  const [meetLink, setMeetLink]       = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [slotDuration, setSlotDuration] = useState(15)
  const [bufferMinutes, setBufferMinutes] = useState(2)
  const [selectedCandidates, setSelectedCandidates] = useState<BatchCandidateRow[]>([])
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [success, setSuccess]         = useState<{ batch_id: string; count: number } | null>(null)

  const filteredRoles = roles.filter((r) => r.company_id === companyId && r.active)

  const { data: applicantsData } = useQuery({
    queryKey: ['batch-applicants', companyId, roleId],
    queryFn:  () => {
      const params = new URLSearchParams({ company_id: companyId, stage: 'shortlisted' })
      if (roleId) params.set('role_id', roleId)
      return fetch(`/api/hiring/applicants?${params}`).then((r) => r.json())
    },
    enabled: !!companyId,
  })
  const availableApplicants: Applicant[] = applicantsData?.applicants || []

  function toggleCandidate(a: Applicant) {
    setSelectedCandidates((prev) => {
      const exists = prev.find((c) => c.applicant_id === a.id)
      if (exists) return prev.filter((c) => c.applicant_id !== a.id)
      return [...prev, {
        applicant_id:   a.id,
        applicant_name:  a.name,
        applicant_email: a.email,
        ai_score:        a.ai_score,
        stage:           a.stage,
        position:        prev.length + 1,
      }]
    })
  }

  function moveUp(idx: number) {
    if (idx === 0) return
    setSelectedCandidates((prev) => {
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next.map((c, i) => ({ ...c, position: i + 1 }))
    })
  }

  function moveDown(idx: number) {
    setSelectedCandidates((prev) => {
      if (idx >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next.map((c, i) => ({ ...c, position: i + 1 }))
    })
  }

  async function submit() {
    if (!companyId || !meetLink || !scheduledAt) {
      setError('Company, Meet link and start time are required.')
      return
    }
    if (selectedCandidates.length === 0) {
      setError('Select at least one candidate.')
      return
    }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/hiring/batches', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          company_id:     companyId,
          role_id:        roleId || undefined,
          batch_name:     batchName || undefined,
          meet_link:      meetLink,
          scheduled_at:   scheduledAt,
          slot_duration:  slotDuration,
          buffer_minutes: bufferMinutes,
          applicant_ids:  selectedCandidates.map((c) => c.applicant_id),
        }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Failed to create batch'); return }
      setSuccess({ batch_id: d.batch_id, count: selectedCandidates.length })
      qc.invalidateQueries({ queryKey: ['hiring-batches'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
    setSaving(false)
  }

  const scoreStyle = (score: number): React.CSSProperties =>
    score >= 75 ? { color: '#1D8102', fontWeight: 700 }
    : score >= 50 ? { color: '#E8820C', fontWeight: 700 }
    : { color: '#D13212', fontWeight: 700 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 50 }} onClick={onClose}>
      <div
        style={{
          position: 'fixed', top: 0, right: 0, height: '100%', width: '520px',
          background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 51,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-syne)', fontWeight: 600, fontSize: '1.05rem' }}>Schedule Interview Batch</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#687078' }}><X size={19} /></button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {success ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}><CheckCircle2 size={32} color="#1D8102" /></div>
              <div style={{ fontFamily: 'var(--font-syne)', fontWeight: 700, fontSize: '1.1rem', marginBottom: '6px' }}>Batch created!</div>
              <div style={{ color: '#687078', fontSize: '0.875rem', marginBottom: '20px' }}>
                Prep emails sent to {success.count} candidate{success.count !== 1 ? 's' : ''}.
              </div>
              <button
                style={{ ...btnPrimary, width: '100%', marginBottom: '8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onClick={() => onCreated(success.batch_id)}
              >
                Open Interview Mode <ArrowRight size={16} />
              </button>
              <button style={{ ...btnSecondary, width: '100%' }} onClick={onClose}>Back to Hiring</button>
            </div>
          ) : (
            <>
              {/* Company */}
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Company *</label>
                <select
                  style={inputStyle}
                  value={companyId}
                  onChange={(e) => { setCompanyId(e.target.value); setRoleId(''); setSelectedCandidates([]) }}
                >
                  {companies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
                </select>
              </div>

              {/* Role */}
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Role <span style={{ fontWeight: 400, color: '#687078' }}>(optional - filters candidates)</span></label>
                <select
                  style={inputStyle}
                  value={roleId}
                  onChange={(e) => { setRoleId(e.target.value); setSelectedCandidates([]) }}
                >
                  <option value="">- All shortlisted -</option>
                  {filteredRoles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </div>

              {/* Batch Name */}
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Batch Name (optional)</label>
                <input
                  style={inputStyle}
                  placeholder="e.g. June Batch - Full Stack"
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                />
              </div>

              {/* Meet Link */}
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Google Meet Link *</label>
                <input
                  style={inputStyle}
                  placeholder="https://meet.google.com/xxx-yyyy-zzz"
                  value={meetLink}
                  onChange={(e) => setMeetLink(e.target.value)}
                />
              </div>

              {/* Start Time */}
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Start Time *</label>
                <input
                  type="datetime-local"
                  style={inputStyle}
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>

              {/* Slot + Buffer */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Slot Duration (min)</label>
                  <input
                    type="number"
                    style={inputStyle}
                    min={5}
                    max={120}
                    value={slotDuration}
                    onChange={(e) => setSlotDuration(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Buffer Between (min)</label>
                  <input
                    type="number"
                    style={inputStyle}
                    min={0}
                    max={30}
                    value={bufferMinutes}
                    onChange={(e) => setBufferMinutes(Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Candidate Multi-select */}
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Candidates (shortlisted)
                  {selectedCandidates.length > 0 && (
                    <span style={{ color: '#0073BB', fontWeight: 400, marginLeft: '8px' }}>{selectedCandidates.length} selected</span>
                  )}
                </label>

                {availableApplicants.length === 0 ? (
                  <div style={{ padding: '16px', backgroundColor: '#F2F3F3', borderRadius: '6px', fontSize: '0.8rem', color: '#687078', textAlign: 'center' }}>
                    No shortlisted candidates for this role
                  </div>
                ) : (
                  <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                    {availableApplicants.map((a) => {
                      const checked = selectedCandidates.some((c) => c.applicant_id === a.id)
                      return (
                        <label
                          key={a.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '10px 12px', cursor: 'pointer',
                            borderBottom: '1px solid var(--border)',
                            backgroundColor: checked ? '#F0F7FF' : '#fff',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCandidate(a)}
                            style={{ flexShrink: 0 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {a.name}
                              <span style={{ ...scoreStyle(a.ai_score), fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{a.ai_score}</span>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#687078' }}>{a.email}{a.college ? ` · ${a.college}` : ''}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Selected order */}
              {selectedCandidates.length > 0 && (
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Interview Order</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {selectedCandidates.map((c, idx) => (
                      <div key={c.applicant_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', backgroundColor: '#F8F9FA', borderRadius: '6px', border: '1px solid var(--border)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#687078', width: '20px', textAlign: 'center', flexShrink: 0 }}>#{c.position}</span>
                        <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 500 }}>{c.applicant_name}</span>
                        <button
                          onClick={() => moveUp(idx)}
                          disabled={idx === 0}
                          style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: idx === 0 ? '#D5DBDB' : '#687078', padding: '0 4px', display: 'inline-flex', alignItems: 'center' }}
                        ><ChevronUp size={16} /></button>
                        <button
                          onClick={() => moveDown(idx)}
                          disabled={idx === selectedCandidates.length - 1}
                          style={{ background: 'none', border: 'none', cursor: idx === selectedCandidates.length - 1 ? 'not-allowed' : 'pointer', color: idx === selectedCandidates.length - 1 ? '#D5DBDB' : '#687078', padding: '0 4px', display: 'inline-flex', alignItems: 'center' }}
                        ><ChevronDown size={16} /></button>
                      </div>
                    ))}
                  </div>
                  {scheduledAt && (
                    <div style={{ marginTop: '8px', padding: '8px 12px', backgroundColor: '#F8F9FA', borderRadius: '6px', fontSize: '0.75rem', color: '#0073BB' }}>
                      Est. end: {new Date(new Date(scheduledAt).getTime() + selectedCandidates.length * (slotDuration + bufferMinutes) * 60000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      {' '}({selectedCandidates.length} × {slotDuration + bufferMinutes} min)
                    </div>
                  )}
                </div>
              )}

              {/* Panel note */}
              <div style={{ padding: '10px 14px', backgroundColor: '#F2F3F3', borderRadius: '6px', fontSize: '0.8rem', color: '#687078' }}>
                Panel will be set to all active CBOP users. Panel members receive prep emails automatically.
              </div>

              {error && (
                <div style={{ padding: '10px 14px', backgroundColor: '#F8F9FA', borderRadius: '6px', fontSize: '0.8rem', color: '#D13212', border: '1px solid #E5E7EB' }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: '8px' }}>
            <button
              style={btnPrimary}
              onClick={submit}
              disabled={saving || !companyId || !meetLink || !scheduledAt || selectedCandidates.length === 0}
            >
              {saving ? 'Creating...' : `Create Batch (${selectedCandidates.length} candidates)`}
            </button>
            <button style={btnSecondary} onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Notify Shortlisted Slide-over ────────────────────────────────────────────

function NotifyShortlistedSlideOver({
  companies,
  roles,
  onClose,
}: {
  companies: Company[]
  roles:     HiringRole[]
  onClose:   () => void
}) {
  const [companyId, setCompanyId]       = useState(companies[0]?.id ?? "")
  const [roleId, setRoleId]             = useState("")
  const [stages, setStages]             = useState<string[]>(["shortlisted"])
  const [subject, setSubject]           = useState("You've been shortlisted - {{company_name}} Summer Internship")
  const [bodyHtml, setBodyHtml]         = useState(
    '<p>Hi {{name}},</p><p>Thank you for applying for the {{role_title}} position at {{company_name}}.</p><p>We have reviewed your application and are pleased to let you know that you have been shortlisted for the next stage of our selection process.</p><p>We will be in touch shortly with details about your interview slot.</p><p>If you have any questions in the meantime, just reply to this email.</p><p>Best regards,<br/>The {{company_name}} Team</p>'
  )
  const [pdfFile, setPdfFile]           = useState<File | null>(null)
  const [uploadedPdf, setUploadedPdf]   = useState("")
  const [spam, setSpam]                 = useState<{ score: number; level: string; findings: { message: string }[] } | null>(null)
  const [spamChecking, setSpamChecking] = useState(false)
  const [sending, setSending]           = useState(false)
  const [result, setResult]             = useState<{ count: number; previews: { name: string; email: string }[] } | null>(null)
  const [error, setError]               = useState("")
  const [dragOver, setDragOver]         = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const allStages     = ["shortlisted", "reviewed", "interview_done", "selected"]
  const filteredRoles = roles.filter(r => r.company_id === companyId)

  const nInp: React.CSSProperties = {
    width: '100%', border: '1px solid #D5DBDB', borderRadius: 8,
    padding: '10px 14px', fontSize: 14, outline: 'none',
    boxSizing: 'border-box', background: '#fff', color: '#16191F',
    fontFamily: 'Inter, sans-serif',
  }
  const nSel: React.CSSProperties = {
    ...nInp, height: 44, appearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23687078' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center', paddingRight: 36,
  }

  async function checkSpam() {
    setSpamChecking(true); setSpam(null)
    const res = await fetch("/api/campaigns/email/spam-check", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, body_html: bodyHtml }),
    })
    setSpam(await res.json())
    setSpamChecking(false)
  }

  async function uploadPdf() {
    if (!pdfFile) return ""
    const fd = new FormData()
    fd.append("pdf", pdfFile)
    const res = await fetch("/api/hiring/upload-pdf", { method: "POST", body: fd })
    const d   = await res.json()
    return d.filename ?? ""
  }

  async function send() {
    if (!companyId || !subject || !bodyHtml) { setError("Company, subject and body are required."); return }
    if (spam?.level === "block") { setError("Fix the spam issues before sending."); return }
    setSending(true); setError("")
    try {
      let pdf_path = uploadedPdf
      if (pdfFile && !pdf_path) pdf_path = await uploadPdf()
      const res = await fetch("/api/hiring/notify-shortlisted", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ company_id: companyId, subject, body_html: bodyHtml, stages, role_id: roleId || undefined, pdf_path: pdf_path || undefined }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? "Failed"); return }
      setResult(d)
    } catch (e) { setError(e instanceof Error ? e.message : "Failed") }
    setSending(false)
  }

  const spamColor = spam?.level === "block" ? "#D13212" : spam?.level === "warn" ? "#E8820C" : "#1D8102"

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50 }} onClick={onClose}>
      <div
        style={{
          position: "fixed", top: 0, right: 0, height: "100%", width: 680,
          background: "#fff", boxShadow: "-8px 0 40px rgba(0,0,0,0.15)",
          zIndex: 51, display: "flex", flexDirection: "column",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "22px 32px", borderBottom: "1px solid #E8EAED", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 20, fontWeight: 700, margin: 0, color: "#16191F" }}>
                Notify Shortlisted
              </h2>
              <p style={{ fontSize: 13, color: "#687078", margin: "4px 0 0" }}>
                Personal email to each candidate - no bulk headers, lands in Primary inbox
              </p>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "1px solid #D5DBDB", borderRadius: 6, width: 32, height: 32, fontSize: 18, cursor: "pointer", color: "#444", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
          {result ? (
            <div style={{ textAlign: "center", paddingTop: 60 }}>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}><Mail size={48} /></div>
              <div style={{ fontWeight: 700, fontSize: 18, color: "#1D8102", marginBottom: 10 }}>
                Sending to {result.count} candidates
              </div>
              <p style={{ fontSize: 14, color: "#687078", marginBottom: 24 }}>
                Running in the background (2s between each email). You can close this.
              </p>
              <div style={{ background: "#F8F9FA", borderRadius: 8, padding: "16px 20px", fontSize: 13, textAlign: "left", marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>First 5 recipients</div>
                {result.previews.map((p, i) => (
                  <div key={i} style={{ fontFamily: "IBM Plex Mono", fontSize: 13, color: "#444", padding: "3px 0" }}>
                    {p.name ? `${p.name} <${p.email}>` : p.email}
                  </div>
                ))}
              </div>
              <button onClick={onClose} style={{ background: "#0073BB", color: "#fff", border: "none", borderRadius: 6, padding: "10px 28px", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
                Close
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div style={{ background: "#F8F9FA", border: "1px solid #E5E7EB", borderRadius: 8, padding: "12px 16px", color: "#D13212", fontSize: 13, marginBottom: 24, fontWeight: 500 }}>
                  {error}
                </div>
              )}

              {/* Merge tags */}
              <div style={{ background: "#F8F9FA", border: "1px solid #E8EAED", borderRadius: 8, padding: "12px 16px", marginBottom: 24, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#687078", fontWeight: 600 }}>Merge tags:</span>
                {(["{{name}}", "{{role_title}}", "{{company_name}}"]).map(tag => (
                  <code key={tag} style={{ background: "#fff", border: "1px solid #D5DBDB", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontFamily: "IBM Plex Mono", color: "#0073BB" }}>{tag}</code>
                ))}
              </div>

              {/* Company + Role */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#232F3E", marginBottom: 6 }}>
                    Company <span style={{ color: "#D13212" }}>*</span>
                  </label>
                  <select value={companyId} onChange={e => { setCompanyId(e.target.value); setRoleId("") }} style={nSel}>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#232F3E", marginBottom: 6 }}>Role</label>
                  <select value={roleId} onChange={e => setRoleId(e.target.value)} style={nSel}>
                    <option value="">All roles</option>
                    {filteredRoles.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: "#687078", marginTop: 5 }}>Leave blank to include all roles</div>
                </div>
              </div>

              {/* Stages */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#232F3E", marginBottom: 10 }}>Stages to include</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {allStages.map(s => {
                    const active = stages.includes(s)
                    return (
                      <button
                        key={s}
                        onClick={() => setStages(active ? stages.filter(x => x !== s) : [...stages, s])}
                        style={{
                          padding: "7px 16px", borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: "pointer",
                          border: `1px solid ${active ? "#0073BB" : "#D5DBDB"}`,
                          background: active ? "#EBF5FB" : "#fff",
                          color: active ? "#0073BB" : "#687078",
                        }}
                      >
                        {s.replace(/_/g, " ")}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Subject */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#232F3E", marginBottom: 6 }}>
                  Subject <span style={{ color: "#D13212" }}>*</span>
                </label>
                <input value={subject} onChange={e => setSubject(e.target.value)} style={nInp} />
              </div>

              {/* Body */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#232F3E", marginBottom: 6 }}>
                  Body (HTML or plain text) <span style={{ color: "#D13212" }}>*</span>
                </label>
                <textarea
                  value={bodyHtml}
                  onChange={e => setBodyHtml(e.target.value)}
                  style={{ ...nInp, height: 260, resize: "vertical", fontFamily: "IBM Plex Mono", fontSize: 13, lineHeight: 1.6 }}
                />
              </div>

              {/* PDF attach */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#232F3E", marginBottom: 8 }}>Attach PDF (optional)</label>
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) { setPdfFile(f); setUploadedPdf("") } }}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? "#0073BB" : "#D5DBDB"}`, borderRadius: 8,
                    padding: "18px", textAlign: "center", cursor: "pointer",
                    background: dragOver ? "#EBF5FB" : "#FAFAFA", transition: "all 0.15s",
                  }}
                >
                  <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) { setPdfFile(f); setUploadedPdf("") } }} />
                  {pdfFile ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                      <Paperclip size={20} />
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#16191F" }}>{pdfFile.name}</div>
                        <div style={{ fontSize: 12, color: "#687078" }}>{(pdfFile.size / 1024).toFixed(0)} KB</div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); setPdfFile(null); setUploadedPdf("") }}
                        style={{ background: "none", border: "none", color: "#D13212", cursor: "pointer", marginLeft: 8, display: "inline-flex", alignItems: "center" }}><X size={18} /></button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'center' }}><Paperclip size={20} /></div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>Drag & drop or click to browse</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Spam check */}
              <div style={{ marginBottom: 8 }}>
                <button
                  onClick={checkSpam}
                  disabled={spamChecking}
                  style={{ background: "transparent", border: "1px solid #D5DBDB", borderRadius: 6, padding: "7px 16px", fontSize: 13, cursor: "pointer", color: "#444", fontWeight: 500 }}
                >
                  {spamChecking ? "Checking…" : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Shield size={14} /> Check spam score</span>}
                </button>
                {spam && (
                  <div style={{ marginTop: 10, border: `1px solid ${spamColor}`, borderRadius: 8, padding: "12px 16px", background: spamColor + "12" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: spamColor, marginBottom: spam.findings.length ? 8 : 0 }}>
                      {spam.level === "block" ? `Blocked - score ${spam.score} (too spammy to send)`
                        : spam.level === "warn" ? `Warning - score ${spam.score} (risky)`
                        : `Clean - score ${spam.score}`}
                    </div>
                    {spam.findings.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#555", lineHeight: 1.7 }}>
                        {spam.findings.map((f, i) => <li key={i}>{f.message}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div style={{ padding: "20px 32px", borderTop: "1px solid #E8EAED", display: "flex", gap: 12, justifyContent: "flex-end", background: "#fff", flexShrink: 0 }}>
            <button
              onClick={onClose}
              style={{ background: "none", border: "1px solid #D5DBDB", borderRadius: 6, padding: "10px 22px", fontSize: 14, cursor: "pointer", color: "#444", fontWeight: 500 }}
            >
              Cancel
            </button>
            <button
              onClick={send}
              disabled={sending || spam?.level === "block"}
              style={{
                background: sending ? "#888" : "#1D8102", color: "#fff", border: "none",
                borderRadius: 6, padding: "10px 26px", fontSize: 14, fontWeight: 700,
                cursor: "pointer", opacity: spam?.level === "block" ? 0.5 : 1,
              }}
            >
              {sending ? "Sending…" : "Send to Shortlisted"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Settings Form ─────────────────────────────────────────────────────────────

function SettingsForm({ companyId, settings, onSave, saving }: {
  companyId: string
  settings: HiringSettings | null
  onSave: (data: Partial<HiringSettings>) => void
  saving: boolean
}) {
  const [form, setForm] = useState({
    rejection_delay_hours:    settings?.rejection_delay_hours    ?? 48,
    auto_reject_threshold:    settings?.auto_reject_threshold    ?? 25,
    auto_shortlist_threshold: settings?.auto_shortlist_threshold ?? 75,
    rejection_email_template: settings?.rejection_email_template || '',
    interview_email_template: settings?.interview_email_template || '',
    offer_email_template:     settings?.offer_email_template     || '',
    welcome_email_template:   settings?.welcome_email_template   || '',
    slack_workspace_invite_url: settings?.slack_workspace_invite_url || '',
    discord_invite_url:       settings?.discord_invite_url       || '',
    google_calendar_id:       settings?.google_calendar_id       || '',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Rejection Delay (hours)</label>
          <input type="number" style={inputStyle} value={form.rejection_delay_hours} onChange={(e) => setForm({ ...form, rejection_delay_hours: Number(e.target.value) })} />
        </div>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Auto-Reject Below</label>
          <input type="number" style={inputStyle} value={form.auto_reject_threshold} onChange={(e) => setForm({ ...form, auto_reject_threshold: Number(e.target.value) })} />
        </div>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Auto-Shortlist Above</label>
          <input type="number" style={inputStyle} value={form.auto_shortlist_threshold} onChange={(e) => setForm({ ...form, auto_shortlist_threshold: Number(e.target.value) })} />
        </div>
      </div>

      {[
        { key: 'slack_workspace_invite_url', label: 'Slack Workspace Invite URL', placeholder: 'https://join.slack.com/t/...' },
        { key: 'discord_invite_url', label: 'Discord Invite URL', placeholder: 'https://discord.gg/...' },
        { key: 'google_calendar_id', label: 'Google Calendar ID', placeholder: 'calendar@group.calendar.google.com' },
      ].map(({ key, label, placeholder }) => (
        <div key={key}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>{label}</label>
          <input style={inputStyle} placeholder={placeholder} value={(form as Record<string, unknown>)[key] as string} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
        </div>
      ))}

      {[
        { key: 'rejection_email_template', label: 'Rejection Email Template' },
        { key: 'interview_email_template', label: 'Interview Email Template' },
        { key: 'offer_email_template', label: 'Offer Email Template' },
        { key: 'welcome_email_template', label: 'Welcome Email Template' },
      ].map(({ key, label }) => (
        <div key={key}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
            {label} <span style={{ fontWeight: 400, color: '#687078' }}>- use {'{{variable_name}}'}</span>
          </label>
          <textarea
            style={{ ...textareaStyle, minHeight: '100px' }}
            value={(form as Record<string, unknown>)[key] as string}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            placeholder="Leave blank to use default template"
          />
        </div>
      ))}

      <button style={btnPrimary} onClick={() => onSave(form)} disabled={saving}>
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  )
}
