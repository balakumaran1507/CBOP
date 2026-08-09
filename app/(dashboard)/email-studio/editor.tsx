'use client'

import { useEditor, EditorContent, Node as TiptapNode, mergeAttributes, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import TextAlign from '@tiptap/extension-text-align'
import TiptapImage from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft, Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Heading1, Heading2, Heading3,
  Image as ImageIcon, Code2, Type, Send, Upload, X, Plus, Settings2,
  Tag, ChevronDown, Pencil,
} from 'lucide-react'
import { FontPicker } from '../templates/font-picker'
import { loadGoogleFont } from '../templates/fonts'
import { SignaturePicker } from './signature-manager'
import type { EmailDesign } from './page'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'

// ── Markdown-paste fallback ────────────────────────────────────────────────────
// Pasting from Claude/ChatGPT (and similar chat UIs) frequently puts markdown-
// formatted *plain text* on the clipboard rather than real HTML - their custom
// renderers don't always populate text/html the way a normal web page selection
// does. Tiptap's default paste handling only converts real HTML tags/styles into
// marks; markdown syntax characters (**bold**, # Heading, - list) just land as
// literal text with nothing to convert. This detects that case and converts the
// common markdown constructs into actual formatting before insertion.

function looksLikeMarkdown(text: string): boolean {
  return /(\*\*[^*\n]+\*\*|__[^_\n]+__|^#{1,3}\s|^[-*]\s|^\d+\.\s|`[^`\n]+`|\[[^\]]+\]\([^)]+\))/m.test(text)
}

function markdownInlineToHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/(?<![a-zA-Z0-9])_([^_\n]+)_(?![a-zA-Z0-9])/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}

