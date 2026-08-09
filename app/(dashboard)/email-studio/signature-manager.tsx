'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import TiptapImage from '@tiptap/extension-image'
import { PenLine, ChevronDown, Plus, Pencil, Trash2, Star, X, Bold, Italic, Underline as UnderlineIcon, Image as ImageIcon } from 'lucide-react'
import { FontPicker } from '../templates/font-picker'
import DOMPurify from 'isomorphic-dompurify'

export interface Signature { id: string; company_id: string | null; name: string; html: string; is_default: boolean }

const PICKER_THEME = {
  documentBg: '#161B22', panelBorder: '#30363D', textPrimary: '#E6EDF3',
  textSecondary: '#8B949E', textMuted: '#6E7681', inputBg: '#0D1117',
  inputBorder: '#30363D', inputColor: '#E6EDF3', btnActiveBg: '#1A3044',
  btnActiveColor: '#58A6FF', imgBtnBg: '#21262D',
}

// ── Dropdown: "Insert Signature ▾" ────────────────────────────────────────────

export function SignaturePicker({ onInsert, companyId }: { onInsert: (html: string) => void; companyId: string | null }) {
  const [open, setOpen] = useState(false)
  const [managing, setManaging] = useState(false)
  const [signatures, setSignatures] = useState<Signature[]>([])
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const load = () => {
    fetch('/api/email-signatures', { credentials: 'include' })
      .then(r => r.json())
      .then((d: { signatures: Signature[] }) => setSignatures(d.signatures ?? []))
  }
  useEffect(() => { if (open) load() }, [open])

  useEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 4, left: r.left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const tbBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 8px',
    borderRadius: 4, border: 'none', cursor: 'pointer', background: 'transparent', color: '#C9D1D9', fontSize: 12,
  }

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)} title="Insert signature" style={tbBtn}>
        <PenLine size={14} /> Signature <ChevronDown size={11} />
      </button>

      {open && menuPos && createPortal(
        <div ref={menuRef} style={{
          position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 1000,
          width: 260, maxHeight: 320, display: 'flex', flexDirection: 'column',
          background: '#161B22', border: '1px solid #30363D', borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,0.4)', overflow: 'hidden',
        }}>
          <div style={{ overflowY: 'auto', padding: 6, flex: 1 }}>
            {signatures.length === 0 && (
              <div style={{ padding: '16px 10px', textAlign: 'center', fontSize: 12, color: '#6E7681' }}>No signatures yet.</div>
            )}
            {signatures.map(s => (
              <button
                key={s.id} type="button"
                onClick={() => { onInsert(s.html); setOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', background: 'transparent', color: '#E6EDF3', fontSize: 13 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1A3044')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {s.name}
                {s.is_default && <Star size={12} color="#FCD34D" fill="#FCD34D" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { setManaging(true); setOpen(false) }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', border: 'none', borderTop: '1px solid #30363D', background: '#1C2128', cursor: 'pointer', color: '#58A6FF', fontSize: 12, fontWeight: 600 }}
          >
            <Pencil size={12} /> Manage signatures
          </button>
        </div>,
        document.body
      )}

      {managing && <SignatureManagerModal companyId={companyId} onClose={() => { setManaging(false); load() }} />}
    </>
  )
}

// ── Full manager modal (list + create/edit with a mini rich-text editor) ─────

function SignatureManagerModal({ companyId, onClose }: { companyId: string | null; onClose: () => void }) {
  const [signatures, setSignatures] = useState<Signature[]>([])
  const [editing, setEditing] = useState<Signature | 'new' | null>(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    fetch('/api/email-signatures', { credentials: 'include' })
      .then(r => r.json())
      .then((d: { signatures: Signature[] }) => setSignatures(d.signatures ?? []))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this signature?')) return
    await fetch(`/api/email-signatures/${id}`, { method: 'DELETE', credentials: 'include' })
    load()
  }

  if (editing) {
    return (
      <SignatureEditForm
        signature={editing === 'new' ? null : editing}
        companyId={companyId}
        onDone={() => { setEditing(null); load() }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: 480, maxHeight: '70vh', background: '#161B22', border: '1px solid #30363D', borderRadius: 10, display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #30363D' }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#fff', fontFamily: 'Syne, sans-serif' }}>Signatures</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8B949E', display: 'flex' }}><X size={16} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: 12, flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#6E7681', fontSize: 13 }}>Loading…</div>
          ) : signatures.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#6E7681', fontSize: 13 }}>No signatures yet - create one below.</div>
          ) : (
            signatures.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', borderRadius: 6, border: '1px solid #30363D', marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#E6EDF3' }}>{s.name}</span>
                    {s.is_default && <Star size={12} color="#FCD34D" fill="#FCD34D" />}
                  </div>
                  <div
                    style={{ fontSize: 11, color: '#8B949E', marginTop: 4, maxHeight: 40, overflow: 'hidden' }}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(s.html) }}
                  />
                </div>
                <button type="button" onClick={() => setEditing(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8B949E', display: 'flex', padding: 4 }}><Pencil size={13} /></button>
                <button type="button" onClick={() => handleDelete(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8B949E', display: 'flex', padding: 4 }}><Trash2 size={13} /></button>
              </div>
            ))
          )}
        </div>
        <div style={{ padding: 12, borderTop: '1px solid #30363D' }}>
          <button
            type="button" onClick={() => setEditing('new')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', background: 'transparent', border: '1px dashed #0073BB', borderRadius: 6, padding: 9, cursor: 'pointer', color: '#58A6FF', fontSize: 13, fontWeight: 600 }}
          >
            <Plus size={14} /> New Signature
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Create/edit form with its own mini Tiptap editor ──────────────────────────

function SignatureEditForm({ signature, companyId, onDone, onCancel }: {
  signature: Signature | null; companyId: string | null; onDone: () => void; onCancel: () => void
}) {
  const [name, setName] = useState(signature?.name ?? '')
  const [isDefault, setIsDefault] = useState(signature?.is_default ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const editor = useEditor({
    extensions: [StarterKit, Underline, TextStyle, FontFamily.configure({ types: ['textStyle'] }), TiptapImage],
    content: signature?.html || '<p></p>',
    editorProps: { attributes: { style: 'min-height:100px;outline:none;' } },
  })

  const handleImageInsert = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/templates/upload-image', { method: 'POST', credentials: 'include', body: fd })
    const data = await res.json()
    if (res.ok) editor?.chain().focus().setImage({ src: data.url }).run()
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    try {
      const body = { name: name.trim(), html: editor?.getHTML() ?? '', company_id: companyId, is_default: isDefault }
      const url    = signature ? `/api/email-signatures/${signature.id}` : '/api/email-signatures'
      const method = signature ? 'PATCH' : 'POST'
      const res  = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed'); return }
      onDone()
    } finally { setSaving(false) }
  }

  const tbBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 26, borderRadius: 4, border: 'none', cursor: 'pointer', background: 'transparent', color: '#C9D1D9' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ width: 480, background: '#161B22', border: '1px solid #30363D', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #30363D' }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#fff', fontFamily: 'Syne, sans-serif' }}>{signature ? 'Edit Signature' : 'New Signature'}</span>
          <button type="button" onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8B949E', display: 'flex' }}><X size={16} /></button>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Formal sign-off"
            style={{ border: '1px solid #30363D', borderRadius: 5, padding: '7px 10px', fontSize: 13, color: '#E6EDF3', background: '#0D1117' }}
          />
          <div style={{ border: '1px solid #30363D', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 6px', borderBottom: '1px solid #30363D', background: '#1C2128', flexWrap: 'wrap' }}>
              <button type="button" onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleBold().run() }} style={{ ...tbBtn, background: editor?.isActive('bold') ? '#1A3044' : 'transparent' }}><Bold size={13} /></button>
              <button type="button" onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleItalic().run() }} style={{ ...tbBtn, background: editor?.isActive('italic') ? '#1A3044' : 'transparent' }}><Italic size={13} /></button>
              <button type="button" onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleUnderline().run() }} style={{ ...tbBtn, background: editor?.isActive('underline') ? '#1A3044' : 'transparent' }}><UnderlineIcon size={13} /></button>
              <div style={{ width: 1, height: 18, background: '#30363D', margin: '0 3px' }} />
              {editor && (
                <FontPicker
                  value={(editor.getAttributes('textStyle').fontFamily as string | undefined) ?? null}
                  onChange={family => {
                    if (family) editor.chain().focus().setFontFamily(family).run()
                    else editor.chain().focus().unsetFontFamily().run()
                  }}
                  t={PICKER_THEME}
                />
              )}
              <div style={{ width: 1, height: 18, background: '#30363D', margin: '0 3px' }} />
              <button type="button" onClick={() => document.getElementById('sig-img-input')?.click()} style={tbBtn}><ImageIcon size={13} /></button>
              <input id="sig-img-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImageInsert(f); e.target.value = '' }} />
            </div>
            <div style={{ padding: '10px 12px', background: '#0D1117' }}>
              <style>{`
                .sig-editor .ProseMirror p { margin: 0 0 6px; font-size: 13px; line-height: 1.6; color: #E6EDF3; }
                .sig-editor .ProseMirror img { max-width: 100%; height: auto; }
              `}</style>
              <div className="sig-editor">
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
            <span style={{ fontSize: 12, color: '#C9D1D9' }}>Set as default for this company</span>
          </label>
          {error && <span style={{ fontSize: 12, color: '#FCA5A5' }}>{error}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderTop: '1px solid #30363D' }}>
          <button type="button" onClick={onCancel} style={{ flex: 1, background: 'transparent', border: '1px solid #30363D', borderRadius: 6, padding: 9, cursor: 'pointer', color: '#C9D1D9', fontSize: 13 }}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving} style={{ flex: 1, background: '#0073BB', border: 'none', borderRadius: 6, padding: 9, cursor: 'pointer', color: '#fff', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Save Signature'}
          </button>
        </div>
      </div>
    </div>
  )
}
