'use client'
import { useState, useEffect, useRef } from 'react'
import { Paperclip, Upload } from 'lucide-react'

interface Attachment { id: string; name: string; mime_type: string | null; size_bytes: number | null }

// Multi-select checklist over the reusable email_attachments library (upload
// once - company brochure, T&Cs - reuse across many sends), with inline
// upload. Used wherever a send can carry "always attach these" extras
// alongside its main generated PDF.
export function AttachmentPicker({ selectedIds, onChange, companyId }: {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  companyId?: string | null
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => {
    fetch('/api/email-attachments', { credentials: 'include' })
      .then(r => r.json())
      .then((d: { attachments: Attachment[] }) => setAttachments(d.attachments ?? []))
  }
  useEffect(load, [])

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])
  }

  const handleUpload = async (file: File) => {
    setUploading(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', file.name)
      if (companyId) fd.append('company_id', companyId)
      const res = await fetch('/api/email-attachments', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Upload failed'); return }
      load()
      onChange([...selectedIds, data.attachment.id])
    } finally { setUploading(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {attachments.map(a => {
          const active = selectedIds.includes(a.id)
          return (
            <button
              key={a.id} type="button" onClick={() => toggle(a.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 20,
                border: active ? '1px solid var(--blue)' : '1px solid var(--border)',
                background: active ? '#E8F4FB' : '#fff', color: active ? 'var(--blue)' : 'var(--text2)',
                cursor: 'pointer', fontSize: 12,
              }}
            >
              <Paperclip size={11} /> {a.name}
            </button>
          )
        })}
        {attachments.length === 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>No attachments uploaded yet.</span>}
      </div>
      <button
        type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px dashed var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: uploading ? 'wait' : 'pointer', color: 'var(--text2)' }}
      >
        <Upload size={12} /> {uploading ? 'Uploading…' : 'Upload new attachment'}
      </button>
      <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }} />
      {error && <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{error}</p>}
    </div>
  )
}
