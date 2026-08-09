'use client'
import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, Minus, Plus, LayoutTemplate, Move, X } from 'lucide-react'
import { FontPicker, type PickerTheme } from '../templates/font-picker'
import { loadGoogleFont, fontStack } from '../templates/fonts'

export interface TemplateElement {
  id: string
  tag: string
  x: number
  y: number
  width: number
  fontFamily: string
  fontSize: number
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  fill: string
  textAlign: 'left' | 'center' | 'right'
}

interface DocTemplate {
  id?: string
  name: string
  doc_type: string
  company_id?: string
  canvas_width: number
  canvas_height: number
  background_path: string | null
  elements: TemplateElement[]
  tags: string[]
}

interface Props {
  template: DocTemplate | null
  onClose: () => void
  onSaved: () => void
}

type DragState =
  | { type: 'move';   id: string; startX: number; startY: number; origX: number; origY: number }
  | { type: 'resize'; id: string; handle: 'e' | 'w' | 'se' | 'sw'; startX: number; origX: number; origW: number }

const CANVAS_PRESETS = [
  { label: 'A4 Portrait',  width: 794,  height: 1123 },
  { label: 'A4 Landscape', width: 1123, height: 794  },
  { label: 'A3 Portrait',  width: 1123, height: 1587 },
  { label: 'A3 Landscape', width: 1587, height: 1123 },
  { label: 'Custom',       width: 0,    height: 0    },
]

const H_SIZE = 9  // resize handle size px

// Studio editor is dark-only (no theme toggle), so the font picker gets a
// fixed theme matching this file's existing dark palette.
const FONT_PICKER_THEME: PickerTheme = {
  documentBg:    '#16191F',
  panelBorder:   '#2D3748',
  textPrimary:   '#fff',
  textSecondary: 'rgba(255,255,255,0.6)',
  textMuted:     'rgba(255,255,255,0.35)',
  inputBg:       '#0D1117',
  inputBorder:   '#2D3748',
  inputColor:    '#fff',
  btnActiveBg:   'rgba(0,115,187,0.2)',
  btnActiveColor:'#60B4FF',
  imgBtnBg:      'rgba(255,255,255,0.05)',
}

