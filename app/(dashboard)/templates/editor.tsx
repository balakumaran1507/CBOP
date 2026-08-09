'use client'

import { useEditor, EditorContent, Editor, Node, mergeAttributes, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
import { TextStyle } from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import { useState, useCallback, useRef, useContext, createContext, useEffect } from 'react'
import {
  ArrowLeft, Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Table as TableIcon, Image as ImageIcon, Minus, AlignLeft, AlignCenter,
  AlignRight, Heading1, Heading2, Heading3, Scissors,
  Download, Eye, EyeOff, ChevronDown, ChevronRight, Moon, Sun, Trash2,
} from 'lucide-react'
import { FontPicker } from './font-picker'
import { loadGoogleFont } from './fonts'

// ── Types ─────────────────────────────────────────────────────────────────────

type TemplateType = 'invoice' | 'proposal' | 'contract' | 'nda' | 'mou' | 'email' | 'onboarding'
type OutputType   = 'pdf' | 'email' | 'both'
type PageSize     = 'A4' | 'A3' | 'Letter'
type Theme        = 'light' | 'dark'

interface PageConfig {
  margins: { top: number; right: number; bottom: number; left: number }
  pageSize: PageSize
  headerHtml: string
  footerHtml: string
}

interface Company { id: string; name: string; logo_url?: string | null; address?: string | null; gstin?: string | null }

export interface TemplateEditorProps {
  template?: {
    id: string
    name: string
    type: TemplateType
    output_type: OutputType
    company_id: string
    content_json?: object
    page_config?: PageConfig
    slug?: string
  } | null
  companies: Company[]
  onClose: () => void
  onSaved: () => void
}

// ── Theme tokens ──────────────────────────────────────────────────────────────

const THEME = {
  light: {
    panelBg: '#FAFBFC',
    panelBorder: '#E5E7EB',
    canvasBg: '#F0F2F5',
    documentBg: '#ffffff',
    documentShadow: '0 2px 12px rgba(0,0,0,0.09)',
    toolbarBg: '#FAFBFC',
    toolbarBorder: '#E5E7EB',
    textPrimary: '#111827',
    textSecondary: '#6B7280',
    textMuted: '#9CA3AF',
    inputBg: '#ffffff',
    inputBorder: '#D1D5DB',
    inputColor: '#111827',
    btnActiveBg: '#E8F4FB',
    btnActiveColor: '#0073BB',
    btnDisabledColor: '#D1D5DB',
    btnColor: '#374151',
    divider: '#E5E7EB',
    editorText: '#1a1a1a',
    chipBg: '#FEF3C7',
    chipColor: '#92400E',
    chipBorder: '#FDE68A',
    imgPlaceholderBg: '#F9FAFB',
    imgPlaceholderBorder: '#D1D5DB',
    imgPlaceholderMuted: '#9CA3AF',
    imgPlaceholderLabel: '#6B7280',
    pageBreakBorder: '#D1D5DB',
    pageBreakMuted: '#9CA3AF',
    sectionTitle: '#374151',
    imgBtnBg: '#F3F4F6',
    imgBtnBorder: '#E5E7EB',
    imgBtnColor: '#374151',
    proseCode: '#F3F4F6',
    proseBorder: '#E5E7EB',
    proseTh: '#F8F9FA',
    proseBlockquote: '#6B7280',
    labelColor: '#6B7280',
    marginLabel: '#9CA3AF',
  },
  dark: {
    panelBg: '#1C2128',
    panelBorder: '#30363D',
    canvasBg: '#0D1117',
    documentBg: '#161B22',
    documentShadow: '0 2px 16px rgba(0,0,0,0.5)',
    toolbarBg: '#1C2128',
    toolbarBorder: '#30363D',
    textPrimary: '#E6EDF3',
    textSecondary: '#8B949E',
    textMuted: '#6E7681',
    inputBg: '#0D1117',
    inputBorder: '#30363D',
    inputColor: '#E6EDF3',
    btnActiveBg: '#1A3044',
    btnActiveColor: '#58A6FF',
    btnDisabledColor: '#3D444D',
    btnColor: '#C9D1D9',
    divider: '#30363D',
    editorText: '#E6EDF3',
    chipBg: '#3D1F00',
    chipColor: '#FCD34D',
    chipBorder: '#7C3800',
    imgPlaceholderBg: '#21262D',
    imgPlaceholderBorder: '#30363D',
    imgPlaceholderMuted: '#6E7681',
    imgPlaceholderLabel: '#8B949E',
    pageBreakBorder: '#30363D',
    pageBreakMuted: '#6E7681',
    sectionTitle: '#C9D1D9',
    imgBtnBg: '#21262D',
    imgBtnBorder: '#30363D',
    imgBtnColor: '#C9D1D9',
    proseCode: '#21262D',
    proseBorder: '#30363D',
    proseTh: '#21262D',
    proseBlockquote: '#8B949E',
    labelColor: '#8B949E',
    marginLabel: '#6E7681',
  },
}

// ── Contexts ──────────────────────────────────────────────────────────────────

const ThemeCtx = createContext<Theme>('dark')

interface PlaceholderAssets {
  company_logo?: string | null
  header_banner?: string | null
  footer_strip?: string | null
  signature?: string | null
  // company info for letterhead rendering
  company_name?: string
  company_address?: string | null
  company_gstin?: string | null
}
const PlaceholderCtx = createContext<PlaceholderAssets>({})

// ── Variable definitions ──────────────────────────────────────────────────────

const VARIABLE_GROUPS = [
  { label: 'Client',       vars: ['client_name', 'client_org', 'client_email', 'client_address'] },
  { label: 'Deal/Invoice', vars: ['amount', 'amount_in_words', 'service_description', 'service_desc', 'scope_note', 'gstin', 'gst_type', 'cgst', 'sgst', 'igst', 'upi_id'] },
  { label: 'Company',      vars: ['company_name'] },
  { label: 'Dates',        vars: ['date', 'due_date', 'start_date', 'interview_date', 'interview_time'] },
  { label: 'Hiring',       vars: ['applicant_name', 'role_title', 'meet_link', 'interviewer_name', 'team_lead_name', 'team_lead_email'] },
]

const IMAGE_PLACEHOLDERS = [
  { key: 'company_logo',  label: 'Company Logo' },
  { key: 'header_banner', label: 'Header Banner' },
  { key: 'footer_strip',  label: 'Footer Strip' },
  { key: 'signature',     label: 'Signature' },
]

// ── VariableChip extension ────────────────────────────────────────────────────

function VariableChipView({ node }: { node: { attrs: { variable: string } } }) {
  const theme = useContext(ThemeCtx)
  const t = THEME[theme]
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <span
        contentEditable={false}
        style={{
          display: 'inline-flex', alignItems: 'center',
          background: t.chipBg, color: t.chipColor,
          borderRadius: '4px', padding: '1px 6px',
          fontSize: '0.85em', fontWeight: 500,
          fontFamily: 'IBM Plex Mono, monospace',
          userSelect: 'none', cursor: 'default',
          border: `1px solid ${t.chipBorder}`,
          lineHeight: 1.4,
        }}
      >
        {'{{' + node.attrs.variable + '}}'}
      </span>
    </NodeViewWrapper>
  )
}

