'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { CheckCircle2, XCircle } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface BatchCandidate {
  id: string
  batch_id: string
  applicant_id: string
  position: number
  estimated_at: string | null
  status: 'waiting' | 'current' | 'done' | 'skipped'
  interview_notes: string | null
  decision: 'accept' | 'reject' | 'hold' | null
  applicant_name: string
  applicant_email: string
  applicant_phone: string | null
  ai_score: number
  ai_summary: string | null
  resume_url: string | null
  college: string | null
  year_of_study?: number | null
  portfolio_url?: string | null
  linkedin_url?: string | null
  github_url?: string | null
  stage: string
  // mapped from JOIN
  name: string
  email: string
  phone: string | null
}

interface Batch {
  id: string
  company_id: string
  company_name: string
  role_id: string | null
  role_title: string | null
  meet_link: string
  batch_name: string | null
  slot_duration: number
  buffer_minutes: number
  scheduled_at: string
  status: 'pending' | 'active' | 'complete' | 'cancelled'
  current_index: number
  panel: { user_id: string; name: string }[]
  completed_at: string | null
  candidates: BatchCandidate[]
}

interface OfferItem {
  name: string
  email: string
  offer_url: string
  applicant_id: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function generateQuestions(candidate: BatchCandidate, roleTitle: string): string[] {
  const summary = ((candidate.ai_summary || candidate.applicant_name || '') + ' ' + roleTitle).toLowerCase()
  const questions: string[] = []

  if (summary.includes('react')) questions.push('Walk us through a React project you built - what was the hardest problem you solved?')
  if (summary.includes('python')) questions.push('Describe a Python project where you had to optimise performance or handle large data.')
  if (summary.includes('node') || summary.includes('express')) questions.push('How have you structured your Node.js backends? Talk about a design decision you made.')
  if (summary.includes('ctf') || summary.includes('capture the flag')) questions.push('Walk us through a CTF challenge you solved - what was your methodology?')
  if (summary.includes('machine learning') || summary.includes(' ml ') || summary.includes(' ai ')) questions.push('Tell us about an ML model you trained - dataset, approach, and results.')
  if (summary.includes('unity') || summary.includes('game dev') || summary.includes('unreal')) questions.push('Walk us through a game you built - what engine did you use and what were the key challenges?')
  if (summary.includes('docker') || summary.includes('kubernetes') || summary.includes('devops')) questions.push('How have you used Docker/Kubernetes in your projects? What problems did they solve?')
  if (summary.includes('intern')) questions.push('Tell us about your internship experience - what did you own end-to-end?')

  questions.push(`Why are you interested in the ${roleTitle} role specifically?`)
  questions.push('What is your biggest technical project to date, and what would you do differently now?')
  questions.push('Where do you see yourself in two years, and how does this internship fit into that path?')

  return questions.slice(0, 5)
}

// ── Decision helpers ───────────────────────────────────────────────────────────

function decisionColor(decision: string | null): string {
  if (decision === 'accept') return '#1D8102'
  if (decision === 'reject') return '#D13212'
  if (decision === 'hold')   return '#E8820C'
  return '#687078'
}

// ── Score badge ────────────────────────────────────────────────────────────────

function scoreBadgeStyle(score: number): React.CSSProperties {
  if (score >= 75) return { backgroundColor: '#EBF5E8', color: '#1D8102', border: '1px solid #1D8102' }
  if (score >= 50) return { backgroundColor: '#FEF8EE', color: '#E8820C', border: '1px solid #E8820C' }
  if (score >= 25) return { backgroundColor: '#FEF0EE', color: '#D13212', border: '1px solid #D13212' }
  return { backgroundColor: '#F2F3F3', color: '#687078', border: '1px solid #D5DBDB' }
}

// ── External link icon ─────────────────────────────────────────────────────────

function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '3px' }}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

// ── Candidate chip (batch strip) ───────────────────────────────────────────────

