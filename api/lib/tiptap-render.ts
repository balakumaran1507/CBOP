// Shared Tiptap-JSON → HTML renderer. Used by both Document Studio templates
// (api/routes/templates.ts, which layers company-letterhead placeholders on
// top via `onUnhandled`) and Email Studio designs (api/lib/email-designs.ts).

export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  text?: string
}

export type RenderMode = 'pdf' | 'email'

export function esc(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function getAlign(attrs?: Record<string, unknown>): string {
  return attrs?.textAlign ? ` style="text-align:${attrs.textAlign}"` : ''
}

export function applyMarks(text: string, marks: { type: string; attrs?: Record<string, unknown> }[]): string {
  let out = text
  for (const m of marks) {
    if (m.type === 'bold')      out = `<strong>${out}</strong>`
    if (m.type === 'italic')    out = `<em>${out}</em>`
    if (m.type === 'underline') out = `<u>${out}</u>`
    if (m.type === 'strike')    out = `<s>${out}</s>`
    if (m.type === 'code')      out = `<code>${out}</code>`
    if (m.type === 'link')      out = `<a href="${esc(String(m.attrs?.href ?? ''))}">${out}</a>`
    if (m.type === 'textStyle') {
      const style: string[] = []
      if (m.attrs?.color)      style.push(`color:${esc(String(m.attrs.color))}`)
      if (m.attrs?.fontFamily) style.push(`font-family:'${esc(String(m.attrs.fontFamily))}',sans-serif`)
      if (style.length) out = `<span style="${style.join(';')}">${out}</span>`
    }
  }
  return out
}

/** Walks a Tiptap doc collecting every distinct `textStyle.fontFamily` mark value. */
export function collectFontFamilies(node: TiptapNode, found: Set<string> = new Set()): string[] {
  for (const mark of node.marks ?? []) {
    if (mark.type === 'textStyle' && mark.attrs?.fontFamily) found.add(String(mark.attrs.fontFamily))
  }
  for (const child of node.content ?? []) collectFontFamilies(child, found)
  return [...found]
}

/**
 * Renders the generic Tiptap node types shared by every Tiptap-JSON-backed
 * renderer in CBOP. `onUnhandled` lets a caller layer its own extra node
 * types (e.g. Document Studio's `imagePlaceholder`/`pageBreak`) on top
 * without forking this function - it's called for any node type not
 * handled here, with the same recursive renderer passed back so nested
 * content can still be rendered generically.
 */
export function renderTiptapNode(
  node: TiptapNode,
  vars: Record<string, string>,
  mode: RenderMode,
  onUnhandled?: (node: TiptapNode) => string,
): string {
  const render = (n: TiptapNode) => renderTiptapNode(n, vars, mode, onUnhandled)
  const ch = () => (node.content ?? []).map(render).join('')

  switch (node.type) {
    case 'doc':            return ch()
    case 'paragraph':      return `<p${getAlign(node.attrs)}>${ch() || '&nbsp;'}</p>`
    case 'heading': {
      const lvl = Number(node.attrs?.level ?? 1)
      return `<h${lvl}${getAlign(node.attrs)}>${ch()}</h${lvl}>`
    }
    case 'bulletList':     return `<ul>${ch()}</ul>`
    case 'orderedList':    return `<ol>${ch()}</ol>`
    case 'listItem':       return `<li>${ch()}</li>`
    case 'blockquote':     return `<blockquote>${ch()}</blockquote>`
    case 'codeBlock':      return `<pre><code>${ch()}</code></pre>`
    case 'horizontalRule': return `<hr>`
    case 'hardBreak':      return `<br>`
    case 'table':          return `<table>${ch()}</table>`
    case 'tableRow':       return `<tr>${ch()}</tr>`
    case 'tableCell':      return `<td colspan="${node.attrs?.colspan ?? 1}" rowspan="${node.attrs?.rowspan ?? 1}">${ch()}</td>`
    case 'tableHeader':    return `<th colspan="${node.attrs?.colspan ?? 1}" rowspan="${node.attrs?.rowspan ?? 1}">${ch()}</th>`
    case 'image': {
      const src   = String(node.attrs?.src ?? '')
      const alt   = esc(String(node.attrs?.alt ?? ''))
      const width = node.attrs?.width ? ` width="${esc(String(node.attrs.width))}"` : ''
      return `<img src="${esc(src)}" alt="${alt}"${width} style="max-width:100%;height:auto;display:block;">`
    }
    case 'text': {
      const escaped = esc(node.text ?? '')
      // Also resolve {{var}} typed/pasted as literal text, not just the dedicated
      // `variable` chip node - otherwise content that bypasses the Insert Field
      // picker (typed directly, or pasted in) silently never gets substituted and
      // ships as literal "{{name}}" to real recipients.
      const resolved = escaped.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
        const val = vars[key]
        return val !== undefined ? esc(val) : match
      })
      return applyMarks(resolved, node.marks ?? [])
    }
    case 'variable': {
      const varName = String(node.attrs?.variable ?? '')
      const val = vars[varName]
      if (val !== undefined) return esc(val)
      return mode === 'email'
        ? `<span style="background:#FEF3C7;color:#92400E;border-radius:3px;padding:0 4px;font-size:0.9em;">{{${varName}}}</span>`
        : `<span class="var-chip">{{${varName}}}</span>`
    }
    default:
      return onUnhandled ? onUnhandled(node) : ch()
  }
}