const VariableChip = Node.create({
  name: 'variable',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() { return { variable: { default: '' } } },
  parseHTML() {
    return [{ tag: 'span[data-type="variable"]', getAttrs: el => ({ variable: (el as HTMLElement).getAttribute('data-variable') }) }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'variable', 'data-variable': HTMLAttributes.variable }), `{{${HTMLAttributes.variable}}}`]
  },
  addNodeView() { return ReactNodeViewRenderer(VariableChipView as any) },
})

// ── ImagePlaceholder sub-components ──────────────────────────────────────────

function HeaderBannerPreview({ assets, theme }: { assets: PlaceholderAssets; theme: Theme }) {
  const t = THEME[theme]
  const name    = assets.company_name    || 'Company Name'
  const address = assets.company_address || ''
  const gstin   = assets.company_gstin   || ''
  const logoUrl = assets.company_logo

  return (
    <div contentEditable={false} style={{
      borderTop: '4px solid #0073BB', paddingTop: 14, paddingBottom: 12,
      marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      background: t.documentBg,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {logoUrl
          ? <img src={logoUrl} alt="logo" style={{ height: 48, maxWidth: 130, objectFit: 'contain', display: 'block' }} />
          : <div style={{ width: 48, height: 48, background: '#0073BB', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 20, fontFamily: 'Inter, sans-serif' }}>
              {name[0]?.toUpperCase() ?? 'C'}
            </div>
        }
        <span style={{ fontWeight: 700, fontSize: 18, color: theme === 'dark' ? '#F9FAFB' : '#111827', fontFamily: 'Inter, sans-serif', letterSpacing: '-0.01em' }}>{name}</span>
      </div>
      <div style={{ textAlign: 'right', fontSize: 10, color: theme === 'dark' ? '#9CA3AF' : '#6B7280', fontFamily: 'Inter, sans-serif', lineHeight: 1.7 }}>
        {address && <div>{address}</div>}
        {gstin   && <div>GSTIN: {gstin}</div>}
        {!address && !gstin && <div style={{ opacity: 0.5 }}>address · GSTIN</div>}
      </div>
    </div>
  )
}

function FooterStripPreview({ assets, theme }: { assets: PlaceholderAssets; theme: Theme }) {
  const name    = assets.company_name    || 'Company Name'
  const address = assets.company_address || ''
  const gstin   = assets.company_gstin   || ''
  const parts   = [name, address, gstin ? `GSTIN: ${gstin}` : ''].filter(Boolean)

  return (
    <div contentEditable={false} style={{
      borderTop: '1.5px solid #E5E7EB', marginTop: 16, paddingTop: 8,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      fontSize: 10, color: theme === 'dark' ? '#9CA3AF' : '#6B7280',
      fontFamily: 'Inter, sans-serif',
    }}>
      {parts.map((p, i) => <span key={i}>{p}</span>)}
    </div>
  )
}

function CompanyLogoPreview({ assets }: { assets: PlaceholderAssets }) {
  const logoUrl = assets.company_logo
  if (logoUrl) {
    return (
      <div contentEditable={false} style={{ margin: '4px 0' }}>
        <img src={logoUrl} alt="Company Logo" style={{ maxHeight: 80, maxWidth: 200, objectFit: 'contain', display: 'block' }} />
      </div>
    )
  }
  return (
    <div contentEditable={false} style={{
      width: 160, height: 60, background: '#F3F4F6',
      border: '1.5px dashed #D1D5DB', borderRadius: 4,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, color: '#9CA3AF', fontFamily: 'IBM Plex Mono, monospace',
    }}>
      Company Logo
    </div>
  )
}

function SignaturePreview({ assets, theme }: { assets: PlaceholderAssets; theme: Theme }) {
  const name = assets.company_name || 'Authorised Signatory'
  return (
    <div contentEditable={false} style={{ marginTop: 16 }}>
      <div style={{ width: 180, height: 52, borderBottom: `1.5px solid ${theme === 'dark' ? '#6B7280' : '#374151'}`, marginBottom: 4 }} />
      <div style={{ fontSize: 11, color: theme === 'dark' ? '#9CA3AF' : '#374151', fontFamily: 'Inter, sans-serif' }}>{name}</div>
    </div>
  )
}

// ── ImagePlaceholder extension ────────────────────────────────────────────────

function ImagePlaceholderView({ node }: { node: { attrs: { placeholder: string; label: string } } }) {
  const theme    = useContext(ThemeCtx)
  const assets   = useContext(PlaceholderCtx)
  const t        = THEME[theme]
  const ph       = node.attrs.placeholder

  switch (ph) {
    case 'header_banner':
      return (
        <NodeViewWrapper>
          <HeaderBannerPreview assets={assets} theme={theme} />
        </NodeViewWrapper>
      )
    case 'footer_strip':
      return (
        <NodeViewWrapper>
          <FooterStripPreview assets={assets} theme={theme} />
        </NodeViewWrapper>
      )
    case 'company_logo':
      return (
        <NodeViewWrapper>
          <CompanyLogoPreview assets={assets} />
        </NodeViewWrapper>
      )
    case 'signature':
      return (
        <NodeViewWrapper>
          <SignaturePreview assets={assets} theme={theme} />
        </NodeViewWrapper>
      )
    default:
      return (
        <NodeViewWrapper>
          <div
            contentEditable={false}
            style={{
              background: t.imgPlaceholderBg, border: `1.5px dashed ${t.imgPlaceholderBorder}`,
              borderRadius: '6px', padding: '20px 16px',
              textAlign: 'center', color: t.imgPlaceholderMuted,
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px',
              margin: '8px 0', userSelect: 'none',
            }}
          >
            <ImageIcon size={22} style={{ marginBottom: 6, opacity: 0.4 }} />
            <div style={{ fontWeight: 600, color: t.imgPlaceholderLabel }}>{node.attrs.label}</div>
          </div>
        </NodeViewWrapper>
      )
  }
}

const ImagePlaceholder = Node.create({
  name: 'imagePlaceholder',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      placeholder: { default: 'company_logo' },
      label:       { default: 'Company Logo' },
    }
  },
  parseHTML() { return [{ tag: 'div[data-type="image-placeholder"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'image-placeholder' })] },
  addNodeView() { return ReactNodeViewRenderer(ImagePlaceholderView as any) },
})

// ── PageBreak extension ───────────────────────────────────────────────────────

function PageBreakView() {
  const theme = useContext(ThemeCtx)
  const t = THEME[theme]
  return (
    <NodeViewWrapper>
      <div contentEditable={false} style={{ userSelect: 'none', margin: '12px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, borderTop: `2px dashed ${t.pageBreakBorder}` }} />
          <span style={{ fontSize: '11px', color: t.pageBreakMuted, fontFamily: 'IBM Plex Mono, monospace', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Scissors size={12} /> page break
          </span>
          <div style={{ flex: 1, borderTop: `2px dashed ${t.pageBreakBorder}` }} />
        </div>
      </div>
    </NodeViewWrapper>
  )
}

const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  parseHTML()  { return [{ tag: 'div[data-type="page-break"]' }] },
  renderHTML() { return ['div', { 'data-type': 'page-break', style: 'page-break-after:always;height:0;' }] },
  addNodeView() { return ReactNodeViewRenderer(PageBreakView as any) },
})

// ── Resizable image node view ─────────────────────────────────────────────────

function ImageNodeView({ node, selected, deleteNode, updateAttributes }: {
  node: { attrs: { src: string; alt?: string; width?: string } }
  selected: boolean
  deleteNode: () => void
  updateAttributes: (a: Record<string, string | null>) => void
}) {
  const [hovered, setHovered] = useState(false)
  const imgRef   = useRef<HTMLImageElement>(null)
  const showUI   = selected || hovered
  const curWidth = node.attrs.width ?? '100%'

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = imgRef.current?.offsetWidth ?? 300

    const onMove = (me: MouseEvent) => {
      const newW = Math.max(60, startW + (me.clientX - startX))
      if (imgRef.current) imgRef.current.style.width = `${newW}px`
    }
    const onUp = (me: MouseEvent) => {
      const newW = Math.max(60, startW + (me.clientX - startX))
      updateAttributes({ width: `${newW}px` })
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleStyle: React.CSSProperties = {
    position: 'absolute', background: '#0073BB',
    boxShadow: '0 0 0 2px #fff, 0 0 0 3px #0073BB',
    borderRadius: 3, cursor: 'ew-resize', zIndex: 10,
  }

  return (
    <NodeViewWrapper>
      <div
        style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', margin: '4px 0' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <img
          ref={imgRef}
          src={node.attrs.src}
          alt={node.attrs.alt ?? ''}
          draggable={false}
          style={{
            width: curWidth, height: 'auto', display: 'block', borderRadius: 4,
            outline: selected ? '2px solid #0073BB' : showUI ? '1.5px solid rgba(0,115,187,0.4)' : '2px solid transparent',
            userSelect: 'none',
          }}
        />

        {/* Right-center drag handle */}
        {showUI && (
          <div
            onMouseDown={startResize}
            style={{ ...handleStyle, right: -5, top: '50%', transform: 'translateY(-50%)', width: 10, height: 32, cursor: 'ew-resize' }}
          />
        )}

        {/* Bottom-right corner drag handle */}
        {showUI && (
          <div
            onMouseDown={startResize}
            style={{ ...handleStyle, right: -5, bottom: -5, width: 12, height: 12, cursor: 'nwse-resize' }}
          />
        )}

        {/* Top controls bar */}
        {showUI && (
          <div style={{
            position: 'absolute', top: 6, right: 6,
            display: 'flex', gap: 3, alignItems: 'center',
            background: 'rgba(0,0,0,0.78)', borderRadius: 5, padding: '3px 5px',
          }}>
            {(['25%', '50%', '75%', '100%'] as const).map(w => (
              <button
                key={w} type="button"
                onMouseDown={e => { e.preventDefault(); updateAttributes({ width: w }) }}
                style={{
                  fontSize: 10, fontFamily: 'IBM Plex Mono, monospace',
                  background: curWidth === w ? '#0073BB' : 'rgba(255,255,255,0.12)',
                  color: '#fff', border: 'none', cursor: 'pointer',
                  borderRadius: 3, padding: '2px 6px', lineHeight: 1.5,
                }}
              >
                {w}
              </button>
            ))}
            <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.2)', margin: '0 2px' }} />
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); deleteNode() }}
              style={{ background: '#D13212', border: 'none', cursor: 'pointer', borderRadius: 3, padding: '2px 5px', color: '#fff', display: 'flex', alignItems: 'center' }}
              title="Delete image"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: '100%' },
    }
  },
  addNodeView() { return ReactNodeViewRenderer(ImageNodeView as any) },
})

// ── Toolbar button ────────────────────────────────────────────────────────────

function TB({
  onClick, active, disabled, title, children, t,
}: {
  onClick: () => void; active?: boolean; disabled?: boolean
  title?: string; children: React.ReactNode; t: typeof THEME.light
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 28, borderRadius: 4, border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: active ? t.btnActiveBg : 'transparent',
        color: active ? t.btnActiveColor : disabled ? t.btnDisabledColor : t.btnColor,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}

function Divider({ t }: { t: typeof THEME.light }) {
  return <div style={{ width: 1, height: 20, background: t.divider, margin: '0 3px', flexShrink: 0 }} />
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function Toolbar({ editor, onInsertImage, outputType, t }: {
  editor: Editor; onInsertImage: () => void; outputType: OutputType; t: typeof THEME.light
}) {
  const isPdf = outputType !== 'email'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 2,
      padding: '6px 16px', borderBottom: `1px solid ${t.toolbarBorder}`,
      background: t.toolbarBg, flexWrap: 'wrap', flexShrink: 0,
    }}>
      <TB t={t} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1"><Heading1 size={15} /></TB>
      <TB t={t} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2"><Heading2 size={15} /></TB>
      <TB t={t} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3"><Heading3 size={15} /></TB>
      <Divider t={t} />
      <FontPicker
        value={(editor.getAttributes('textStyle').fontFamily as string | undefined) ?? null}
        onChange={family => {
          if (family) editor.chain().focus().setFontFamily(family).run()
          else editor.chain().focus().unsetFontFamily().run()
        }}
        t={t}
      />
      <Divider t={t} />
      <TB t={t} onClick={() => editor.chain().focus().toggleBold().run()}      active={editor.isActive('bold')}      title="Bold"><Bold size={14} /></TB>
      <TB t={t} onClick={() => editor.chain().focus().toggleItalic().run()}    active={editor.isActive('italic')}    title="Italic"><Italic size={14} /></TB>
      <TB t={t} onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline"><UnderlineIcon size={14} /></TB>
      <TB t={t} onClick={() => editor.chain().focus().toggleStrike().run()}    active={editor.isActive('strike')}    title="Strikethrough">
        <span style={{ fontSize: 13, fontWeight: 600, textDecoration: 'line-through' }}>S</span>
      </TB>
      <Divider t={t} />
      <TB t={t} onClick={() => editor.chain().focus().toggleBulletList().run()}  active={editor.isActive('bulletList')}  title="Bullet List"><List size={15} /></TB>
      <TB t={t} onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered List"><ListOrdered size={15} /></TB>
      <Divider t={t} />
      <TB t={t} onClick={() => editor.chain().focus().setTextAlign('left').run()}   active={editor.isActive({ textAlign: 'left' })}   title="Align Left"><AlignLeft size={14} /></TB>
      <TB t={t} onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align Center"><AlignCenter size={14} /></TB>
      <TB t={t} onClick={() => editor.chain().focus().setTextAlign('right').run()}  active={editor.isActive({ textAlign: 'right' })}  title="Align Right"><AlignRight size={14} /></TB>
      <Divider t={t} />
      <TB t={t} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert Table"><TableIcon size={14} /></TB>
      <TB t={t} onClick={onInsertImage} title="Insert Image"><ImageIcon size={14} /></TB>
      {isPdf && (
        <TB t={t} onClick={() => editor.chain().focus().insertContent({ type: 'pageBreak' }).run()} title="Insert Page Break">
          <Scissors size={14} />
        </TB>
      )}
      <Divider t={t} />
      <TB t={t} onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal Rule"><Minus size={14} /></TB>
    </div>
  )
}