function CandidateChip({ candidate, isCurrent }: { candidate: BatchCandidate; isCurrent: boolean }) {
  const chipDecision = candidate.status === 'done' ? candidate.decision : null

  const borderLeft = isCurrent
    ? '2px solid #0073BB'
    : chipDecision === 'accept'
    ? '2px solid #1D8102'
    : chipDecision === 'reject'
    ? '2px solid #D13212'
    : chipDecision === 'hold'
    ? '2px solid #E8820C'
    : '2px solid transparent'

  const bg = isCurrent
    ? 'rgba(0,115,187,0.15)'
    : candidate.status === 'done'
    ? 'rgba(255,255,255,0.06)'
    : 'rgba(255,255,255,0.03)'

  const color = isCurrent
    ? '#60A5FA'
    : candidate.status === 'done'
    ? decisionColor(candidate.decision)
    : '#64748B'

  const checkmark = candidate.status === 'done' && candidate.decision === 'accept' ? <CheckCircle2 size={14} />
    : candidate.status === 'done' && candidate.decision === 'reject' ? <XCircle size={14} />
    : candidate.status === 'done' && candidate.decision === 'hold' ? '~'
    : null

  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        padding: '5px 10px', borderRadius: '6px', borderLeft,
        borderTop: '1px solid rgba(255,255,255,0.07)',
        borderRight: '1px solid rgba(255,255,255,0.07)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        backgroundColor: bg, color,
        fontSize: '0.75rem', fontFamily: 'var(--font-inter), sans-serif',
        whiteSpace: 'nowrap', flexShrink: 0,
        fontWeight: isCurrent ? 600 : 400,
      }}
    >
      <span style={{ fontFamily: 'var(--font-mono), monospace', opacity: 0.6 }}>#{candidate.position}</span>
      {candidate.name || (candidate.applicant_name || '').split(' ')[0]}
      {checkmark && <span style={{ fontSize: '0.7rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>{checkmark}</span>}
    </div>
  )
}

// ── Resume viewer (right column) ───────────────────────────────────────────────

function ResumeViewer({ candidate }: { candidate: BatchCandidate }) {
  const url = candidate.resume_url

  if (!url) {
    return (
      <div style={{ padding: '20px 0', color: '#475569', fontSize: '0.8rem', fontStyle: 'italic' }}>
        No resume on file
      </div>
    )
  }

  const isExternalLink = url.startsWith('http') && !url.toLowerCase().endsWith('.pdf') && !url.toLowerCase().endsWith('.docx')
  const isPdf = url.toLowerCase().endsWith('.pdf')
  const isDocx = url.toLowerCase().endsWith('.docx')

  if (isPdf && !url.startsWith('http')) {
    // Local path - serve through the authenticated resume endpoint
    return (
      <iframe
        src={`/api/hiring/applicants/${candidate.applicant_id}/resume/file`}
        style={{ width: '100%', height: '300px', border: 'none', borderRadius: '6px', backgroundColor: '#fff' }}
        title={`${candidate.name || candidate.applicant_name} resume`}
      />
    )
  }

  if (isPdf && url.startsWith('http')) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#60A5FA', fontSize: '0.875rem', textDecoration: 'none' }}
      >
        Open Resume (PDF)
        <ExternalLinkIcon />
      </a>
    )
  }

  if (isDocx) {
    return (
      <a
        href={url}
        download
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#60A5FA', fontSize: '0.875rem', textDecoration: 'none' }}
      >
        Download Resume (.docx)
        <ExternalLinkIcon />
      </a>
    )
  }

  if (isExternalLink) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#60A5FA', fontSize: '0.875rem', textDecoration: 'none' }}
      >
        Open Resume
        <ExternalLinkIcon />
      </a>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#60A5FA', fontSize: '0.875rem', textDecoration: 'none' }}
    >
      View Resume
      <ExternalLinkIcon />
    </a>
  )
}

// ── Completion summary ─────────────────────────────────────────────────────────

