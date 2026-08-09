'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle, Plus, Trash2, Upload } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string }

interface SiteSettings {
  company_id: string | null
  company_name: string
  logo_url: string | null
  invoice_prefix: string
  tagline: string | null
  favicon_url: string | null
  phone: string | null
  email: string | null
  address_street: string | null
  address_city: string | null
  address_state: string | null
  address_postal: string | null
  address_country: string | null
  hours: Record<string, string>
  social_links: { platform: string; url: string }[]
}

interface TeamMember {
  id: string
  name: string
  title: string | null
  photo_url: string | null
  bio: string | null
  email: string | null
  display_order: number
}

interface NapCheck {
  complete: boolean
  issues: { field: string; message: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: 'var(--font-ibm-plex-mono), monospace' }

const inputSt: React.CSSProperties = {
  width: '100%', border: '1px solid #D5DBDB', borderRadius: 6, padding: '7px 10px',
  fontSize: 13, color: '#16191F', background: '#fff', boxSizing: 'border-box', outline: 'none',
}
const labelSt: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#687078',
  marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase',
}

const btnPrimary: React.CSSProperties = {
  background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6,
  height: 34, padding: '0 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  background: 'transparent', color: '#0073BB', border: '1px solid #D5DBDB', borderRadius: 6,
  height: 30, padding: '0 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABELS: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WebsitePage() {
  const qc = useQueryClient()
  const [companyId, setCompanyId] = useState('')
  const [form, setForm] = useState<Partial<SiteSettings>>({})
  const [saving, setSaving] = useState(false)
  const [showJsonLd, setShowJsonLd] = useState(false)
  const [newMember, setNewMember] = useState({ name: '', title: '' })
  const faviconInputRef = useRef<HTMLInputElement>(null)

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies-list'],
    queryFn: async () => { const res = await fetch('/api/companies', { credentials: 'include' }); return res.json() },
  })
  const companies = companiesData?.companies ?? []
  useEffect(() => { if (!companyId && companies.length > 0) setCompanyId(companies[0].id) }, [companies, companyId])

  const { data: settingsData } = useQuery<{ settings: SiteSettings }>({
    queryKey: ['site-settings', companyId],
    queryFn: async () => { const res = await fetch(`/api/site-settings/${companyId}`, { credentials: 'include' }); return res.json() },
    enabled: !!companyId,
  })

  useEffect(() => {
    if (settingsData?.settings) {
      setForm({
        ...settingsData.settings,
        hours: settingsData.settings.hours ?? {},
        social_links: settingsData.settings.social_links ?? [],
      })
    }
  }, [settingsData])

  const { data: teamData } = useQuery<{ team: TeamMember[] }>({
    queryKey: ['site-team', companyId],
    queryFn: async () => { const res = await fetch(`/api/site-settings/${companyId}/team`, { credentials: 'include' }); return res.json() },
    enabled: !!companyId,
  })
  const team = teamData?.team ?? []

  const { data: napData } = useQuery<NapCheck>({
    queryKey: ['nap-check', companyId],
    queryFn: async () => { const res = await fetch(`/api/site-settings/${companyId}/nap-check`, { credentials: 'include' }); return res.json() },
    enabled: !!companyId,
  })

  const { data: jsonLdData } = useQuery<{ jsonLd: Record<string, unknown> }>({
    queryKey: ['site-jsonld', companyId],
    queryFn: async () => { const res = await fetch(`/api/site-settings/${companyId}/jsonld`, { credentials: 'include' }); return res.json() },
    enabled: !!companyId && showJsonLd,
  })

  async function save() {
    setSaving(true)
    await fetch(`/api/site-settings/${companyId}`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    setSaving(false)
    qc.invalidateQueries({ queryKey: ['site-settings', companyId] })
    qc.invalidateQueries({ queryKey: ['nap-check', companyId] })
    qc.invalidateQueries({ queryKey: ['site-jsonld', companyId] })
  }

  async function uploadFavicon(file: File) {
    const fd = new FormData()
    fd.append('file', file)
    await fetch(`/api/site-settings/${companyId}/favicon`, { method: 'POST', credentials: 'include', body: fd })
    qc.invalidateQueries({ queryKey: ['site-settings', companyId] })
  }

  function setHour(day: string, value: string) {
    setForm(p => ({ ...p, hours: { ...(p.hours ?? {}), [day]: value } }))
  }

  function addSocialLink() {
    setForm(p => ({ ...p, social_links: [...(p.social_links ?? []), { platform: '', url: '' }] }))
  }
  function updateSocialLink(i: number, patch: Partial<{ platform: string; url: string }>) {
    setForm(p => ({ ...p, social_links: (p.social_links ?? []).map((l, idx) => idx === i ? { ...l, ...patch } : l) }))
  }
  function removeSocialLink(i: number) {
    setForm(p => ({ ...p, social_links: (p.social_links ?? []).filter((_, idx) => idx !== i) }))
  }

  async function addTeamMember() {
    if (!newMember.name.trim()) return
    await fetch(`/api/site-settings/${companyId}/team`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newMember.name.trim(), title: newMember.title.trim() || null, display_order: team.length }),
    })
    setNewMember({ name: '', title: '' })
    qc.invalidateQueries({ queryKey: ['site-team', companyId] })
  }

  async function removeTeamMember(id: string) {
    await fetch(`/api/site-settings/team/${id}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['site-team', companyId] })
  }

  async function uploadTeamPhoto(id: string, file: File) {
    const fd = new FormData()
    fd.append('file', file)
    await fetch(`/api/site-settings/team/${id}/photo`, { method: 'POST', credentials: 'include', body: fd })
    qc.invalidateQueries({ queryKey: ['site-team', companyId] })
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700, fontSize: 22, color: '#16191F', margin: '0 0 4px' }}>Website</h1>
          <p style={{ fontSize: 13, color: '#687078', margin: 0 }}>Business info, team, and contact details that feed your site&apos;s structured data</p>
        </div>
        <select style={{ ...inputSt, width: 200, height: 34 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {napData && !napData.complete && (
        <div style={{ background: '#FFF3E0', border: '1px solid #F5D9A8', borderRadius: 6, padding: '10px 14px', marginBottom: 20, fontSize: 12.5, color: '#E8820C' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 4 }}>
            <AlertTriangle size={14} /> Business info incomplete
          </div>
          {napData.issues.map((i, idx) => <div key={idx}>- {i.message}</div>)}
        </div>
      )}
      {napData && napData.complete && (
        <div style={{ background: '#E6F4EA', border: '1px solid #C8E6CE', borderRadius: 6, padding: '10px 14px', marginBottom: 20, fontSize: 12.5, color: '#1D8102', display: 'flex', alignItems: 'center', gap: 6 }}>
          <CheckCircle2 size={14} /> Business info complete - keep this exactly matching your Google Business Profile for local SEO
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 20 }}>
            <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 14px' }}>Business Info</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelSt}>Tagline</label>
                <input style={inputSt} value={form.tagline ?? ''} onChange={e => setForm(p => ({ ...p, tagline: e.target.value }))} />
              </div>
              <div>
                <label style={labelSt}>Favicon</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {form.favicon_url && <img src={form.favicon_url} alt="favicon" style={{ width: 24, height: 24, borderRadius: 4 }} />}
                  <button onClick={() => faviconInputRef.current?.click()} style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Upload size={12} /> Upload</button>
                  <input ref={faviconInputRef} type="file" accept="image/png,image/x-icon,image/svg+xml,image/webp" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadFavicon(f); e.target.value = '' }} />
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelSt}>Phone</label>
                <input style={inputSt} value={form.phone ?? ''} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div>
                <label style={labelSt}>Email</label>
                <input style={inputSt} value={form.email ?? ''} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
              </div>
            </div>
            <label style={labelSt}>Address</label>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8 }}>
              <input style={inputSt} placeholder="Street" value={form.address_street ?? ''} onChange={e => setForm(p => ({ ...p, address_street: e.target.value }))} />
              <input style={inputSt} placeholder="City" value={form.address_city ?? ''} onChange={e => setForm(p => ({ ...p, address_city: e.target.value }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <input style={inputSt} placeholder="State" value={form.address_state ?? ''} onChange={e => setForm(p => ({ ...p, address_state: e.target.value }))} />
              <input style={inputSt} placeholder="Postal Code" value={form.address_postal ?? ''} onChange={e => setForm(p => ({ ...p, address_postal: e.target.value }))} />
              <input style={inputSt} placeholder="Country" value={form.address_country ?? ''} onChange={e => setForm(p => ({ ...p, address_country: e.target.value }))} />
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 20 }}>
            <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 14px' }}>Hours</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
              {DAYS.map(d => (
                <div key={d}>
                  <label style={{ ...labelSt, textAlign: 'center' }}>{DAY_LABELS[d]}</label>
                  <input style={{ ...inputSt, fontSize: 11, padding: '5px 6px', textAlign: 'center' }} placeholder="closed"
                    value={(form.hours ?? {})[d] ?? ''} onChange={e => setHour(d, e.target.value)} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: 0 }}>Social Links</p>
              <button onClick={addSocialLink} style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={12} /> Add</button>
            </div>
            {(form.social_links ?? []).map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input style={{ ...inputSt, width: 120 }} placeholder="linkedin" value={l.platform} onChange={e => updateSocialLink(i, { platform: e.target.value })} />
                <input style={inputSt} placeholder="https://..." value={l.url} onChange={e => updateSocialLink(i, { url: e.target.value })} />
                <button onClick={() => removeSocialLink(i)} style={{ background: 'none', border: 'none', color: '#D13212', cursor: 'pointer', flexShrink: 0 }}><Trash2 size={14} /></button>
              </div>
            ))}
            {(form.social_links ?? []).length === 0 && <p style={{ fontSize: 12, color: '#AAB5BB' }}>No social links added yet</p>}
          </div>

          <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 20 }}>
            <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 14px' }}>Team</p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input style={inputSt} placeholder="Name" value={newMember.name} onChange={e => setNewMember(p => ({ ...p, name: e.target.value }))} />
              <input style={inputSt} placeholder="Title" value={newMember.title} onChange={e => setNewMember(p => ({ ...p, title: e.target.value }))} />
              <button onClick={addTeamMember} style={{ ...btnPrimary, height: 32, fontSize: 12, whiteSpace: 'nowrap' }}>Add</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
              {team.map(m => (
                <div key={m.id} style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 10, textAlign: 'center', position: 'relative' }}>
                  <button onClick={() => removeTeamMember(m.id)} style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', color: '#D13212', cursor: 'pointer' }}><Trash2 size={12} /></button>
                  <label style={{ cursor: 'pointer' }}>
                    {m.photo_url
                      ? <img src={m.photo_url} alt={m.name} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 6px' }} />
                      : <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#F2F3F3', margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#AAB5BB', fontSize: 18, fontWeight: 700 }}>{m.name[0]}</div>}
                    <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadTeamPhoto(m.id, f); e.target.value = '' }} />
                  </label>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{m.name}</div>
                  {m.title && <div style={{ fontSize: 10.5, color: '#687078' }}>{m.title}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 20, position: 'sticky', top: 24 }}>
            <button onClick={save} disabled={saving || !companyId} style={{ ...btnPrimary, width: '100%', marginBottom: 12 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button onClick={() => setShowJsonLd(v => !v)} style={{ ...btnGhost, width: '100%' }}>
              {showJsonLd ? 'Hide' : 'Preview'} LocalBusiness JSON-LD
            </button>
            {showJsonLd && jsonLdData && (
              <pre style={{ ...mono, fontSize: 10.5, background: '#F2F3F3', borderRadius: 6, padding: 10, marginTop: 10, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(jsonLdData.jsonLd, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