// ── Left settings panel ───────────────────────────────────────────────────────

const TYPE_LABELS: Record<TemplateType, string> = {
  invoice: 'Invoice', proposal: 'Proposal', contract: 'Contract',
  nda: 'NDA', mou: 'MOU', email: 'Email', onboarding: 'Onboarding',
}

function MarginInput({ label, value, onChange, t }: { label: string; value: number; onChange: (v: number) => void; t: typeof THEME.light }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10, color: t.marginLabel, marginBottom: 2 }}>{label}</div>
      <input
        type="number" min={0} max={200} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', border: `1px solid ${t.inputBorder}`, borderRadius: 5, padding: '4px 6px', fontSize: 12, color: t.inputColor, background: t.inputBg, boxSizing: 'border-box' as const }}
      />
    </div>
  )
}

function SettingsPanel({
  name, setName, type, setType, outputType, setOutputType,
  companyId, setCompanyId, pageConfig, setPageConfig, companies, t,
}: {
  name: string; setName: (v: string) => void
  type: TemplateType; setType: (v: TemplateType) => void
  outputType: OutputType; setOutputType: (v: OutputType) => void
  companyId: string; setCompanyId: (v: string) => void
  pageConfig: PageConfig; setPageConfig: (v: PageConfig) => void
  companies: Company[]; t: typeof THEME.light
}) {
  const [pageOpen, setPageOpen] = useState(false)
  const setMargin = (side: keyof PageConfig['margins'], val: number) =>
    setPageConfig({ ...pageConfig, margins: { ...pageConfig.margins, [side]: val } })

  const inputSt: React.CSSProperties = {
    width: '100%', border: `1px solid ${t.inputBorder}`, borderRadius: 5,
    padding: '6px 9px', fontSize: 13, color: t.inputColor,
    background: t.inputBg, boxSizing: 'border-box' as const,
  }
  const labelSt: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 600, color: t.labelColor,
    marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase' as const,
  }

  return (
    <div style={{ width: 220, background: t.panelBg, borderRight: `1px solid ${t.panelBorder}`, overflowY: 'auto', padding: '20px 16px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={labelSt}>Template Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Service Proposal" style={inputSt} />
      </div>
      <div>
        <label style={labelSt}>Type</label>
        <select value={type} onChange={e => setType(e.target.value as TemplateType)} style={inputSt}>
          {(Object.keys(TYPE_LABELS) as TemplateType[]).map(tp => (
            <option key={tp} value={tp}>{TYPE_LABELS[tp]}</option>
          ))}
        </select>
      </div>
      <div>
        <label style={labelSt}>Company</label>
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={inputSt}>
          <option value="">Select…</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label style={labelSt}>Output</label>
        <select value={outputType} onChange={e => setOutputType(e.target.value as OutputType)} style={inputSt}>
          <option value="pdf">PDF Document</option>
          <option value="email">Email</option>
          <option value="both">Both (PDF + Email)</option>
        </select>
      </div>
      {outputType !== 'email' && (
        <div>
          <button
            type="button" onClick={() => setPageOpen(p => !p)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <span style={labelSt}>Page Config</span>
            {pageOpen ? <ChevronDown size={12} color={t.textMuted} /> : <ChevronRight size={12} color={t.textMuted} />}
          </button>
          {pageOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              <div>
                <div style={{ ...labelSt, marginBottom: 4 }}>Page Size</div>
                <select value={pageConfig.pageSize} onChange={e => setPageConfig({ ...pageConfig, pageSize: e.target.value as PageSize })} style={inputSt}>
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
                  <option value="Letter">Letter</option>
                </select>
              </div>
              <div>
                <div style={{ ...labelSt, marginBottom: 4 }}>Margins (px)</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <MarginInput label="Top"    value={pageConfig.margins.top}    onChange={v => setMargin('top', v)}    t={t} />
                  <MarginInput label="Right"  value={pageConfig.margins.right}  onChange={v => setMargin('right', v)}  t={t} />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <MarginInput label="Bottom" value={pageConfig.margins.bottom} onChange={v => setMargin('bottom', v)} t={t} />
                  <MarginInput label="Left"   value={pageConfig.margins.left}   onChange={v => setMargin('left', v)}   t={t} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Right variable/placeholder panel ─────────────────────────────────────────

function VariablePanel({ editor, t }: { editor: Editor; t: typeof THEME.light }) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(VARIABLE_GROUPS.map(g => [g.label, true]))
  )

  const insertVariable   = (varName: string) => editor.chain().focus().insertContent({ type: 'variable', attrs: { variable: varName } }).run()
  const insertPlaceholder = (key: string, label: string) => editor.chain().focus().insertContent({ type: 'imagePlaceholder', attrs: { placeholder: key, label } }).run()
  const toggleGroup = (label: string) => setOpenGroups(p => ({ ...p, [label]: !p[label] }))

  return (
    <div style={{ width: 220, background: t.panelBg, borderLeft: `1px solid ${t.panelBorder}`, overflowY: 'auto', padding: '16px 12px', flexShrink: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: t.sectionTitle, marginBottom: 14, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        Variables
      </div>
      {VARIABLE_GROUPS.map(group => (
        <div key={group.label} style={{ marginBottom: 12 }}>
          <button
            type="button" onClick={() => toggleGroup(group.label)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', width: '100%' }}
          >
            {openGroups[group.label] ? <ChevronDown size={11} color={t.textMuted} /> : <ChevronRight size={11} color={t.textMuted} />}
            <span style={{ fontSize: 10, fontWeight: 700, color: t.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{group.label}</span>
          </button>
          {openGroups[group.label] && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, paddingLeft: 2 }}>
              {group.vars.map(v => (
                <button
                  key={v} type="button" onClick={() => insertVariable(v)} title={`Insert {{${v}}}`}
                  style={{ background: t.chipBg, border: `1px solid ${t.chipBorder}`, borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: t.chipColor, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {'{{' + v + '}}'}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      <div style={{ borderTop: `1px solid ${t.panelBorder}`, paddingTop: 12, marginTop: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: t.sectionTitle, marginBottom: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Image Placeholders
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {IMAGE_PLACEHOLDERS.map(p => (
            <button
              key={p.key} type="button" onClick={() => insertPlaceholder(p.key, p.label)}
              style={{ background: t.imgBtnBg, border: `1px solid ${t.imgBtnBorder}`, borderRadius: 4, padding: '5px 8px', cursor: 'pointer', fontSize: 12, color: t.imgBtnColor, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <ImageIcon size={12} color={t.textMuted} />
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Image picker modal ────────────────────────────────────────────────────────

interface UploadedImage { name: string; url: string }

function ImagePickerModal({
  onPick, onUpload, onClose, t,
}: {
  onPick:   (url: string) => void
  onUpload: () => void
  onClose:  () => void
  t: typeof THEME.light
}) {
  const [images,  setImages]  = useState<UploadedImage[]>([])
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/templates/images', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setImages(d.images ?? []))
      .finally(() => setLoading(false))
  }, [])

  function prettify(name: string) {
    return name
      .replace(/\.[^.]+$/, '')          // remove extension
      .replace(/[-_]/g, ' ')            // dashes/underscores → spaces
      .replace(/\b\w/g, c => c.toUpperCase()) // title case
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: t.documentBg, borderRadius: 10, width: 720, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.4)', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${t.panelBorder}` }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: t.textPrimary, fontFamily: 'Syne, sans-serif' }}>Insert Image</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" onClick={onUpload}
              style={{ background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <ImageIcon size={13} /> Upload new
            </button>
            <button
              type="button" onClick={onClose}
              style={{ background: t.imgBtnBg, border: `1px solid ${t.panelBorder}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: t.textSecondary }}
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Grid */}
        <div style={{ overflowY: 'auto', padding: 20, flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: t.textMuted, padding: '40px 0', fontSize: 14 }}>Loading…</div>
          ) : images.length === 0 ? (
            <div style={{ textAlign: 'center', color: t.textMuted, padding: '40px 0', fontSize: 14 }}>
              No images uploaded yet.<br />
              <span style={{ fontSize: 12 }}>SCP files to <code style={{ background: t.proseCode, padding: '1px 6px', borderRadius: 3, fontFamily: 'IBM Plex Mono, monospace' }}>uploads/template-images/</code> or use Upload new.</span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              {images.map(img => (
                <div
                  key={img.name}
                  onClick={() => onPick(img.url)}
                  onMouseEnter={() => setHovered(img.name)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    border: `2px solid ${hovered === img.name ? '#0073BB' : t.panelBorder}`,
                    borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                    boxShadow: hovered === img.name ? '0 0 0 3px rgba(0,115,187,0.18)' : 'none',
                    background: t.imgPlaceholderBg,
                  }}
                >
                  {/* Thumbnail */}
                  <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10, background: hovered === img.name ? t.btnActiveBg : 'transparent', transition: 'background 0.15s' }}>
                    <img
                      src={img.url}
                      alt={img.name}
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 3 }}
                    />
                  </div>
                  {/* Name */}
                  <div style={{ padding: '6px 8px', borderTop: `1px solid ${t.panelBorder}` }}>
                    <div style={{ fontSize: 11, color: t.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={img.name}>
                      {prettify(img.name)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Editor ───────────────────────────────────────────────────────────────

const DEFAULT_PAGE_CONFIG: PageConfig = {
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
  pageSize: 'A4',
  headerHtml: '',
  footerHtml: '',
}

export default function TemplateEditor({ template, companies, onClose, onSaved }: TemplateEditorProps) {
  const isEdit = !!template?.id

  const [name,       setName]       = useState(template?.name       ?? '')
  const [type,       setType]       = useState<TemplateType>((template?.type as TemplateType) ?? 'proposal')
  const [outputType, setOutputType] = useState<OutputType>(template?.output_type ?? 'pdf')
  const [companyId,  setCompanyId]  = useState(template?.company_id ?? companies[0]?.id ?? '')
  const [pageConfig, setPageConfig] = useState<PageConfig>(template?.page_config ?? DEFAULT_PAGE_CONFIG)
  const [saving,     setSaving]     = useState(false)
  const [exporting,  setExporting]  = useState(false)
  const [error,      setError]      = useState('')
  const [preview,    setPreview]    = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('te-theme') as Theme) ?? 'dark' } catch { return 'dark' }
  })
  const imgInputRef = useRef<HTMLInputElement>(null)

  const t = THEME[theme]

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    try { localStorage.setItem('te-theme', next) } catch { /* noop */ }
  }

  // Resolve placeholder assets from selected company
  const selectedCompany = companies.find(c => c.id === companyId)
  const placeholderAssets: PlaceholderAssets = {
    company_logo:    selectedCompany?.logo_url    ?? null,
    company_name:    selectedCompany?.name        ?? '',
    company_address: selectedCompany?.address     ?? null,
    company_gstin:   selectedCompany?.gstin       ?? null,
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      FontFamily.configure({ types: ['textStyle'] }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      ResizableImage.configure({ inline: false }),
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
      Placeholder.configure({ placeholder: 'Start writing… click a variable on the right to insert it.' }),
      VariableChip, ImagePlaceholder, PageBreak,
    ],
    content: template?.content_json ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: { attributes: { style: 'min-height:100%;outline:none;' } },
  })

  // Pre-load webfonts already used in a saved document so headings/text
  // render correctly the instant the editor mounts, not just on selection.
  useEffect(() => {
    const json = template?.content_json as { content?: unknown } | undefined
    if (!json) return
    const found = new Set<string>()
    const walk = (node: any) => {
      for (const mark of node?.marks ?? []) {
        if (mark.type === 'textStyle' && mark.attrs?.fontFamily) found.add(mark.attrs.fontFamily)
      }
      for (const child of node?.content ?? []) walk(child)
    }
    walk(json)
    found.forEach(loadGoogleFont)
  }, [template?.content_json])

  const handleImageUpload = useCallback(async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const res  = await fetch('/api/templates/upload-image', { method: 'POST', credentials: 'include', body: fd })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Upload failed'); return }
    editor?.chain().focus().setImage({ src: data.url }).run()
  }, [editor])

  const handleSave = async () => {
    if (!name.trim()) { setError('Template name is required'); return }
    if (!companyId)   { setError('Please select a company');   return }
    setSaving(true); setError('')
    try {
      const body = { name: name.trim(), type, output_type: outputType, company_id: companyId, content_json: editor?.getJSON(), page_config: pageConfig }
      const url    = isEdit ? `/api/templates/${template!.id}` : '/api/templates'
      const method = isEdit ? 'PATCH' : 'POST'
      const res    = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data   = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed'); return }
      onSaved()
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  const handleExportPdf = async () => {
    if (!isEdit) { setError('Save first to export PDF'); return }
    setExporting(true)
    try {
      const res = await fetch(`/api/templates/${template!.id}/pdf`, { credentials: 'include' })
      if (!res.ok) return
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a'); a.href = url; a.download = `${name}.pdf`; a.click()
      URL.revokeObjectURL(url)
    } finally { setExporting(false) }
  }

  const handlePreview = async () => {
    if (!isEdit) { setError('Save first to preview'); return }
    if (preview) { setPreview(false); return }
    setLoadingPreview(true)
    try {
      const res = await fetch(`/api/templates/${template!.id}/pdf`, { credentials: 'include' })
      if (res.ok) {
        const blob = await res.blob()
        setPreviewUrl(URL.createObjectURL(blob))
        setPreview(true)
      }
    } finally { setLoadingPreview(false) }
  }

  if (!editor) return null

  const topBarBtn: React.CSSProperties = {
    color: 'rgba(255,255,255,0.7)', background: 'transparent',
    border: '1px solid #2D3748', borderRadius: 6,
    padding: '5px 12px', fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' as const,
  }

  return (
    <ThemeCtx.Provider value={theme}>
      <PlaceholderCtx.Provider value={placeholderAssets}>
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: t.canvasBg, display: 'flex', flexDirection: 'column' }}>

          {/* ── TOP BAR ── */}
          <div style={{ height: 52, background: '#16191F', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10, flexShrink: 0, borderBottom: '1px solid #0D1117' }}>
            <button type="button" onClick={onClose} style={topBarBtn}>
              <ArrowLeft size={14} /> Templates
            </button>
            <span style={{ color: '#fff', fontWeight: 600, fontSize: 14, flex: 1, fontFamily: 'Syne, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name || (isEdit ? 'Edit Template' : 'New Template')}
            </span>
            {error && (
              <span style={{ fontSize: 12, color: '#FCA5A5', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, padding: '4px 10px', flexShrink: 0 }}>
                {error}
              </span>
            )}
            <button type="button" onClick={toggleTheme} title={theme === 'light' ? 'Switch to dark' : 'Switch to light'} style={{ ...topBarBtn, padding: '5px 8px' }}>
              {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
            </button>
            {isEdit && (
              <>
                <button type="button" onClick={handlePreview} disabled={loadingPreview} style={topBarBtn}>
                  {preview ? <EyeOff size={14} /> : <Eye size={14} />}
                  {loadingPreview ? 'Loading…' : preview ? 'Edit' : 'Preview'}
                </button>
                <button type="button" onClick={handleExportPdf} disabled={exporting} style={topBarBtn}>
                  <Download size={14} /> {exporting ? 'Exporting…' : 'Export PDF'}
                </button>
              </>
            )}
            <button
              type="button" onClick={handleSave} disabled={saving}
              style={{ background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 18px', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontWeight: 600, whiteSpace: 'nowrap' }}
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Template'}
            </button>
          </div>

          {/* ── BODY ── */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <SettingsPanel
              name={name} setName={setName} type={type} setType={setType}
              outputType={outputType} setOutputType={setOutputType}
              companyId={companyId} setCompanyId={setCompanyId}
              pageConfig={pageConfig} setPageConfig={setPageConfig}
              companies={companies} t={t}
            />

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: t.canvasBg }}>
              {preview ? (
                <iframe src={previewUrl} style={{ flex: 1, border: 'none', background: '#fff' }} title="Template preview" />
              ) : (
                <>
                  <Toolbar editor={editor} outputType={outputType} onInsertImage={() => setPickerOpen(true)} t={t} />
                  <div style={{ flex: 1, overflowY: 'auto', padding: '40px 64px', display: 'flex', justifyContent: 'center' }}>
                    <div style={{ width: '100%', maxWidth: 760, background: t.documentBg, boxShadow: t.documentShadow, borderRadius: 4, padding: '48px 56px', minHeight: 900 }}>
                      <style>{`
                        .ProseMirror p { margin-bottom: 12px; line-height: 1.8; font-size: 14px; color: ${t.editorText}; }
                        .ProseMirror h1 { font-size: 24px; font-weight: 700; margin-bottom: 16px; font-family: Syne, sans-serif; color: ${t.editorText}; }
                        .ProseMirror h2 { font-size: 18px; font-weight: 600; margin-bottom: 12px; font-family: Syne, sans-serif; color: ${t.editorText}; }
                        .ProseMirror h3 { font-size: 15px; font-weight: 600; margin-bottom: 10px; color: ${t.editorText}; }
                        .ProseMirror ul, .ProseMirror ol { padding-left: 22px; margin-bottom: 12px; }
                        .ProseMirror li { margin-bottom: 4px; line-height: 1.8; font-size: 14px; color: ${t.editorText}; }
                        .ProseMirror table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
                        .ProseMirror th { background: ${t.proseTh}; font-weight: 600; border: 1px solid ${t.proseBorder}; padding: 8px 10px; text-align: left; font-size: 13px; color: ${t.editorText}; }
                        .ProseMirror td { border: 1px solid ${t.proseBorder}; padding: 7px 10px; font-size: 13px; color: ${t.editorText}; }
                        .ProseMirror hr { border: none; border-top: 1px solid ${t.proseBorder}; margin: 16px 0; }
                        .ProseMirror blockquote { border-left: 3px solid ${t.proseBorder}; padding-left: 16px; margin: 12px 0; color: ${t.proseBlockquote}; }
                        .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: ${t.textMuted}; pointer-events: none; float: left; height: 0; }
                        .ProseMirror img { max-width: 100%; height: auto; }
                        .ProseMirror code { background: ${t.proseCode}; border-radius: 3px; padding: 1px 5px; font-family: IBM Plex Mono, monospace; font-size: 0.85em; color: ${t.editorText}; }
                        .ProseMirror pre { background: ${t.proseCode}; border-radius: 5px; padding: 12px; margin-bottom: 12px; }
                        .ProseMirror pre code { background: none; padding: 0; }
                      `}</style>
                      <EditorContent editor={editor} style={{ minHeight: '100%' }} />
                    </div>
                  </div>
                </>
              )}
            </div>

            <VariablePanel editor={editor} t={t} />
          </div>

          {pickerOpen && (
            <ImagePickerModal
              t={t}
              onPick={url => { editor.chain().focus().setImage({ src: url }).run(); setPickerOpen(false) }}
              onUpload={() => { setPickerOpen(false); imgInputRef.current?.click() }}
              onClose={() => setPickerOpen(false)}
            />
          )}

          <input
            ref={imgInputRef} type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = '' }}
          />
        </div>
      </PlaceholderCtx.Provider>
    </ThemeCtx.Provider>
  )
}