function CompletionSummary({
  batch,
  offers,
  templateMissing,
}: {
  batch: Batch
  offers: OfferItem[]
  templateMissing: boolean
}) {
  const accepted = batch.candidates.filter((c) => c.decision === 'accept')
  const rejected = batch.candidates.filter((c) => c.decision === 'reject')
  const held     = batch.candidates.filter((c) => c.decision === 'hold')

  const [sendingAll, setSendingAll] = useState(false)
  const [sentIds, setSentIds]       = useState<Set<string>>(new Set())

  async function sendAllOffers() {
    setSendingAll(true)
    for (const offer of offers) {
      try {
        await fetch(`/api/hiring/applicants/${offer.applicant_id}/send-offer`, { method: 'POST' })
        setSentIds((prev) => new Set([...prev, offer.applicant_id]))
      } catch {
        // continue
      }
    }
    setSendingAll(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '24px', padding: '40px', overflowY: 'auto' }}>
      {/* Heading */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-syne), sans-serif', fontSize: '1.75rem', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>
          Session Complete
        </div>
        <div style={{ color: '#94A3B8', fontSize: '0.875rem', marginBottom: '4px' }}>
          Review decisions and generate offer letters below.
        </div>
        <div style={{ color: '#64748B', fontSize: '0.8rem' }}>
          {batch.batch_name || batch.role_title || 'Interview Batch'} &middot; {batch.company_name}
          {batch.completed_at && (
            <span> &middot; Completed {fmtDate(batch.completed_at)}</span>
          )}
        </div>
      </div>

      {/* Decision counts */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { label: 'Accepted', count: accepted.length, color: '#1D8102', bg: 'rgba(29,129,2,0.15)' },
          { label: 'On Hold',  count: held.length,     color: '#E8820C', bg: 'rgba(232,130,12,0.15)' },
          { label: 'Rejected', count: rejected.length, color: '#D13212', bg: 'rgba(209,50,18,0.15)' },
        ].map(({ label, count, color, bg }) => (
          <div key={label} style={{ textAlign: 'center', padding: '18px 28px', borderRadius: '10px', backgroundColor: bg, border: `1px solid ${color}40` }}>
            <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: '2rem', fontWeight: 700, color }}>{count}</div>
            <div style={{ color, fontSize: '0.75rem', fontWeight: 600, marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Candidate list */}
      <div style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '8px', padding: '16px 20px', maxWidth: '480px', width: '100%', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ color: '#64748B', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
          Candidates
        </div>
        {batch.candidates.map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ color: '#E2E8F0', fontSize: '0.875rem' }}>{c.name || c.applicant_name}</span>
            {c.decision && (
              <span style={{
                color: decisionColor(c.decision),
                fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                fontFamily: 'var(--font-inter), sans-serif',
              }}>
                {c.decision}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Offer letters section */}
      {offers.length > 0 && (
        <div style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '8px', padding: '16px 20px', maxWidth: '480px', width: '100%', border: '1px solid rgba(29,129,2,0.25)' }}>
          <div style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>
            Offer Letters Generated
          </div>
          {offers.map((offer) => (
            <div key={offer.applicant_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <div style={{ color: '#E2E8F0', fontSize: '0.875rem', fontWeight: 500 }}>{offer.name}</div>
                <div style={{ color: '#64748B', fontSize: '0.75rem' }}>{offer.email}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {sentIds.has(offer.applicant_id) && (
                  <span style={{ color: '#1D8102', fontSize: '0.7rem', fontWeight: 600 }}>Sent</span>
                )}
                <a
                  href={offer.offer_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#60A5FA', fontSize: '0.8rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  View Offer
                  <ExternalLinkIcon />
                </a>
              </div>
            </div>
          ))}
          <button
            onClick={sendAllOffers}
            disabled={sendingAll}
            style={{
              marginTop: '14px', width: '100%', height: '38px', borderRadius: '6px', border: 'none',
              backgroundColor: sendingAll ? 'rgba(29,129,2,0.4)' : '#1D8102',
              color: '#fff', fontSize: '0.875rem', fontWeight: 600,
              fontFamily: 'var(--font-inter), sans-serif', cursor: sendingAll ? 'not-allowed' : 'pointer',
            }}
          >
            {sendingAll ? 'Sending...' : 'Send All Offers via Email'}
          </button>
        </div>
      )}

      {templateMissing && accepted.length > 0 && (
        <div style={{ backgroundColor: 'rgba(232,130,12,0.1)', borderRadius: '8px', padding: '14px 18px', maxWidth: '480px', width: '100%', border: '1px solid rgba(232,130,12,0.3)' }}>
          <div style={{ color: '#E8820C', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
            No offer letter template found
          </div>
          <div style={{ color: '#94A3B8', fontSize: '0.78rem', lineHeight: 1.5 }}>
            Upload and tag an offer letter template for {batch.company_name} on the Documents page, then re-open this batch to generate offers for the accepted candidates.
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function BatchInterviewPage() {
  const params  = useParams()
  const router  = useRouter()
  const qc      = useQueryClient()
  const batchId = params.id as string

  const stripRef = useRef<HTMLDivElement>(null)

  const [notes, setNotes]           = useState('')
  const [decision, setDecision]     = useState<'accept' | 'reject' | 'hold' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [completionOffers, setCompletionOffers] = useState<OfferItem[]>([])
  const [templateMissing, setTemplateMissing]   = useState(false)

  const { data, isLoading, error } = useQuery<{ batch: Batch }>({
    queryKey:        ['batch', batchId],
    queryFn:         async () => {
      const r = await fetch(`/api/hiring/batches/${batchId}`)
      if (!r.ok) throw new Error('Failed')
      return r.json()
    },
    refetchInterval: 5000,
  })

  const batch     = data?.batch
  const candidate = batch ? batch.candidates?.find((c) => c.position === batch.current_index + 1) ?? null : null
  const nextCand  = batch ? batch.candidates?.find((c) => c.position === (batch.current_index + 2)) ?? null : null

  // Reset local state when candidate changes
  useEffect(() => {
    setNotes(candidate?.interview_notes || '')
    setDecision(null)
  }, [candidate?.id])

  // Auto-scroll batch strip to current chip
  useEffect(() => {
    if (!stripRef.current || !batch) return
    const current = stripRef.current.querySelector('[data-current="true"]') as HTMLElement | null
    if (current) {
      current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }, [batch?.current_index])

  const startMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/hiring/batches/${batchId}/start`, { method: 'PATCH' })
      if (!res.ok) throw new Error('Failed to start batch')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['batch', batchId] }),
  })

  const completeMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/hiring/batches/${batchId}/complete`, { method: 'PATCH' })
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ ok: boolean; offers: OfferItem[]; template_missing?: boolean }>
    },
    onSuccess: (result) => {
      if (result.offers?.length) setCompletionOffers(result.offers)
      setTemplateMissing(!!result.template_missing)
      qc.invalidateQueries({ queryKey: ['batch', batchId] })
    },
  })

  async function handleNext() {
    if (!decision || !batch) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/hiring/batches/${batchId}/next`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // expected_index pins this request to the batch state the UI had
        // loaded when the user acted. If a double-click or a second open tab
        // already advanced the batch first, the server sees a mismatch and
        // rejects this request with 409 instead of silently deciding the
        // wrong (now-current) candidate.
        body:    JSON.stringify({ decision, notes: notes || undefined, expected_index: batch.current_index }),
      })
      if (res.status === 409) {
        await qc.invalidateQueries({ queryKey: ['batch', batchId] })
        throw new Error('This batch was already advanced by another request — refreshed to the latest state.')
      }
      if (!res.ok) throw new Error('Failed')
      const result = await res.json() as { ok: boolean; complete?: boolean; offers?: OfferItem[] }

      // If the next handler auto-completed the batch, trigger complete to generate offers
      if (result.complete) {
        completeMut.mutate()
      } else {
        await qc.invalidateQueries({ queryKey: ['batch', batchId] })
      }

      setNotes('')
      setDecision(null)
    } finally {
      setSubmitting(false)
    }
  }

  const questions = candidate ? generateQuestions(candidate, batch?.role_title || 'Intern') : []

  // ── Loading / error ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
        <div style={{ color: '#94A3B8', fontSize: '0.9rem' }}>Loading batch...</div>
      </div>
    )
  }

  if (error || !batch) {
    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
        <div style={{ color: '#D13212', fontSize: '0.9rem' }}>Batch not found or failed to load.</div>
      </div>
    )
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const batchLabel = batch.batch_name
    ? batch.batch_name
    : `${fmtDate(batch.scheduled_at)} - ${batch.company_name}`

  const doneCount   = (batch.candidates || []).filter((c) => c.status === 'done').length
  const totalCount  = (batch.candidates || []).length
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  // ── Panel heading style ──────────────────────────────────────────────────────

  const panelHeading: React.CSSProperties = {
    fontSize: '0.7rem', fontWeight: 700, color: '#64748B',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px',
  }

  // ── Decision button builder ──────────────────────────────────────────────────

  function decisionBtnStyle(d: 'accept' | 'reject' | 'hold'): React.CSSProperties {
    const baseColor = d === 'accept' ? '#1D8102' : d === 'reject' ? '#991B1B' : '#92400E'
    const isSelected = decision === d
    return {
      flex: 1, height: '38px', borderRadius: '6px',
      border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.12)',
      cursor: 'pointer',
      fontSize: '0.875rem', fontWeight: 600, fontFamily: 'var(--font-inter), sans-serif',
      backgroundColor: isSelected ? baseColor : 'rgba(255,255,255,0.05)',
      color: isSelected ? '#fff' : '#94A3B8',
      outline: isSelected ? `2px solid rgba(255,255,255,0.3)` : 'none',
      outlineOffset: '2px',
      transition: 'all 0.15s',
    }
  }

  // ── Candidate info card ──────────────────────────────────────────────────────

  const infoCard: React.CSSProperties = {
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '16px',
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Full-screen overlay */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 50,
        backgroundColor: '#0F172A',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-inter), sans-serif',
      }}>

        {/* ── Top bar ─────────────────────────────────────────────────────────── */}
        <div style={{
          height: '52px', flexShrink: 0,
          backgroundColor: '#1E293B', borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px',
        }}>
          {/* Left */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
            <button
              onClick={() => router.push('/hiring')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 0', flexShrink: 0 }}
            >
              &#8592; Back
            </button>
            <div style={{ width: '1px', height: '18px', backgroundColor: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

            {/* Company name */}
            <span style={{ color: '#94A3B8', fontSize: '0.8rem', flexShrink: 0 }}>{batch.company_name}</span>
            <div style={{ width: '1px', height: '14px', backgroundColor: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

            {/* Batch name + role */}
            <span style={{ color: '#E2E8F0', fontSize: '0.875rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {batchLabel}
            </span>
            <div style={{ width: '1px', height: '14px', backgroundColor: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />
            {batch.role_title && <span style={{ color: '#64748B', fontSize: '0.8rem', flexShrink: 0 }}>{batch.role_title}</span>}
          </div>

          {/* Right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            {/* Candidate count */}
            {batch.status === 'active' && (
              <span style={{ color: '#94A3B8', fontSize: '0.8rem', fontFamily: 'var(--font-mono), monospace' }}>
                {doneCount} of {totalCount} done
              </span>
            )}

            {/* Status badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '4px 10px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 600,
              backgroundColor: batch.status === 'active' ? 'rgba(29,129,2,0.15)' : batch.status === 'complete' ? 'rgba(0,115,187,0.15)' : 'rgba(232,130,12,0.15)',
              color: batch.status === 'active' ? '#4ADE80' : batch.status === 'complete' ? '#60A5FA' : '#E8820C',
            }}>
              {batch.status === 'active' && (
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#4ADE80', display: 'inline-block' }} />
              )}
              {batch.status === 'active' ? 'Active' : batch.status === 'complete' ? 'Complete' : batch.status === 'pending' ? 'Pending' : 'Cancelled'}
            </div>

            {/* Meet link */}
            {batch.meet_link && batch.status !== 'complete' && (
              <a
                href={batch.meet_link}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  padding: '5px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)',
                  color: '#E2E8F0', fontSize: '0.8rem', textDecoration: 'none', backgroundColor: 'rgba(255,255,255,0.06)',
                }}
              >
                Join Meet
                <ExternalLinkIcon />
              </a>
            )}

            {/* Force complete */}
            {batch.status === 'active' && (
              <button
                onClick={() => { if (confirm('Force complete this batch?')) completeMut.mutate() }}
                style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', cursor: 'pointer', color: '#64748B', fontSize: '0.75rem', padding: '4px 10px' }}
              >
                Force Complete
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {batch.status === 'active' && (
          <div style={{ height: '3px', backgroundColor: 'rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <div style={{ height: '100%', backgroundColor: '#0073BB', width: `${progressPct}%`, transition: 'width 0.4s ease' }} />
          </div>
        )}

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>

          {/* ── Pending state ────────────────────────────────────────────────── */}
          {batch.status === 'pending' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '40px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-syne), sans-serif', fontSize: '1.4rem', fontWeight: 700, color: '#E2E8F0', marginBottom: '8px' }}>
                  Ready to start
                </div>
                <div style={{ color: '#94A3B8', fontSize: '0.875rem', marginBottom: '4px' }}>
                  {totalCount} candidate{totalCount !== 1 ? 's' : ''} &middot; {batch.slot_duration} min slots &middot; {batch.buffer_minutes} min buffer
                </div>
                <div style={{ color: '#64748B', fontSize: '0.8rem' }}>
                  Scheduled {fmtDate(batch.scheduled_at)} at {fmtTime(batch.scheduled_at)}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center', maxWidth: '480px' }}>
                {(batch.candidates || []).map((c) => (
                  <div key={c.id} style={{ color: '#94A3B8', fontSize: '0.8rem', padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.04)' }}>
                    #{c.position} {c.name || c.applicant_name}
                  </div>
                ))}
              </div>
              {batch.meet_link && (
                <a
                  href={batch.meet_link}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#60A5FA', fontSize: '0.875rem', display: 'inline-flex', alignItems: 'center', gap: '5px', textDecoration: 'none' }}
                >
                  Open Google Meet
                  <ExternalLinkIcon />
                </a>
              )}
              <button
                onClick={() => startMut.mutate()}
                disabled={startMut.isPending}
                style={{ backgroundColor: '#0073BB', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px 32px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-inter), sans-serif' }}
              >
                {startMut.isPending ? 'Starting...' : 'Start Batch - Send First Invite'}
              </button>
            </div>
          )}

          {/* ── Complete state ─────────────────────────────────────────────────── */}
          {batch.status === 'complete' && (
            <CompletionSummary batch={batch} offers={completionOffers} templateMissing={templateMissing} />
          )}

          {/* ── Active state ───────────────────────────────────────────────────── */}
          {batch.status === 'active' && (
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

              {/* LEFT column ~60% */}
              <div style={{
                width: '60%', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', flexDirection: 'column', overflow: 'auto',
                padding: '20px',
              }}>
                {candidate ? (
                  <>
                    {/* Candidate info card */}
                    <div style={infoCard}>
                      {/* Name + score */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                        <span style={{ ...scoreBadgeStyle(candidate.ai_score), fontFamily: 'var(--font-mono), monospace', fontWeight: 700, fontSize: '0.875rem', padding: '3px 8px', borderRadius: '6px' }}>
                          {candidate.ai_score}
                        </span>
                        <span style={{ fontFamily: 'var(--font-syne), sans-serif', fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>
                          {candidate.name || candidate.applicant_name}
                        </span>
                      </div>

                      {/* Role applied for */}
                      {batch.role_title && (
                        <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginBottom: '6px' }}>
                          {batch.role_title}
                        </div>
                      )}

                      {/* College + year */}
                      {(candidate.college) && (
                        <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginBottom: '6px' }}>
                          {candidate.college}
                          {candidate.year_of_study ? ` · Year ${candidate.year_of_study}` : ''}
                        </div>
                      )}

                      {/* Links row */}
                      {(candidate.portfolio_url || candidate.linkedin_url || candidate.github_url) && (
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
                          {candidate.portfolio_url && (
                            <a href={candidate.portfolio_url} target="_blank" rel="noreferrer" style={{ color: '#60A5FA', fontSize: '0.8rem', textDecoration: 'none' }}>
                              Portfolio<ExternalLinkIcon />
                            </a>
                          )}
                          {candidate.linkedin_url && (
                            <a href={candidate.linkedin_url} target="_blank" rel="noreferrer" style={{ color: '#60A5FA', fontSize: '0.8rem', textDecoration: 'none' }}>
                              LinkedIn<ExternalLinkIcon />
                            </a>
                          )}
                          {candidate.github_url && (
                            <a href={candidate.github_url} target="_blank" rel="noreferrer" style={{ color: '#60A5FA', fontSize: '0.8rem', textDecoration: 'none' }}>
                              GitHub<ExternalLinkIcon />
                            </a>
                          )}
                        </div>
                      )}

                      {/* AI summary */}
                      {candidate.ai_summary && (
                        <p style={{ margin: 0, color: '#CBD5E1', fontSize: '0.875rem', lineHeight: 1.6, fontStyle: 'italic' }}>
                          {candidate.ai_summary.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ')}
                        </p>
                      )}
                    </div>

                    {/* Notes */}
                    <div style={{ marginBottom: '16px' }}>
                      <label style={panelHeading}>Interview notes</label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Type your interview notes here... (saved on confirm)"
                        style={{
                          width: '100%', minHeight: '120px', padding: '10px',
                          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
                          borderRadius: '6px', color: '#E2E8F0', fontSize: '0.875rem',
                          fontFamily: 'var(--font-inter), sans-serif', resize: 'vertical',
                          outline: 'none', lineHeight: 1.6, boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    {/* Decision buttons */}
                    <div style={{ marginBottom: '14px' }}>
                      <div style={panelHeading}>Decision</div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setDecision('accept')} style={decisionBtnStyle('accept')}>Accept</button>
                        <button onClick={() => setDecision('hold')}   style={decisionBtnStyle('hold')}>Hold</button>
                        <button onClick={() => setDecision('reject')} style={decisionBtnStyle('reject')}>Reject</button>
                      </div>
                    </div>

                    {/* Next candidate preview */}
                    {nextCand ? (
                      <div style={{ marginBottom: '12px', fontSize: '0.8rem' }}>
                        <span style={{ color: '#64748B' }}>Up next: </span>
                        <span style={{ color: '#CBD5E1', fontWeight: 500 }}>{nextCand.name || nextCand.applicant_name}</span>
                        {nextCand.ai_score > 0 && (
                          <span style={{ color: '#64748B', fontFamily: 'var(--font-mono), monospace', marginLeft: '6px' }}>
                            score {nextCand.ai_score}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div style={{ marginBottom: '12px', padding: '8px 12px', backgroundColor: 'rgba(232,130,12,0.08)', borderRadius: '6px', fontSize: '0.8rem', color: '#E8820C', border: '1px solid rgba(232,130,12,0.2)' }}>
                        This is the last candidate.
                      </div>
                    )}

                    {/* Confirm & Next button */}
                    <button
                      onClick={handleNext}
                      disabled={!decision || submitting}
                      style={{
                        width: '100%', height: '40px', borderRadius: '6px', border: 'none',
                        backgroundColor: decision ? '#0073BB' : 'rgba(255,255,255,0.06)',
                        color: decision ? '#fff' : '#475569',
                        fontSize: '0.9rem', fontWeight: 600, cursor: decision ? 'pointer' : 'not-allowed',
                        fontFamily: 'var(--font-inter), sans-serif',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                        transition: 'all 0.15s',
                      }}
                    >
                      {submitting ? (
                        <>
                          <span style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                          Saving...
                        </>
                      ) : nextCand ? (
                        'Confirm & Next'
                      ) : (
                        'Confirm & Complete Batch'
                      )}
                    </button>

                    {!decision && (
                      <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.72rem', marginTop: '6px' }}>
                        Select a decision above to continue
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#475569', fontSize: '0.875rem' }}>
                    No active candidate
                  </div>
                )}
              </div>

              {/* RIGHT column ~40% */}
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto',
                padding: '20px',
              }}>
                {candidate ? (
                  <>
                    {/* Resume */}
                    <div style={{ marginBottom: '20px' }}>
                      <div style={panelHeading}>Resume</div>
                      <ResumeViewer candidate={candidate} />
                    </div>

                    {/* Suggested questions */}
                    <div>
                      <div style={{ ...panelHeading, marginBottom: '10px' }}>Talking Points</div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {questions.map((q, i) => (
                          <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <span style={{ color: '#475569', fontSize: '0.7rem', marginTop: '3px', fontFamily: 'var(--font-mono), monospace', flexShrink: 0, width: '20px' }}>
                              {i + 1}.
                            </span>
                            <span style={{ color: '#CBD5E1', fontSize: '0.875rem', lineHeight: 1.6 }}>{q}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#475569', fontSize: '0.875rem' }}>
                    No active candidate
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Bottom batch strip ──────────────────────────────────────────────── */}
        {batch.status !== 'pending' && (
          <div
            ref={stripRef}
            style={{
              height: '48px', flexShrink: 0,
              backgroundColor: '#1E293B', borderTop: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '0 14px', overflowX: 'auto',
            }}
          >
            {(batch.candidates || []).map((c) => {
              const isCurrent = batch.status === 'active' && c.position === batch.current_index + 1
              return (
                <div key={c.id} data-current={isCurrent ? 'true' : undefined}>
                  <CandidateChip candidate={c} isCurrent={isCurrent} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
