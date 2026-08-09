'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import DOMPurify from 'isomorphic-dompurify'
import {
  ArrowLeft, Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Image as ImageIcon, Heading1, Heading2, Heading3, Eye, EyeOff,
  AlignLeft, AlignCenter, AlignRight, History, X,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type PostStatus = 'draft' | 'scheduled' | 'published'

interface Company { id: string; name: string }

interface Post {
  id: string
  company_id: string
  title: string
  slug: string
  excerpt: string | null
  content: string
  status: PostStatus
  scheduled_at: string | null
  category: string | null
  tags: string[]
  meta_title: string | null
  meta_description: string | null
  og_image_url: string | null
  canonical_url: string | null
}

interface Version { id: string; title: string; version: number; created_at: string }
interface Media { id: string; url: string; filename: string }

export interface PostEditorProps {
  postId: string | null
  companies: Company[]
  onClose: () => void
  onSaved: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
}

const inputSt: React.CSSProperties = {
  width: '100%', border: '1px solid #D5DBDB', borderRadius: 6, padding: '7px 10px',
  fontSize: 13, color: '#16191F', background: '#fff', boxSizing: 'border-box', outline: 'none',
}
const labelSt: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#687078',
  marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase',
}

function CharCounter({ value, min, max }: { value: string; min: number; max: number }) {
  const len = value.length
  const ok = len === 0 || (len >= min && len <= max)
  return (
    <span style={{ fontSize: 10.5, color: len === 0 ? '#AAB5BB' : ok ? '#1D8102' : '#E8820C', fontFamily: 'var(--font-ibm-plex-mono), monospace' }}>
      {len} chars {len > 0 && !ok ? `(recommended ${min}-${max})` : ''}
    </span>
  )
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function TB({ onClick, active, title, children }: { onClick: () => void; active?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 28, borderRadius: 4, border: 'none', cursor: 'pointer',
        background: active ? '#E8F4FB' : 'transparent', color: active ? '#0073BB' : '#374151',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}

// ── Main editor ───────────────────────────────────────────────────────────────

export default function PostEditor({ postId, companies, onClose, onSaved }: PostEditorProps) {
  const qc = useQueryClient()
  const isEdit = !!postId
  const imgInputRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const [category, setCategory] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [metaTitle, setMetaTitle] = useState('')
  const [metaDescription, setMetaDescription] = useState('')
  const [ogImageUrl, setOgImageUrl] = useState('')
  const [canonicalUrl, setCanonicalUrl] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [currentPostId, setCurrentPostId] = useState<string | null>(postId)

  const { data: postData } = useQuery<{ post: Post }>({
    queryKey: ['blog-post', postId],
    queryFn: async () => { const res = await fetch(`/api/blog/posts/${postId}`, { credentials: 'include' }); return res.json() },
    enabled: !!postId,
  })

  const { data: versionsData } = useQuery<{ versions: Version[] }>({
    queryKey: ['blog-post-versions', currentPostId],
    queryFn: async () => { const res = await fetch(`/api/blog/posts/${currentPostId}/versions`, { credentials: 'include' }); return res.json() },
    enabled: !!currentPostId && showVersions,
  })

  const { data: mediaData } = useQuery<{ media: Media[] }>({
    queryKey: ['blog-media', companyId],
    queryFn: async () => { const res = await fetch(`/api/blog/media?company_id=${companyId}`, { credentials: 'include' }); return res.json() },
    enabled: !!companyId,
  })

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image,
      Placeholder.configure({ placeholder: 'Start writing your post…' }),
    ],
    content: '',
    editorProps: { attributes: { style: 'min-height:400px;outline:none;' } },
  })

  // Populate form once post + editor are both ready
  useEffect(() => {
    const post = postData?.post
    if (!post || !editor) return
    setTitle(post.title)
    setSlug(post.slug)
    setSlugEdited(true)
    setCompanyId(post.company_id)
    setCategory(post.category ?? '')
    setTagsInput((post.tags ?? []).join(', '))
    setExcerpt(post.excerpt ?? '')
    setMetaTitle(post.meta_title ?? '')
    setMetaDescription(post.meta_description ?? '')
    setOgImageUrl(post.og_image_url ?? '')
    setCanonicalUrl(post.canonical_url ?? '')
    setScheduledAt(post.scheduled_at ? post.scheduled_at.slice(0, 16) : '')
    try {
      editor.commands.setContent(post.content ? JSON.parse(post.content) : '')
    } catch {
      editor.commands.setContent(post.content || '')
    }
  }, [postData, editor])

  useEffect(() => { if (!slugEdited) setSlug(slugify(title)) }, [title, slugEdited])

  const handleImageUpload = useCallback(async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('company_id', companyId)
    const res = await fetch('/api/blog/media/upload', { method: 'POST', credentials: 'include', body: fd })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Upload failed'); return }
    editor?.chain().focus().setImage({ src: data.media.url }).run()
    qc.invalidateQueries({ queryKey: ['blog-media', companyId] })
  }, [editor, companyId, qc])

  async function save(publishNow: boolean) {
    if (!title.trim()) { setError('Title is required'); return }
    if (!companyId) { setError('Select a company'); return }
    setSaving(true); setError('')

    const body = {
      company_id: companyId,
      title: title.trim(),
      slug: slug || slugify(title),
      excerpt: excerpt.trim() || null,
      content: JSON.stringify(editor?.getJSON() ?? {}),
      category: category.trim() || null,
      tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
      meta_title: metaTitle.trim() || null,
      meta_description: metaDescription.trim() || null,
      og_image_url: ogImageUrl.trim() || null,
      canonical_url: canonicalUrl.trim() || null,
    }

    try {
      let id = currentPostId
      if (id) {
        const res = await fetch(`/api/blog/posts/${id}`, {
          method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        if (!res.ok) { const d = await res.json(); setError(d.error || 'Save failed'); return }
      } else {
        const res = await fetch('/api/blog/posts', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        const d = await res.json()
        if (!res.ok) { setError(d.error || 'Save failed'); return }
        id = d.post.id
        setCurrentPostId(id)
      }

      if (publishNow || scheduledAt) {
        const pubBody = scheduledAt && !publishNow ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}
        const res = await fetch(`/api/blog/posts/${id}/publish`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pubBody),
        })
        if (!res.ok) { const d = await res.json(); setError(d.error || 'Publish failed'); return }
      }

      onSaved()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  if (!editor) return null

  const topBarBtn: React.CSSProperties = {
    color: 'rgba(255,255,255,0.7)', background: 'transparent', border: '1px solid #2D3748',
    borderRadius: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#F0F2F5', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ height: 52, background: '#16191F', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10, flexShrink: 0 }}>
        <button type="button" onClick={onClose} style={topBarBtn}><ArrowLeft size={14} /> Blog</button>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 14, flex: 1, fontFamily: 'var(--font-syne), sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title || (isEdit ? 'Edit Post' : 'New Post')}
        </span>
        {error && (
          <span style={{ fontSize: 12, color: '#FCA5A5', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, padding: '4px 10px' }}>{error}</span>
        )}
        {currentPostId && (
          <button type="button" onClick={() => setShowVersions(v => !v)} style={topBarBtn}><History size={14} /> Versions</button>
        )}
        <button type="button" onClick={() => setPreview(p => !p)} style={topBarBtn}>
          {preview ? <EyeOff size={14} /> : <Eye size={14} />} {preview ? 'Edit' : 'Preview'}
        </button>
        <button type="button" onClick={() => save(false)} disabled={saving} style={{ ...topBarBtn, borderColor: '#0073BB', color: '#0073BB' }}>
          {saving ? 'Saving…' : 'Save Draft'}
        </button>
        <button
          type="button" onClick={() => save(true)} disabled={saving}
          style={{ background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
        >
          {scheduledAt ? 'Schedule' : 'Publish Now'}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left settings panel */}
        <div style={{ width: 260, background: '#FAFBFC', borderRight: '1px solid #E5E7EB', overflowY: 'auto', padding: '20px 16px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelSt}>Company</label>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={inputSt}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelSt}>Slug</label>
            <input value={slug} onChange={e => { setSlug(slugify(e.target.value)); setSlugEdited(true) }} style={inputSt} />
          </div>
          <div>
            <label style={labelSt}>Category</label>
            <input value={category} onChange={e => setCategory(e.target.value)} style={inputSt} placeholder="e.g. Product Updates" />
          </div>
          <div>
            <label style={labelSt}>Tags</label>
            <input value={tagsInput} onChange={e => setTagsInput(e.target.value)} style={inputSt} placeholder="comma, separated" />
          </div>
          <div>
            <label style={labelSt}>Excerpt</label>
            <textarea value={excerpt} onChange={e => setExcerpt(e.target.value)} rows={3} style={{ ...inputSt, resize: 'vertical' }} />
          </div>
          <div>
            <label style={labelSt}>Schedule for</label>
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} style={inputSt} />
          </div>

          <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 14, marginTop: 4 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.05em', textTransform: 'uppercase', margin: '0 0 10px' }}>SEO</p>
            <div style={{ marginBottom: 10 }}>
              <label style={labelSt}>Meta Title</label>
              <input value={metaTitle} onChange={e => setMetaTitle(e.target.value)} style={inputSt} />
              <div style={{ marginTop: 3 }}><CharCounter value={metaTitle} min={10} max={60} /></div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={labelSt}>Meta Description</label>
              <textarea value={metaDescription} onChange={e => setMetaDescription(e.target.value)} rows={2} style={{ ...inputSt, resize: 'vertical' }} />
              <div style={{ marginTop: 3 }}><CharCounter value={metaDescription} min={50} max={160} /></div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={labelSt}>OG Image URL</label>
              <input value={ogImageUrl} onChange={e => setOgImageUrl(e.target.value)} style={inputSt} placeholder="Pick from media below" />
            </div>
            <div>
              <label style={labelSt}>Canonical URL</label>
              <input value={canonicalUrl} onChange={e => setCanonicalUrl(e.target.value)} style={inputSt} />
            </div>
          </div>

          {(mediaData?.media?.length ?? 0) > 0 && (
            <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 14 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.05em', textTransform: 'uppercase', margin: '0 0 8px' }}>Media Library</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {mediaData!.media.slice(0, 9).map(m => (
                  <img
                    key={m.id} src={m.url} alt={m.filename}
                    onClick={() => setOgImageUrl(m.url)}
                    style={{ width: '100%', height: 50, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid #E5E7EB' }}
                    title="Click to set as OG image"
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Editor / preview */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {preview ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '40px 64px', display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: 760, background: '#fff', borderRadius: 4, padding: '48px 56px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
                <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontSize: 32, fontWeight: 700, marginBottom: 12 }}>{title || 'Untitled Post'}</h1>
                {excerpt && <p style={{ fontSize: 15, color: '#687078', marginBottom: 24 }}>{excerpt}</p>}
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(editor.getHTML()) }} style={{ fontSize: 15, lineHeight: 1.8, color: '#16191F' }} />
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 16px', borderBottom: '1px solid #E5E7EB', background: '#FAFBFC', flexWrap: 'wrap' }}>
                <TB onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1"><Heading1 size={15} /></TB>
                <TB onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2"><Heading2 size={15} /></TB>
                <TB onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3"><Heading3 size={15} /></TB>
                <div style={{ width: 1, height: 20, background: '#E5E7EB', margin: '0 3px' }} />
                <TB onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><Bold size={14} /></TB>
                <TB onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><Italic size={14} /></TB>
                <TB onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline"><UnderlineIcon size={14} /></TB>
                <div style={{ width: 1, height: 20, background: '#E5E7EB', margin: '0 3px' }} />
                <TB onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List"><List size={15} /></TB>
                <TB onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered List"><ListOrdered size={15} /></TB>
                <div style={{ width: 1, height: 20, background: '#E5E7EB', margin: '0 3px' }} />
                <TB onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align Left"><AlignLeft size={14} /></TB>
                <TB onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align Center"><AlignCenter size={14} /></TB>
                <TB onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align Right"><AlignRight size={14} /></TB>
                <div style={{ width: 1, height: 20, background: '#E5E7EB', margin: '0 3px' }} />
                <TB onClick={() => imgInputRef.current?.click()} title="Insert Image"><ImageIcon size={14} /></TB>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '40px 64px', display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: '100%', maxWidth: 760, background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', borderRadius: 4, padding: '48px 56px', minHeight: 500 }}>
                  <input
                    value={title} onChange={e => setTitle(e.target.value)} placeholder="Post title"
                    style={{ width: '100%', border: 'none', outline: 'none', fontFamily: 'var(--font-syne), sans-serif', fontSize: 28, fontWeight: 700, marginBottom: 20, color: '#16191F' }}
                  />
                  <style>{`
                    .ProseMirror p { margin-bottom: 12px; line-height: 1.8; font-size: 15px; color: #16191F; }
                    .ProseMirror h1 { font-size: 24px; font-weight: 700; margin-bottom: 16px; font-family: var(--font-syne), sans-serif; }
                    .ProseMirror h2 { font-size: 19px; font-weight: 600; margin-bottom: 12px; font-family: var(--font-syne), sans-serif; }
                    .ProseMirror h3 { font-size: 16px; font-weight: 600; margin-bottom: 10px; }
                    .ProseMirror ul, .ProseMirror ol { padding-left: 22px; margin-bottom: 12px; }
                    .ProseMirror img { max-width: 100%; height: auto; border-radius: 6px; margin: 8px 0; }
                    .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #AAB5BB; pointer-events: none; float: left; height: 0; }
                  `}</style>
                  <EditorContent editor={editor} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Version history panel */}
        {showVersions && (
          <div style={{ width: 240, background: '#FAFBFC', borderLeft: '1px solid #E5E7EB', overflowY: 'auto', padding: '16px 14px', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.05em', textTransform: 'uppercase' }}>History</span>
              <button onClick={() => setShowVersions(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#687078' }}><X size={14} /></button>
            </div>
            {(versionsData?.versions?.length ?? 0) === 0 ? (
              <p style={{ fontSize: 12, color: '#AAB5BB' }}>No earlier versions yet</p>
            ) : (
              versionsData!.versions.map(v => (
                <div key={v.id} style={{ padding: '8px 0', borderBottom: '1px solid #E5E7EB', fontSize: 12 }}>
                  <div style={{ fontWeight: 600 }}>v{v.version}</div>
                  <div style={{ color: '#687078', fontSize: 11, fontFamily: 'var(--font-ibm-plex-mono), monospace' }}>
                    {new Date(v.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))
            )}
            <p style={{ fontSize: 10.5, color: '#AAB5BB', marginTop: 10 }}>Restore-from-version is not built yet - contact support if you need an old version back.</p>
          </div>
        )}
      </div>

      <input
        ref={imgInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = '' }}
      />
    </div>
  )
}
