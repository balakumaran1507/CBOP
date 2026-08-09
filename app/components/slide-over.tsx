'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

const WIDTH: Record<'sm' | 'md' | 'lg', string> = {
  sm: '360px',
  md: '480px',
  lg: '640px',
}

export interface SlideOverProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: 'sm' | 'md' | 'lg'
}

/**
 * Reusable slide-over panel.
 *
 * Renders a semi-transparent backdrop + a panel that slides in from the right.
 * The header (title + close button) is always rendered by this component.
 * Everything inside `children` is rendered below the header — children own their
 * own scroll container(s) and footer(s) so the layout stays flexible across all
 * uses (forms, detail views, pickers, etc.).
 *
 * Usage:
 *   <SlideOver isOpen={open} onClose={() => setOpen(false)} title="New Deal">
 *     <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
 *       …fields…
 *     </div>
 *     <div className="flex gap-3 px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
 *       …footer buttons…
 *     </div>
 *   </SlideOver>
 */
export function SlideOver({
  isOpen,
  onClose,
  title,
  children,
  width = 'md',
}: SlideOverProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: WIDTH[width],
          backgroundColor: '#fff',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.14)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2
            className="text-base font-semibold truncate mr-4"
            style={{
              fontFamily: 'var(--font-syne), sans-serif',
              color: 'var(--text1)',
            }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close panel"
            style={{
              color: 'var(--text2)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              padding: 2,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — children control their own scroll / flex layout */}
        {children}
      </div>
    </>
  )
}