function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const heading = line.match(/^(#{1,3})\s+(.*)/)
    if (heading) {
      out.push(`<h${heading[1].length}>${markdownInlineToHtml(heading[2])}</h${heading[1].length}>`)
      i++
    } else if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${markdownInlineToHtml(lines[i].replace(/^[-*]\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
    } else if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${markdownInlineToHtml(lines[i].replace(/^\d+\.\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ol>${items.join('')}</ol>`)
    } else if (line.trim() === '') {
      i++
    } else {
      const para = [line]
      i++
      while (i < lines.length && lines[i].trim() !== '' && !/^#{1,3}\s/.test(lines[i]) && !/^[-*]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i])) {
        para.push(lines[i]); i++
      }
      out.push(`<p>${markdownInlineToHtml(para.join(' '))}</p>`)
    }
  }
  return out.join('')
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ContentMode = 'richtext' | 'html'
type Category = 'campaign' | 'hiring' | 'transactional' | 'document' | 'internal' | 'onboarding'
interface Company { id: string; name: string }

export interface EmailStudioEditorProps {
  design: EmailDesign | null
  companies: Company[]
  onClose: () => void
  onSaved: (savedId?: string) => void
}

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'transactional', label: 'Transactional' },
  { value: 'campaign',      label: 'Campaign' },
  { value: 'hiring',        label: 'Hiring' },
  { value: 'document',      label: 'Document' },
  { value: 'internal',      label: 'Internal' },
  { value: 'onboarding',    label: 'Onboarding' },
]

const VARIABLE_SUGGESTIONS = [
  'name', 'client_name', 'company_name', 'amount', 'date', 'role_title',
  'applicant_name', 'interview_date', 'start_date', 'due_date',
]

// ── VariableChip extension (Tiptap "insert {{var}}" node - same convention as Document Studio) ──

function VariableChipView({ node }: { node: { attrs: { variable: string } } }) {
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <span
        contentEditable={false}
        style={{
          display: 'inline-flex', alignItems: 'center', background: '#FEF3C7', color: '#92400E',
          borderRadius: 4, padding: '1px 6px', fontSize: '0.85em', fontWeight: 500,
          fontFamily: 'IBM Plex Mono, monospace', userSelect: 'none', border: '1px solid #FDE68A', lineHeight: 1.4,
        }}
      >
        {'{{' + node.attrs.variable + '}}'}
      </span>
    </NodeViewWrapper>
  )
}

const VariableChip = TiptapNode.create({
  name: 'variable', group: 'inline', inline: true, atom: true,
  addAttributes() { return { variable: { default: '' } } },
  parseHTML() { return [{ tag: 'span[data-type="variable"]', getAttrs: el => ({ variable: (el as HTMLElement).getAttribute('data-variable') }) }] },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'variable', 'data-variable': HTMLAttributes.variable }), `{{${HTMLAttributes.variable}}}`]
  },
  addNodeView() { return ReactNodeViewRenderer(VariableChipView as any) },
})

// ── Toolbar bits ────────────────────────────────────────────────────────────────

function TB({ onClick, active, title, children }: { onClick: () => void; active?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 28, borderRadius: 4, border: 'none', cursor: 'pointer',
        background: active ? '#1A3044' : 'transparent',
        color: active ? '#58A6FF' : '#C9D1D9', flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: '#30363D', margin: '0 3px', flexShrink: 0 }} />
}

const PICKER_THEME = {
  documentBg: '#161B22', panelBorder: '#30363D', textPrimary: '#E6EDF3',
  textSecondary: '#8B949E', textMuted: '#6E7681', inputBg: '#0D1117',
  inputBorder: '#30363D', inputColor: '#E6EDF3', btnActiveBg: '#1A3044',
  btnActiveColor: '#58A6FF', imgBtnBg: '#21262D',
}

// ── "Insert field ▾" - mail-merge style dropdown, with a free-text custom field ──

function InsertFieldMenu({ onInsert }: { onInsert: (field: string) => void }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const submitCustom = () => {
    const v = custom.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    if (!v) return
    onInsert(v)
    setCustom('')
    setOpen(false)
  }

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)} title="Insert merge field" style={tbBtn}>
        <Tag size={14} /> Field <ChevronDown size={11} />
      </button>
      {open && menuPos && createPortal(
        <div ref={menuRef} style={{
          position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 1000,
          width: 220, maxHeight: 320, display: 'flex', flexDirection: 'column',
          background: '#161B22', border: '1px solid #30363D', borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,0.4)', overflow: 'hidden',
        }}>
          <div style={{ overflowY: 'auto', padding: 6 }}>
            {VARIABLE_SUGGESTIONS.map(v => (
              <button
                key={v} type="button"
                onClick={() => { onInsert(v); setOpen(false) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', background: 'transparent', color: '#E6EDF3', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1A3044')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
          <div style={{ borderTop: '1px solid #30363D', padding: 8, display: 'flex', gap: 6 }}>
            <input
              value={custom}
              onChange={e => setCustom(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitCustom() }}
              placeholder="custom_field"
              style={{ flex: 1, minWidth: 0, border: '1px solid #30363D', borderRadius: 4, padding: '5px 7px', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: '#E6EDF3', background: '#0D1117' }}
            />
            <button type="button" onClick={submitCustom} style={{ background: '#0073BB', border: 'none', borderRadius: 4, padding: '0 8px', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center' }}>
              <Plus size={13} />
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ── "Settings" popover (category / company / global / slug) ─────────────────────

function SettingsPopover({
  category, setCategory, isGlobal, setIsGlobal, companyId, setCompanyId, companies, slug, setSlug,
}: {
  category: Category; setCategory: (c: Category) => void
  isGlobal: boolean; setIsGlobal: (v: boolean) => void
  companyId: string; setCompanyId: (v: string) => void
  companies: Company[]
  slug: string; setSlug: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
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

  const inputSt: React.CSSProperties = {
    width: '100%', border: '1px solid #30363D', borderRadius: 5,
    padding: '6px 9px', fontSize: 13, color: '#E6EDF3', background: '#0D1117', boxSizing: 'border-box',
  }
  const labelSt: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 600, color: '#8B949E',
    marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase',
  }
  const topBarBtn: React.CSSProperties = {
    color: 'rgba(255,255,255,0.7)', background: 'transparent', border: '1px solid #2D3748', borderRadius: 6,
    padding: '5px 12px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
  }

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)} style={topBarBtn} title="Design settings">
        <Settings2 size={14} /> Settings
      </button>
      {open && menuPos && createPortal(
        <div ref={menuRef} style={{
          position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 1000,
          width: 260, background: '#161B22', border: '1px solid #30363D', borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,0.4)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div>
            <label style={labelSt}>Category</label>
            <select value={category} onChange={e => setCategory(e.target.value as Category)} style={inputSt}>
              {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={isGlobal} onChange={e => setIsGlobal(e.target.checked)} />
            <span style={{ fontSize: 12, color: '#C9D1D9' }}>Global (any company)</span>
          </label>
          {!isGlobal && (
            <div>
              <label style={labelSt}>Company</label>
              <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={inputSt}>
                <option value="">Select…</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label style={labelSt}>Slug (optional)</label>
            <input
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))}
              placeholder="e.g. interview_confirmation"
              style={{ ...inputSt, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}
            />
            <p style={{ fontSize: 10, color: '#6E7681', marginTop: 3, lineHeight: 1.4 }}>
              Stable key so Hiring and n8n automations can reference this design without a UUID.
            </p>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ── Main editor ───────────────────────────────────────────────────────────────

export default function EmailStudioEditor({ design, companies, onClose, onSaved }: EmailStudioEditorProps) {
  const isEdit = !!design?.id

  const [designId, setDesignId] = useState(design?.id ?? null)
  const [name, setName]         = useState(design?.name ?? '')
  const [editingName, setEditingName] = useState(!design)
  const [subject, setSubject]   = useState(design?.subject ?? '')
  const [companyId, setCompanyId] = useState(design?.company_id ?? companies[0]?.id ?? '')
  const [category, setCategory] = useState<Category>((design?.category as Category) ?? 'transactional')
  const [isGlobal, setIsGlobal] = useState(design?.is_global ?? false)
  const [slug, setSlug]         = useState((design as unknown as { slug?: string })?.slug ?? '')
  const [mode, setMode]         = useState<ContentMode>(design?.content_mode ?? 'richtext')
  const [saving, setSaving]     = useState(false)
  const [testSending, setTestSending] = useState(false)
  const [error, setError]       = useState('')
  const [notice, setNotice]     = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  // HTML mode state
  const [htmlSource, setHtmlSource] = useState('')
  const [pendingImages, setPendingImages] = useState<File[]>([])
  const [missingRefs, setMissingRefs] = useState<string[]>([])
  const [rewriting, setRewriting] = useState(false)
  const htmlFileRef  = useRef<HTMLInputElement>(null)
  const imgFilesRef  = useRef<HTMLInputElement>(null)
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      FontFamily.configure({ types: ['textStyle'] }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TiptapImage,
      Placeholder.configure({ placeholder: 'Write your email…' }),
      VariableChip,
    ],
    content: design?.content_mode === 'richtext' || !design ? ((design as unknown as { design_json?: object })?.design_json ?? { type: 'doc', content: [{ type: 'paragraph' }] }) : { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: { style: 'min-height:100%;outline:none;' },
      handlePaste: (view, event) => {
        const html = event.clipboardData?.getData('text/html') ?? ''
        const text = event.clipboardData?.getData('text/plain') ?? ''
        const hasRichHtml = /<(strong|b|em|i|u|h[1-6]|ul|ol|li|a\s)/i.test(html)
        if (!hasRichHtml && text && looksLikeMarkdown(text)) {
          event.preventDefault()
          const el = document.createElement('div')
          el.innerHTML = markdownToHtml(text)
          const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(el)
          view.dispatch(view.state.tr.replaceSelection(slice))
          return true
        }
        return false
      },
    },
  })

  useEffect(() => { if (editingName) nameInputRef.current?.focus() }, [editingName])

  // Fetch full detail (design_json/html) when editing - the list row doesn't carry it
  useEffect(() => {
    if (!design?.id) return
    fetch(`/api/email-designs/${design.id}`, { credentials: 'include' })
      .then(r => r.json())
      .then((d: { design: EmailDesign & { design_json?: object; html?: string; slug?: string } }) => {
        setSlug(d.design.slug ?? '')
        if (d.design.content_mode === 'html') {
          setHtmlSource(d.design.html ?? '')
        } else if (editor && d.design.design_json) {
          editor.commands.setContent(d.design.design_json)
        }
      })
  }, [design?.id, editor])

  // Pre-load webfonts already used in a saved rich design
  useEffect(() => {
    if (!editor) return
    const json = editor.getJSON() as { content?: unknown }
    const found = new Set<string>()
    const walk = (node: any) => {
      for (const mark of node?.marks ?? []) {
        if (mark.type === 'textStyle' && mark.attrs?.fontFamily) found.add(mark.attrs.fontFamily)
      }
      for (const child of node?.content ?? []) walk(child)
    }
    walk(json)
    found.forEach(loadGoogleFont)
  }, [editor])

  const insertVariable = (v: string) => {
    if (mode === 'richtext') {
      editor?.chain().focus().insertContent({ type: 'variable', attrs: { variable: v } }).run()
    } else {
      insertAtCursor(`{{${v}}}`)
    }
  }

  const insertAtCursor = (text: string) => {
    const ta = htmlTextareaRef.current
    if (!ta) { setHtmlSource(h => h + text); return }
    const start = ta.selectionStart ?? htmlSource.length
    const end   = ta.selectionEnd ?? htmlSource.length
    const next  = htmlSource.slice(0, start) + text + htmlSource.slice(end)
    setHtmlSource(next)
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + text.length })
  }

  const insertSignature = (html: string) => {
    if (mode === 'richtext') {
      editor?.chain().focus().insertContent(html).run()
    } else {
      insertAtCursor(html)
    }
  }

  const handleImageInsert = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/templates/upload-image', { method: 'POST', credentials: 'include', body: fd })
    const data = await res.json()
    if (res.ok) editor?.chain().focus().setImage({ src: data.url }).run()
  }

  const handleHtmlFileUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setHtmlSource(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  const handleRewriteRefs = async () => {
    if (!htmlSource.trim()) return
    setRewriting(true); setError('')
    try {
      const fd = new FormData()
      fd.append('html', htmlSource)
      if (designId) fd.append('design_id', designId)
      pendingImages.forEach(f => fd.append('images', f))
      const res = await fetch('/api/email-studio/upload-html', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Rewrite failed'); return }
      setHtmlSource(data.html)
      setMissingRefs(data.missingRefs ?? [])
      setPendingImages([])
      setNotice(data.missingRefs?.length ? `${data.missingRefs.length} image reference(s) still unresolved.` : 'Images rewired to hosted URLs.')
    } finally { setRewriting(false) }
  }

  const buildPayload = () => ({
    name: name.trim(), subject: subject.trim(), category,
    company_id: isGlobal ? null : (companyId || null), is_global: isGlobal,
    content_mode: mode, slug: slug.trim() || null,
    design_json: mode === 'richtext' ? editor?.getJSON() : undefined,
    html: mode === 'html' ? htmlSource : undefined,
  })

  const handleSave = async (): Promise<string | null> => {
    if (!name.trim()) { setError('Give this design a name (top left) before saving'); setEditingName(true); return null }
    if (!isGlobal && !companyId) { setError('Select a company in Settings, or mark this design Global'); return null }
    setSaving(true); setError('')
    try {
      const body = buildPayload()
      const url    = designId ? `/api/email-designs/${designId}` : '/api/email-designs'
      const method = designId ? 'PATCH' : 'POST'
      const res  = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed'); return null }
      setDesignId(data.design.id)
      return data.design.id as string
    } catch { setError('Network error'); return null
    } finally { setSaving(false) }
  }

  const handleSaveClick = async () => {
    const id = await handleSave()
    if (id) onSaved(id)
  }

  const handleTestSend = async () => {
    setTestSending(true); setError(''); setNotice('')
    try {
      const id = designId ?? await handleSave()
      if (!id) return
      const res = await fetch(`/api/email-designs/${id}/test-send`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Test send failed'); return }
      setNotice('Test email sent to your account address.')
    } finally { setTestSending(false) }
  }

  if (!editor) return null

  const topBarBtn: React.CSSProperties = {
    color: 'rgba(255,255,255,0.7)', background: 'transparent',
    border: '1px solid #2D3748', borderRadius: 6,
    padding: '5px 12px', fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#0D1117', display: 'flex', flexDirection: 'column' }}>
      {/* TOP BAR */}
      <div style={{ height: 52, background: '#16191F', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10, flexShrink: 0, borderBottom: '1px solid #0D1117' }}>
        <button type="button" onClick={onClose} style={topBarBtn}><ArrowLeft size={14} /> Email Studio</button>

        {editingName ? (
          <input
            ref={nameInputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => name.trim() && setEditingName(false)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) setEditingName(false) }}
            placeholder="Untitled design"
            style={{
              flex: 1, background: 'transparent', border: 'none', borderBottom: '1px solid #58A6FF',
              color: '#fff', fontWeight: 600, fontSize: 14, fontFamily: 'Syne, sans-serif', outline: 'none', padding: '2px 0',
            }}
          />
        ) : (
          <button
            type="button" onClick={() => setEditingName(true)}
            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'text', textAlign: 'left', minWidth: 0 }}
            title="Rename"
          >
            <span style={{ color: '#fff', fontWeight: 600, fontSize: 14, fontFamily: 'Syne, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name || 'Untitled design'}
            </span>
            <Pencil size={11} color="#6E7681" />
          </button>
        )}

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 2, background: '#0D1117', border: '1px solid #2D3748', borderRadius: 6, padding: 3 }}>
          <button type="button" onClick={() => setMode('richtext')} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: mode === 'richtext' ? '#0073BB' : 'transparent', color: mode === 'richtext' ? '#fff' : 'rgba(255,255,255,0.6)' }}>
            <Type size={13} /> Rich Text
          </button>
          <button type="button" onClick={() => setMode('html')} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: mode === 'html' ? '#0073BB' : 'transparent', color: mode === 'html' ? '#fff' : 'rgba(255,255,255,0.6)' }}>
            <Code2 size={13} /> Import HTML
          </button>
        </div>

        {error && <span style={{ fontSize: 12, color: '#FCA5A5', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, padding: '4px 10px', flexShrink: 0 }}>{error}</span>}
        {!error && notice && <span style={{ fontSize: 12, color: '#86EFAC', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 4, padding: '4px 10px', flexShrink: 0 }}>{notice}</span>}

        <SettingsPopover
          category={category} setCategory={setCategory}
          isGlobal={isGlobal} setIsGlobal={setIsGlobal}
          companyId={companyId} setCompanyId={setCompanyId} companies={companies}
          slug={slug} setSlug={setSlug}
        />
        <button type="button" onClick={handleTestSend} disabled={testSending} style={topBarBtn}>
          <Send size={14} /> {testSending ? 'Sending…' : 'Send test'}
        </button>
        <button
          type="button" onClick={handleSaveClick} disabled={saving}
          style={{ background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 18px', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontWeight: 600, whiteSpace: 'nowrap' }}
        >
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Design'}
        </button>
      </div>

      {/* COMPOSE AREA - full width, Gmail-style card. Sized to content (like Gmail's
          compose window), not stretched to fill the viewport - alignItems:'flex-start'
          stops the card from being flex-stretched to the scroll container's full height. */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', background: '#0D1117' }}>
        <div style={{ width: '100%', maxWidth: 760, background: '#161B22', borderRadius: 8, boxShadow: '0 2px 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', border: '1px solid #21262D' }}>

          {/* Subject - Gmail style, prominent, single underline */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #21262D', flexShrink: 0 }}>
            <span style={{ fontSize: 13, color: '#6E7681', marginRight: 10, flexShrink: 0 }}>Subject</span>
            <input
              value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Your interview is confirmed"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#E6EDF3', fontSize: 15, fontWeight: 500 }}
            />
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 12px', borderBottom: '1px solid #21262D', flexWrap: 'wrap', flexShrink: 0 }}>
            {mode === 'richtext' && (
              <>
                <TB onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1"><Heading1 size={15} /></TB>
                <TB onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2"><Heading2 size={15} /></TB>
                <TB onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3"><Heading3 size={15} /></TB>
                <Divider />
                <FontPicker
                  value={(editor.getAttributes('textStyle').fontFamily as string | undefined) ?? null}
                  onChange={family => {
                    if (family) editor.chain().focus().setFontFamily(family).run()
                    else editor.chain().focus().unsetFontFamily().run()
                  }}
                  t={PICKER_THEME}
                />
                <Divider />
                <TB onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><Bold size={14} /></TB>
                <TB onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><Italic size={14} /></TB>
                <TB onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline"><UnderlineIcon size={14} /></TB>
                <Divider />
                <TB onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List"><List size={15} /></TB>
                <TB onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered List"><ListOrdered size={15} /></TB>
                <Divider />
                <TB onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align Left"><AlignLeft size={14} /></TB>
                <TB onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align Center"><AlignCenter size={14} /></TB>
                <TB onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align Right"><AlignRight size={14} /></TB>
                <Divider />
                <TB onClick={() => document.getElementById('es-img-input')?.click()} title="Insert Image"><ImageIcon size={14} /></TB>
                <input id="es-img-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImageInsert(f); e.target.value = '' }} />
                <Divider />
              </>
            )}
            <InsertFieldMenu onInsert={insertVariable} />
            <SignaturePicker onInsert={insertSignature} companyId={isGlobal ? null : (companyId || null)} />
          </div>

          {/* Body - grows with content like Gmail's compose box (min-height for a
              comfortable starting size), caps out and scrolls internally past that
              rather than stretching the whole card or letting text spill out. */}
          {mode === 'richtext' ? (
            <div style={{ minHeight: 280, maxHeight: 'calc(100vh - 280px)', overflowY: 'auto', padding: '20px 24px' }}>
              <style>{`
                .ProseMirror { outline: none; }
                .ProseMirror p { margin-bottom: 12px; line-height: 1.8; font-size: 14px; color: #E6EDF3; }
                .ProseMirror h1 { font-size: 22px; font-weight: 700; margin-bottom: 14px; font-family: Syne, sans-serif; color: #E6EDF3; }
                .ProseMirror h2 { font-size: 17px; font-weight: 600; margin-bottom: 12px; font-family: Syne, sans-serif; color: #E6EDF3; }
                .ProseMirror h3 { font-size: 15px; font-weight: 600; margin-bottom: 10px; color: #E6EDF3; }
                .ProseMirror ul, .ProseMirror ol { padding-left: 22px; margin-bottom: 12px; }
                .ProseMirror li { margin-bottom: 4px; line-height: 1.8; font-size: 14px; color: #E6EDF3; }
                .ProseMirror img { max-width: 100%; height: auto; }
                .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #6E7681; pointer-events: none; float: left; height: 0; }
              `}</style>
              <EditorContent editor={editor} />
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 400 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid #21262D', flexShrink: 0 }}>
                <button type="button" onClick={() => htmlFileRef.current?.click()} style={{ ...topBarBtn, padding: '4px 10px' }}>
                  <Upload size={13} /> Upload .html
                </button>
                <input ref={htmlFileRef} type="file" accept=".html,text/html" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleHtmlFileUpload(f); e.target.value = '' }} />
                <button type="button" onClick={() => imgFilesRef.current?.click()} style={{ ...topBarBtn, padding: '4px 10px' }}>
                  <ImageIcon size={13} /> Add images ({pendingImages.length})
                </button>
                <input ref={imgFilesRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                  onChange={e => { setPendingImages(p => [...p, ...Array.from(e.target.files ?? [])]); e.target.value = '' }} />
                <button type="button" onClick={handleRewriteRefs} disabled={rewriting} style={{ ...topBarBtn, padding: '4px 10px', background: '#0073BB', borderColor: '#0073BB' }}>
                  {rewriting ? 'Rewriting…' : 'Rewire image refs'}
                </button>
              </div>

              {pendingImages.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 16px', borderBottom: '1px solid #21262D' }}>
                  {pendingImages.map((f, i) => (
                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#21262D', border: '1px solid #30363D', borderRadius: 4, padding: '3px 8px', fontSize: 11, color: '#C9D1D9' }}>
                      {f.name}
                      <button type="button" onClick={() => setPendingImages(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8B949E', display: 'flex' }}><X size={11} /></button>
                    </span>
                  ))}
                </div>
              )}
              {missingRefs.length > 0 && (
                <div style={{ padding: '8px 16px', background: 'rgba(239,68,68,0.1)', borderBottom: '1px solid #21262D', fontSize: 11, color: '#FCA5A5' }}>
                  Unresolved image references - upload a file matching each name, then Rewire again: {missingRefs.join(', ')}
                </div>
              )}

              <div style={{ flex: 1, display: 'flex' }}>
                <textarea
                  ref={htmlTextareaRef}
                  value={htmlSource}
                  onChange={e => setHtmlSource(e.target.value)}
                  placeholder="Paste raw HTML here, or upload a .html file above…"
                  spellCheck={false}
                  style={{
                    flex: 1, border: 'none', outline: 'none', resize: 'none', borderRight: '1px solid #21262D',
                    padding: '16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12.5,
                    lineHeight: 1.6, background: '#0D1117', color: '#E6EDF3',
                  }}
                />
                <iframe
                  title="Email preview"
                  srcDoc={htmlSource || '<p style="font-family:sans-serif;color:#999;padding:24px;">Nothing to preview yet.</p>'}
                  style={{ flex: 1, border: 'none', background: '#fff' }}
                  sandbox=""
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
