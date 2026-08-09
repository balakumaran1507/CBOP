// Google Fonts catalog for the Document Studio font picker.
// "canva" flags fonts that are prominent picks in Canva's own font library
// (Canva itself ships most of these straight from Google Fonts).

export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace' | 'system'

export interface FontDef {
  family: string
  category: FontCategory
  weights: string   // Google Fonts css2 wght@ list
  canva?: boolean
  system?: boolean  // OS-installed font - never fetched from Google Fonts
  fallback?: string // CSS fallback family; defaults to CATEGORY_FALLBACK[category]
}

const W_TEXT    = '300;400;500;600;700'   // body-friendly sans/serif families
const W_DISPLAY = '400;500;600;700'       // display/headline families
const W_SCRIPT  = '400;500;600;700'       // handwriting/script (extra weights ignored if absent)
const W_MONO    = '400;500;600'

export const FONTS: FontDef[] = [
  // ── System (OS-installed, no webfont fetch) ────────────────────────────
  { family: 'Arial',           category: 'system', weights: '', system: true, fallback: 'sans-serif' },
  { family: 'Verdana',         category: 'system', weights: '', system: true, fallback: 'sans-serif' },
  { family: 'Trebuchet MS',    category: 'system', weights: '', system: true, fallback: 'sans-serif' },
  { family: 'Georgia',         category: 'system', weights: '', system: true, fallback: 'serif' },
  { family: 'Times New Roman', category: 'system', weights: '', system: true, fallback: 'serif' },
  { family: 'Courier New',     category: 'system', weights: '', system: true, fallback: 'monospace' },

  // ── Sans-serif ──────────────────────────────────────────────────────────
  { family: 'Inter',                category: 'sans-serif', weights: W_TEXT },
  { family: 'Roboto',               category: 'sans-serif', weights: W_TEXT },
  { family: 'Open Sans',            category: 'sans-serif', weights: W_TEXT },
  { family: 'Lato',                 category: 'sans-serif', weights: W_TEXT },
  { family: 'Montserrat',           category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Poppins',              category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Nunito',               category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Nunito Sans',          category: 'sans-serif', weights: W_TEXT },
  { family: 'Work Sans',            category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Rubik',                category: 'sans-serif', weights: W_TEXT },
  { family: 'Raleway',              category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Karla',                category: 'sans-serif', weights: W_TEXT },
  { family: 'Mulish',               category: 'sans-serif', weights: W_TEXT },
  { family: 'Barlow',               category: 'sans-serif', weights: W_TEXT },
  { family: 'Manrope',              category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'DM Sans',              category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Outfit',               category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Plus Jakarta Sans',    category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Urbanist',             category: 'sans-serif', weights: W_TEXT },
  { family: 'Sora',                 category: 'sans-serif', weights: W_TEXT },
  { family: 'Space Grotesk',        category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Bricolage Grotesque',  category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Figtree',              category: 'sans-serif', weights: W_TEXT },
  { family: 'Lexend',               category: 'sans-serif', weights: W_TEXT },
  { family: 'Jost',                 category: 'sans-serif', weights: W_TEXT },
  { family: 'Hind',                 category: 'sans-serif', weights: W_TEXT },
  { family: 'Heebo',                category: 'sans-serif', weights: W_TEXT },
  { family: 'Public Sans',          category: 'sans-serif', weights: W_TEXT },
  { family: 'IBM Plex Sans',        category: 'sans-serif', weights: W_TEXT },
  { family: 'Noto Sans',            category: 'sans-serif', weights: W_TEXT },
  { family: 'PT Sans',              category: 'sans-serif', weights: W_TEXT },
  { family: 'Source Sans 3',        category: 'sans-serif', weights: W_TEXT },
  { family: 'Titillium Web',        category: 'sans-serif', weights: W_TEXT },
  { family: 'Cabin',                category: 'sans-serif', weights: W_TEXT },
  { family: 'Overpass',             category: 'sans-serif', weights: W_TEXT },
  { family: 'Archivo',              category: 'sans-serif', weights: W_TEXT },
  { family: 'Josefin Sans',         category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Quicksand',            category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Comfortaa',            category: 'sans-serif', weights: W_TEXT },
  { family: 'Varela Round',         category: 'sans-serif', weights: W_DISPLAY },
  { family: 'Fredoka',              category: 'sans-serif', weights: W_TEXT },
  { family: 'Baloo 2',              category: 'sans-serif', weights: W_TEXT },
  { family: 'Assistant',            category: 'sans-serif', weights: W_TEXT },
  { family: 'Red Hat Display',      category: 'sans-serif', weights: W_TEXT },
  { family: 'Epilogue',             category: 'sans-serif', weights: W_TEXT },
  { family: 'Sen',                  category: 'sans-serif', weights: W_TEXT },
  { family: 'Be Vietnam Pro',       category: 'sans-serif', weights: W_TEXT },
  { family: 'Albert Sans',          category: 'sans-serif', weights: W_TEXT },
  { family: 'League Spartan',       category: 'sans-serif', weights: W_TEXT, canva: true },
  { family: 'Kanit',                category: 'sans-serif', weights: W_TEXT },
  { family: 'Prompt',               category: 'sans-serif', weights: W_TEXT },

  // ── Serif ───────────────────────────────────────────────────────────────
  { family: 'Playfair Display',     category: 'serif', weights: W_TEXT, canva: true },
  { family: 'Merriweather',         category: 'serif', weights: W_TEXT, canva: true },
  { family: 'Lora',                 category: 'serif', weights: W_TEXT, canva: true },
  { family: 'PT Serif',             category: 'serif', weights: W_TEXT, canva: true },
  { family: 'Source Serif 4',       category: 'serif', weights: W_TEXT },
  { family: 'Bitter',               category: 'serif', weights: W_TEXT },
  { family: 'Libre Baskerville',    category: 'serif', weights: W_TEXT, canva: true },
  { family: 'Crimson Text',         category: 'serif', weights: W_TEXT, canva: true },
  { family: 'Crimson Pro',          category: 'serif', weights: W_TEXT },
  { family: 'EB Garamond',          category: 'serif', weights: W_TEXT },
  { family: 'Cormorant',            category: 'serif', weights: W_TEXT },
  { family: 'Cormorant Garamond',   category: 'serif', weights: W_TEXT, canva: true },
  { family: 'Spectral',             category: 'serif', weights: W_TEXT },
  { family: 'Vollkorn',             category: 'serif', weights: W_TEXT },
  { family: 'Zilla Slab',           category: 'serif', weights: W_TEXT },
  { family: 'Noto Serif',           category: 'serif', weights: W_TEXT },
  { family: 'IBM Plex Serif',       category: 'serif', weights: W_TEXT },
  { family: 'Domine',               category: 'serif', weights: W_TEXT },
  { family: 'Alegreya',             category: 'serif', weights: W_TEXT },
  { family: 'Bodoni Moda',          category: 'serif', weights: W_TEXT },
  { family: 'DM Serif Display',     category: 'serif', weights: W_DISPLAY, canva: true },
  { family: 'DM Serif Text',        category: 'serif', weights: W_TEXT, canva: true },
  { family: 'Fraunces',             category: 'serif', weights: W_TEXT, canva: true },
  { family: 'Instrument Serif',     category: 'serif', weights: '400', canva: true },
  { family: 'Newsreader',           category: 'serif', weights: W_TEXT },
  { family: 'Literata',             category: 'serif', weights: W_TEXT },
  { family: 'Prata',                category: 'serif', weights: '400', canva: true },
  { family: 'Marcellus',            category: 'serif', weights: '400', canva: true },
  { family: 'Cinzel',               category: 'serif', weights: W_TEXT, canva: true },
  { family: 'Cardo',                category: 'serif', weights: W_TEXT },
  { family: 'Gelasio',              category: 'serif', weights: W_TEXT },
  { family: 'Rasa',                 category: 'serif', weights: W_TEXT },
  { family: 'Old Standard TT',      category: 'serif', weights: '400;700' },
  { family: 'Petrona',              category: 'serif', weights: W_TEXT },
  { family: 'Tinos',                category: 'serif', weights: W_TEXT },
  { family: 'Frank Ruhl Libre',     category: 'serif', weights: W_TEXT },
  { family: 'Piazzolla',            category: 'serif', weights: W_TEXT },

  // ── Display / headline ─────────────────────────────────────────────────
  { family: 'Bebas Neue',           category: 'display', weights: '400', canva: true },
  { family: 'Anton',                category: 'display', weights: '400', canva: true },
  { family: 'Archivo Black',        category: 'display', weights: '400', canva: true },
  { family: 'Oswald',               category: 'display', weights: W_TEXT, canva: true },
  { family: 'Abril Fatface',        category: 'display', weights: '400', canva: true },
  { family: 'Passion One',          category: 'display', weights: '400;700' },
  { family: 'Alfa Slab One',        category: 'display', weights: '400' },
  { family: 'Bungee',               category: 'display', weights: '400', canva: true },
  { family: 'Bungee Shade',         category: 'display', weights: '400' },
  { family: 'Righteous',            category: 'display', weights: '400', canva: true },
  { family: 'Fjalla One',           category: 'display', weights: '400' },
  { family: 'Staatliches',          category: 'display', weights: '400' },
  { family: 'Big Shoulders Display',category: 'display', weights: W_DISPLAY },
  { family: 'Ultra',                category: 'display', weights: '400' },
  { family: 'Rammetto One',         category: 'display', weights: '400' },
  { family: 'Luckiest Guy',         category: 'display', weights: '400' },
  { family: 'Yeseva One',           category: 'display', weights: '400', canva: true },
  { family: 'Unica One',            category: 'display', weights: '400' },
  { family: 'Teko',                 category: 'display', weights: W_DISPLAY },
  { family: 'Squada One',           category: 'display', weights: '400' },
  { family: 'Titan One',            category: 'display', weights: '400' },
  { family: 'Chewy',                category: 'display', weights: '400' },
  { family: 'Bangers',              category: 'display', weights: '400' },
  { family: 'Special Elite',        category: 'display', weights: '400' },
  { family: 'Monoton',              category: 'display', weights: '400' },
  { family: 'Black Ops One',        category: 'display', weights: '400' },
  { family: 'Orbitron',             category: 'display', weights: W_DISPLAY },
  { family: 'Audiowide',            category: 'display', weights: '400' },
  { family: 'Press Start 2P',       category: 'display', weights: '400' },
  { family: 'Syne',                 category: 'display', weights: W_TEXT, canva: true },
  { family: 'Grandstander',         category: 'display', weights: W_TEXT },

  // ── Handwriting / script / cursive ─────────────────────────────────────
  { family: 'Caveat',               category: 'handwriting', weights: W_SCRIPT, canva: true },
  { family: 'Dancing Script',       category: 'handwriting', weights: W_SCRIPT, canva: true },
  { family: 'Pacifico',             category: 'handwriting', weights: '400', canva: true },
  { family: 'Satisfy',              category: 'handwriting', weights: '400', canva: true },
  { family: 'Sacramento',           category: 'handwriting', weights: '400', canva: true },
  { family: 'Great Vibes',          category: 'handwriting', weights: '400', canva: true },
  { family: 'Parisienne',           category: 'handwriting', weights: '400' },
  { family: 'Allura',               category: 'handwriting', weights: '400' },
  { family: 'Alex Brush',           category: 'handwriting', weights: '400' },
  { family: 'Kalam',                category: 'handwriting', weights: '400;700' },
  { family: 'Homemade Apple',       category: 'handwriting', weights: '400' },
  { family: 'Shadows Into Light',   category: 'handwriting', weights: '400' },
  { family: 'Amatic SC',            category: 'handwriting', weights: '400;700', canva: true },
  { family: 'Permanent Marker',     category: 'handwriting', weights: '400', canva: true },
  { family: 'Indie Flower',         category: 'handwriting', weights: '400' },
  { family: 'Courgette',            category: 'handwriting', weights: '400' },
  { family: 'Cookie',               category: 'handwriting', weights: '400' },
  { family: 'Yellowtail',           category: 'handwriting', weights: '400' },
  { family: 'Kaushan Script',       category: 'handwriting', weights: '400' },
  { family: 'Marck Script',         category: 'handwriting', weights: '400' },
  { family: 'Berkshire Swash',      category: 'handwriting', weights: '400' },
  { family: 'Italianno',            category: 'handwriting', weights: '400' },
  { family: 'Tangerine',            category: 'handwriting', weights: '400;700' },
  { family: 'Lobster',              category: 'handwriting', weights: '400', canva: true },
  { family: 'Lobster Two',          category: 'handwriting', weights: '400;700' },
  { family: 'Gochi Hand',           category: 'handwriting', weights: '400' },
  { family: 'Patrick Hand',         category: 'handwriting', weights: '400' },
  { family: 'Caveat Brush',         category: 'handwriting', weights: '400' },
  { family: 'La Belle Aurore',      category: 'handwriting', weights: '400' },
  { family: 'Mrs Saint Delafield',  category: 'handwriting', weights: '400' },
  { family: 'Meddon',               category: 'handwriting', weights: '400' },
  { family: 'Rock Salt',            category: 'handwriting', weights: '400' },
  { family: 'Reenie Beanie',        category: 'handwriting', weights: '400' },
  { family: 'Nothing You Could Do', category: 'handwriting', weights: '400' },
  { family: 'Grand Hotel',          category: 'handwriting', weights: '400' },
  { family: 'Give You Glory',       category: 'handwriting', weights: '400' },
  { family: 'Norican',              category: 'handwriting', weights: '400' },
  { family: 'Petit Formal Script',  category: 'handwriting', weights: '400' },
  { family: 'Herr Von Muellerhoff', category: 'handwriting', weights: '400' },
  { family: 'Mr Dafoe',             category: 'handwriting', weights: '400' },
  { family: 'Miss Fajardose',       category: 'handwriting', weights: '400' },
  { family: 'Pinyon Script',        category: 'handwriting', weights: '400' },
  { family: 'Qwigley',              category: 'handwriting', weights: '400' },
  { family: 'WindSong',             category: 'handwriting', weights: '400' },
  { family: 'Playball',             category: 'handwriting', weights: '400' },
  { family: 'Sriracha',             category: 'handwriting', weights: '400' },
  { family: 'Handlee',              category: 'handwriting', weights: '400' },
  { family: 'Neucha',               category: 'handwriting', weights: '400' },
  { family: 'Just Another Hand',    category: 'handwriting', weights: '400' },

  // ── Monospace ───────────────────────────────────────────────────────────
  { family: 'IBM Plex Mono',        category: 'monospace', weights: W_MONO },
  { family: 'JetBrains Mono',       category: 'monospace', weights: W_MONO },
  { family: 'Roboto Mono',          category: 'monospace', weights: W_MONO },
  { family: 'Space Mono',           category: 'monospace', weights: '400;700' },
  { family: 'Fira Code',            category: 'monospace', weights: W_MONO },
  { family: 'Source Code Pro',      category: 'monospace', weights: W_MONO },
  { family: 'Inconsolata',          category: 'monospace', weights: W_MONO },
  { family: 'Courier Prime',        category: 'monospace', weights: '400;700' },
  { family: 'DM Mono',              category: 'monospace', weights: '400;500' },
  { family: 'Overpass Mono',        category: 'monospace', weights: W_MONO },
  { family: 'Red Hat Mono',         category: 'monospace', weights: W_MONO },
  { family: 'PT Mono',              category: 'monospace', weights: '400' },
  { family: 'Ubuntu Mono',          category: 'monospace', weights: '400;700' },
  { family: 'Anonymous Pro',        category: 'monospace', weights: '400;700' },
  { family: 'Cousine',              category: 'monospace', weights: '400;700' },
  { family: 'Azeret Mono',          category: 'monospace', weights: W_MONO },
  { family: 'Martian Mono',         category: 'monospace', weights: W_MONO },
  { family: 'Spline Sans Mono',     category: 'monospace', weights: W_MONO },
  { family: 'Chivo Mono',           category: 'monospace', weights: W_MONO },
  { family: 'Noto Sans Mono',       category: 'monospace', weights: W_MONO },
]

export const CATEGORY_LABELS: Record<FontCategory, string> = {
  'system':      'System',
  'sans-serif':  'Sans Serif',
  'serif':       'Serif',
  'display':     'Display',
  'handwriting': 'Script',
  'monospace':   'Monospace',
}

export const CATEGORY_FALLBACK: Record<FontCategory, string> = {
  'system':      'sans-serif',
  'sans-serif':  'sans-serif',
  'serif':       'serif',
  'display':     'sans-serif',
  'handwriting': 'cursive',
  'monospace':   'monospace',
}

const FONT_MAP = new Map(FONTS.map(f => [f.family, f]))

export function findFont(family: string): FontDef | undefined {
  return FONT_MAP.get(family)
}

export function fontStack(family: string): string {
  const def = findFont(family)
  const fallback = def?.fallback ?? (def ? CATEGORY_FALLBACK[def.category] : 'sans-serif')
  return `'${family}', ${fallback}`
}

// ── Dynamic <link> loader, deduped per family ──────────────────────────────

const loadedFamilies = new Set<string>()
// System fonts are OS-installed - mark them "loaded" up front so
// loadGoogleFonts()/loadGoogleFont() are permanent no-ops for them.
FONTS.filter(f => f.system).forEach(f => loadedFamilies.add(f.family))

function googleFontHref(defs: { family: string; weights: string }[]): string {
  const params = defs
    .map(d => `family=${encodeURIComponent(d.family).replace(/%20/g, '+')}:wght@${d.weights}`)
    .join('&')
  return `https://fonts.googleapis.com/css2?${params}&display=swap`
}

/** Injects a single <link> covering every not-yet-loaded family in `defs`. No-op if all are already loaded. */
export function loadGoogleFonts(defs: FontDef[]): void {
  if (typeof document === 'undefined') return
  const toLoad = defs.filter(d => !loadedFamilies.has(d.family))
  if (toLoad.length === 0) return
  toLoad.forEach(d => loadedFamilies.add(d.family))
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = googleFontHref(toLoad)
  document.head.appendChild(link)
}

export function loadGoogleFont(family: string): void {
  const def = findFont(family) ?? { family, category: 'sans-serif' as const, weights: '400;700' }
  loadGoogleFonts([def])
}