export function TemplateEditorSlideOver({ template, onClose, onSaved }: Props) {
  const isEdit = !!template?.id

  const [name,      setName]      = useState(template?.name       ?? '')
  const [docType,   setDocType]   = useState(template?.doc_type   ?? 'certificate')
  const [companyId, setCompanyId] = useState(template?.company_id ?? '')
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [bgPath,    setBgPath]    = useState(template?.background_path ?? null)
  const [canvasW,   setCanvasW]   = useState(template?.canvas_width  ?? 794)
  const [canvasH,   setCanvasH]   = useState(template?.canvas_height ?? 1123)
  const [preset,    setPreset]    = useState('A4 Portrait')
  const [elements,  setElements]  = useState<TemplateElement[]>(template?.elements ?? [])
  const [selected,  setSelected]  = useState<string | null>(null)
  const [saving,    setSaving]    = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState('')
  const [zoom,      setZoom]      = useState(0.8)

  const dragging = useRef<DragState | null>(null)

  // Pre-load webfonts already used in a saved template so text fields render
  // in the right font the instant the canvas mounts, not just on selection.
  useEffect(() => {
    const fonts = new Set((template?.elements ?? []).map(el => el.fontFamily).filter(Boolean))
    fonts.forEach(loadGoogleFont)
  }, [template?.elements])

  // Scale = zoom (user-controlled); the canvas renders at actual pixel size and we CSS-scale it
  const scale = zoom

  // ── Companies ────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/companies', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { companies: [] })
      .then((data: { companies: { id: string; name: string }[] }) => {
        const list = data.companies ?? []
        setCompanies(list)
        if (!companyId && list.length) setCompanyId(list[0].id)
      })
  }, [])

  // ── Global mouse events for smooth drag ───────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragging.current
      if (!d) return
      if (d.type === 'move') {
        const dx = (e.clientX - d.startX) / scale
        const dy = (e.clientY - d.startY) / scale
        setElements(prev => prev.map(el =>
          el.id === d.id
            ? { ...el, x: Math.max(0, d.origX + dx), y: Math.max(0, d.origY + dy) }
            : el
        ))
      } else if (d.type === 'resize') {
        const dx = (e.clientX - d.startX) / scale
        if (d.handle === 'e' || d.handle === 'se') {
          setElements(prev => prev.map(el =>
            el.id === d.id ? { ...el, width: Math.max(40, d.origW + dx) } : el
          ))
        } else if (d.handle === 'w' || d.handle === 'sw') {
          setElements(prev => prev.map(el =>
            el.id === d.id
              ? { ...el, x: d.origX + dx, width: Math.max(40, d.origW - dx) }
              : el
          ))
        }
      }
    }
    const onUp = () => { dragging.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
  }, [scale])

  // ── Arrow-key nudge ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      setElements(prev => prev.map(el => {
        if (el.id !== selected) return el
        return {
          ...el,
          x: e.key === 'ArrowLeft'  ? Math.max(0, el.x - step) : e.key === 'ArrowRight' ? el.x + step : el.x,
          y: e.key === 'ArrowUp'    ? Math.max(0, el.y - step) : e.key === 'ArrowDown'  ? el.y + step : el.y,
        }
      }))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected])

  // ── Drag initiators ───────────────────────────────────────────────────────────
  const startMove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    e.preventDefault()
    setSelected(id)
    const el = elements.find(el => el.id === id)!
    dragging.current = { type: 'move', id, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y }
  }

  const startResize = (e: React.MouseEvent, id: string, h: 'e' | 'w' | 'se' | 'sw') => {
    e.stopPropagation()
    e.preventDefault()
    const el = elements.find(el => el.id === id)!
    dragging.current = { type: 'resize', id, handle: h, startX: e.clientX, origX: el.x, origW: el.width }
  }

  // ── Element helpers ───────────────────────────────────────────────────────────
  const addElement = () => {
    const id = crypto.randomUUID()
    const el: TemplateElement = {
      id, tag: `field_${elements.length + 1}`,
      x: 80, y: 80 + elements.length * 60,
      width: 320, fontFamily: 'Arial',
      fontSize: 24, fontWeight: 'normal',
      fontStyle: 'normal', fill: '#000000',
      textAlign: 'left',
    }
    setElements(prev => [...prev, el])
    setSelected(id)
  }

  const updateSelected = (patch: Partial<TemplateElement>) =>
    setElements(prev => prev.map(el => el.id === selected ? { ...el, ...patch } : el))

  const deleteSelected = () => {
    setElements(prev => prev.filter(el => el.id !== selected))
    setSelected(null)
  }

  const selectedEl = elements.find(el => el.id === selected) ?? null

  // ── Background upload ─────────────────────────────────────────────────────────
  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/documents/upload-bg', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setBgPath(data.path)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // ── Preset ────────────────────────────────────────────────────────────────────
  const handlePreset = (label: string) => {
    setPreset(label)
    const p = CANVAS_PRESETS.find(p => p.label === label)
    if (p && p.width) { setCanvasW(p.width); setCanvasH(p.height) }
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!name.trim()) { setError('Template name is required'); return }
    if (!companyId)   { setError('Select a company'); return }
    setSaving(true); setError('')
    try {
      const body   = { name: name.trim(), doc_type: docType, company_id: companyId, background_path: bgPath, canvas_width: canvasW, canvas_height: canvasH, elements }
      const url    = isEdit ? `/api/documents/templates/${template!.id}` : '/api/documents/templates'
      const method = isEdit ? 'PATCH' : 'POST'
      const res    = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data   = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#1A1A2E', display: 'flex', flexDirection: 'column' }}>

      {/* TOP TOOLBAR */}
      <div style={{
        height: 52, background: '#16191F', borderBottom: '1px solid #2D3748',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0,
      }}>
        {/* Back */}
        <button
          onClick={onClose}
          style={{ color: 'rgba(255,255,255,0.7)', background: 'transparent', border: '1px solid #2D3748', borderRadius: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
        >
          <ArrowLeft size={14} /> Back to Studio
        </button>

        {/* Template name */}
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 14, flex: 1, fontFamily: 'Syne, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name || (isEdit ? 'Edit Template' : 'New Template')}
        </span>

        {/* Zoom controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: '#0D1117', border: '1px solid #2D3748', borderRadius: 6, padding: '3px 6px' }}>
          <button
            onClick={() => setZoom(z => Math.max(0.25, parseFloat((z - 0.1).toFixed(2))))}
            style={{ color: 'rgba(255,255,255,0.8)', background: 'transparent', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 4px', display: 'inline-flex', alignItems: 'center' }}
          ><Minus size={14} /></button>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#fff', fontSize: 12, minWidth: 42, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(2, parseFloat((z + 0.1).toFixed(2))))}
            style={{ color: 'rgba(255,255,255,0.8)', background: 'transparent', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 4px', display: 'inline-flex', alignItems: 'center' }}
          ><Plus size={14} /></button>
          <div style={{ width: 1, height: 16, background: '#2D3748', margin: '0 4px' }} />
          <button
            onClick={() => setZoom(1)}
            style={{ color: 'rgba(255,255,255,0.6)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 11, padding: '0 4px' }}
          >Reset</button>
        </div>

        {/* Canvas size badge */}
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: 'rgba(255,255,255,0.4)', padding: '4px 8px', background: '#0D1117', border: '1px solid #2D3748', borderRadius: 4 }}>
          {canvasW}×{canvasH}
        </span>

        {/* Error */}
        {error && (
          <span style={{ fontSize: 12, color: '#FF6B6B', background: 'rgba(209,50,18,0.15)', border: '1px solid rgba(209,50,18,0.3)', borderRadius: 4, padding: '4px 10px' }}>
            {error}
          </span>
        )}

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 18px', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontWeight: 600, whiteSpace: 'nowrap' }}
        >
          {saving ? 'Saving…' : 'Save Template'}
        </button>
      </div>

      {/* MAIN AREA */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT SIDEBAR - settings & fields */}
        <div style={{ width: 236, background: '#16191F', borderRight: '1px solid #2D3748', overflowY: 'auto', padding: 16, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div>
            <label style={darkLabelStyle}>TEMPLATE NAME</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Internship Certificate" style={darkInputStyle} />
          </div>

          <div>
            <label style={darkLabelStyle}>TYPE</label>
            <select value={docType} onChange={e => setDocType(e.target.value)} style={darkSelectStyle}>
              <option value="offer_letter">Offer Letter</option>
              <option value="certificate">Certificate</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div>
            <label style={darkLabelStyle}>COMPANY</label>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={darkSelectStyle}>
              <option value="">Select company…</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label style={darkLabelStyle}>CANVAS SIZE</label>
            <select value={preset} onChange={e => handlePreset(e.target.value)} style={{ ...darkSelectStyle, marginBottom: 6 }}>
              {CANVAS_PRESETS.map(p => <option key={p.label}>{p.label}</option>)}
            </select>
            {preset === 'Custom' && (
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" value={canvasW} onChange={e => setCanvasW(+e.target.value)} placeholder="W px" style={{ ...darkInputStyle, padding: '6px 8px' }} />
                <input type="number" value={canvasH} onChange={e => setCanvasH(+e.target.value)} placeholder="H px" style={{ ...darkInputStyle, padding: '6px 8px' }} />
              </div>
            )}
          </div>

          <div>
            <label style={darkLabelStyle}>BACKGROUND IMAGE</label>
            {bgPath && (
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <img src={`/api/documents/backgrounds/${bgPath}`} alt="bg" style={{ width: '100%', height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid #2D3748' }} />
                <button onClick={() => setBgPath(null)} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}><X size={14} /></button>
              </div>
            )}
            <label style={{ display: 'block', textAlign: 'center', padding: 8, border: '1px dashed #2D3748', borderRadius: 6, cursor: uploading ? 'wait' : 'pointer', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
              {uploading ? 'Converting…' : '+ Upload Image or PDF'}
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" style={{ display: 'none' }} onChange={handleBgUpload} />
            </label>
          </div>

          {/* Field list */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={darkLabelStyle}>TEXT FIELDS</label>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{elements.length}</span>
            </div>
            {elements.length === 0 ? (
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>No text fields yet. Add one below.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {elements.map(el => (
                  <div
                    key={el.id}
                    onClick={() => setSelected(el.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                      borderRadius: 5, cursor: 'pointer',
                      background: selected === el.id ? 'rgba(0,115,187,0.2)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${selected === el.id ? '#0073BB' : '#2D3748'}`,
                    }}
                  >
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: selected === el.id ? '#60B4FF' : 'rgba(255,255,255,0.6)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {`{{${el.tag}}}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={addElement}
            style={{ background: 'transparent', border: '1px dashed #0073BB', borderRadius: 6, padding: 8, fontSize: 13, color: '#60B4FF', cursor: 'pointer', width: '100%' }}
          >
            + Add Text Field
          </button>

          {/* Keyboard hints */}
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, borderTop: '1px solid #2D3748', paddingTop: 12, marginTop: 4 }}>
            Arrow keys nudge 1px<br />
            Shift+Arrow nudge 10px<br />
            Drag handles to resize
          </div>
        </div>

        {/* CENTER - canvas area */}
        <div
          style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 32px', background: '#2D3748' }}
          onClick={() => setSelected(null)}
        >
          {/* Canvas */}
          <div
            style={{
              width: canvasW,
              height: canvasH,
              position: 'relative',
              flexShrink: 0,
              background: bgPath
                ? `url(/api/documents/backgrounds/${bgPath}) center/100% 100% no-repeat`
                : '#fff',
              boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
              userSelect: 'none',
              cursor: 'default',
              overflow: 'visible',
              transform: `scale(${zoom})`,
              transformOrigin: 'top center',
              transition: 'transform 0.12s ease',
              // Keep surrounding scroll area sized to scaled canvas
              marginBottom: canvasH * zoom - canvasH,
            }}
            onClick={e => { e.stopPropagation(); setSelected(null) }}
          >
            {!bgPath && elements.length === 0 && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', pointerEvents: 'none' }}>
                <span style={{ marginBottom: 16, opacity: 0.4 }}><LayoutTemplate size={56} /></span>
                <p style={{ fontSize: 15, opacity: 0.5 }}>Upload a background image</p>
                <p style={{ fontSize: 13, marginTop: 6, opacity: 0.35 }}>Then add text fields and drag them into position</p>
              </div>
            )}

            {elements.map(el => {
              const isSelected = selected === el.id
              const elW = el.width
              const elH = el.fontSize * 1.35

              return (
                <div
                  key={el.id}
                  style={{
                    position: 'absolute',
                    left: el.x,
                    top:  el.y,
                    width: elW,
                    height: elH,
                    overflow: 'visible',
                    zIndex: isSelected ? 20 : 1,
                  }}
                >
                  {/* Text label - drag to move */}
                  <div
                    onMouseDown={ev => startMove(ev, el.id)}
                    onClick={ev => { ev.stopPropagation(); setSelected(el.id) }}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      fontFamily:  fontStack(el.fontFamily),
                      fontSize:    el.fontSize,
                      fontWeight:  el.fontWeight,
                      fontStyle:   el.fontStyle,
                      color:       el.fill,
                      textAlign:   el.textAlign,
                      whiteSpace:  'nowrap',
                      lineHeight:  1.35,
                      cursor:      'move',
                      outline:     isSelected ? '2px dashed #0073BB' : '1px dashed rgba(0,115,187,0.4)',
                      background:  isSelected ? 'rgba(0,115,187,0.06)' : 'transparent',
                      borderRadius: 2,
                    }}
                  >
                    {`{{${el.tag}}}`}
                  </div>

                  {/* Resize handles - only when selected */}
                  {isSelected && (
                    <>
                      <div onMouseDown={ev => startResize(ev, el.id, 'w')}  style={handle(-H_SIZE / 2, elH / 2 - H_SIZE / 2, 'ew-resize')} />
                      <div onMouseDown={ev => startResize(ev, el.id, 'e')}  style={handle(elW - H_SIZE / 2, elH / 2 - H_SIZE / 2, 'ew-resize')} />
                      <div onMouseDown={ev => startResize(ev, el.id, 'sw')} style={handle(-H_SIZE / 2, elH - H_SIZE / 2, 'sw-resize')} />
                      <div onMouseDown={ev => startResize(ev, el.id, 'se')} style={handle(elW - H_SIZE / 2, elH - H_SIZE / 2, 'se-resize')} />
                      <div onMouseDown={ev => startMove(ev, el.id)}         style={handle(-H_SIZE / 2, -H_SIZE / 2, 'nw-resize')} />
                      <div onMouseDown={ev => startMove(ev, el.id)}         style={handle(elW - H_SIZE / 2, -H_SIZE / 2, 'ne-resize')} />
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* RIGHT SIDEBAR - selected element properties */}
        <div style={{ width: 244, background: '#16191F', borderLeft: '1px solid #2D3748', overflowY: 'auto', padding: 16, flexShrink: 0 }}>
          {!selectedEl ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', paddingTop: 48 }}>
              <div style={{ marginBottom: 10, opacity: 0.5, display: 'flex', justifyContent: 'center' }}><Move size={28} /></div>
              Click a text field to edit its properties
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}>FIELD PROPERTIES</span>
                <button onClick={deleteSelected} style={{ background: 'transparent', border: '1px solid rgba(209,50,18,0.5)', borderRadius: 4, padding: '3px 8px', fontSize: 11, color: '#FF6B6B', cursor: 'pointer' }}>Delete</button>
              </div>

              <div>
                <label style={darkPropLabelStyle}>TAG NAME</label>
                <input
                  value={selectedEl.tag}
                  onChange={e => updateSelected({ tag: e.target.value.replace(/\s+/g, '_').replace(/[^a-z0-9_]/gi, '') })}
                  placeholder="e.g. candidate_name"
                  style={{ ...darkInputStyle, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}
                />
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 3 }}>Maps to CSV column header</p>
              </div>

              <div>
                <label style={darkPropLabelStyle}>FONT</label>
                <FontPicker
                  value={selectedEl.fontFamily}
                  onChange={family => updateSelected({ fontFamily: family ?? 'Arial' })}
                  t={FONT_PICKER_THEME}
                  allowDefault={false}
                  variant="field"
                />
              </div>

              <div>
                <label style={darkPropLabelStyle}>SIZE</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="range" min={8} max={120} value={selectedEl.fontSize} onChange={e => updateSelected({ fontSize: +e.target.value })} style={{ flex: 1, accentColor: '#0073BB' }} />
                  <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: '#fff', width: 28, textAlign: 'right' }}>{selectedEl.fontSize}</span>
                </div>
              </div>

              <div>
                <label style={darkPropLabelStyle}>WIDTH (px)</label>
                <input type="number" value={Math.round(selectedEl.width)} onChange={e => updateSelected({ width: Math.max(40, +e.target.value) })} style={darkInputStyle} />
              </div>

              <div>
                <label style={darkPropLabelStyle}>COLOR</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="color" value={selectedEl.fill} onChange={e => updateSelected({ fill: e.target.value })}
                    style={{ width: 36, height: 32, borderRadius: 5, border: '1px solid #2D3748', cursor: 'pointer', padding: 2, background: 'transparent' }} />
                  <input value={selectedEl.fill} onChange={e => updateSelected({ fill: e.target.value })}
                    style={{ ...darkInputStyle, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }} />
                </div>
              </div>

              <div>
                <label style={darkPropLabelStyle}>STYLE</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => updateSelected({ fontWeight: selectedEl.fontWeight === 'bold' ? 'normal' : 'bold' })}
                    style={{ flex: 1, border: `1px solid ${selectedEl.fontWeight === 'bold' ? '#0073BB' : '#2D3748'}`, borderRadius: 5, padding: 6, fontSize: 14, fontWeight: 'bold', cursor: 'pointer', background: selectedEl.fontWeight === 'bold' ? '#0073BB' : 'rgba(255,255,255,0.05)', color: '#fff' }}
                  >B</button>
                  <button
                    onClick={() => updateSelected({ fontStyle: selectedEl.fontStyle === 'italic' ? 'normal' : 'italic' })}
                    style={{ flex: 1, border: `1px solid ${selectedEl.fontStyle === 'italic' ? '#0073BB' : '#2D3748'}`, borderRadius: 5, padding: 6, fontSize: 14, fontStyle: 'italic', cursor: 'pointer', background: selectedEl.fontStyle === 'italic' ? '#0073BB' : 'rgba(255,255,255,0.05)', color: '#fff' }}
                  >I</button>
                </div>
              </div>

              <div>
                <label style={darkPropLabelStyle}>ALIGNMENT</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['left', 'center', 'right'] as const).map(align => (
                    <button
                      key={align}
                      onClick={() => updateSelected({ textAlign: align })}
                      style={{ flex: 1, border: `1px solid ${selectedEl.textAlign === align ? '#0073BB' : '#2D3748'}`, borderRadius: 5, padding: '6px 4px', fontSize: 11, cursor: 'pointer', background: selectedEl.textAlign === align ? '#0073BB' : 'rgba(255,255,255,0.05)', color: '#fff' }}
                    >
                      {align === 'left' ? '⬛▪▪' : align === 'center' ? '▪⬛▪' : '▪▪⬛'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={darkPropLabelStyle}>POSITION</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>X</span>
                    <input type="number" value={Math.round(selectedEl.x)} onChange={e => updateSelected({ x: +e.target.value })}
                      style={{ ...darkInputStyle, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Y</span>
                    <input type="number" value={Math.round(selectedEl.y)} onChange={e => updateSelected({ y: +e.target.value })}
                      style={{ ...darkInputStyle, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Style helpers (dark theme) ─────────────────────────────────────────────────
const darkLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.45)',
  display: 'block', marginBottom: 5, letterSpacing: '0.06em',
}
const darkInputStyle: React.CSSProperties = {
  width: '100%', border: '1px solid #2D3748', borderRadius: 6,
  padding: '7px 10px', fontSize: 13, color: '#fff',
  background: '#0D1117', boxSizing: 'border-box',
}
const darkSelectStyle: React.CSSProperties = {
  width: '100%', border: '1px solid #2D3748', borderRadius: 6,
  padding: '7px 10px', fontSize: 13, color: '#fff',
  background: '#0D1117',
}
const darkPropLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)',
  display: 'block', marginBottom: 4, letterSpacing: '0.06em',
}

function handle(left: number, top: number, cursor: string): React.CSSProperties {
  return {
    position: 'absolute',
    left, top,
    width:  H_SIZE, height: H_SIZE,
    background:   '#fff',
    border:       '2px solid #0073BB',
    borderRadius: 2,
    cursor,
    zIndex: 30,
  }
}

export default TemplateEditorSlideOver
