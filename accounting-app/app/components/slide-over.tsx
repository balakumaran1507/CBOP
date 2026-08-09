'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

// Port of the main CBOP app's app/components/slide-over.tsx, same contract,
// rebuilt on this app's Tailwind tokens instead of CSS custom properties (this
// app has no globals.css variable set matching the main app's --border/--text1
// etc.). Every create/edit form in this app uses this — CLAUDE.md's "Slide-over
// panels only. No modals. No separate /create pages" rule applies here exactly
// as it does in the main CBOP app; this is a separate SaaS app, not a reason
// to relitigate that convention.

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
 * Usage:
 *   <SlideOver isOpen={open} onClose={() => setOpen(false)} title="New Bill">
 *     <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">…fields…</div>
 *     <div className="flex gap-3 px-6 py-4 border-t border-border shrink-0">…footer buttons…</div>
 *   </SlideOver>
 */
export function SlideOver({ isOpen, onClose, title, children, width = 'md' }: SlideOverProps) {
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
      <div className="fixed inset-0 z-40 bg-black/35" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col bg-white shadow-[-4px_0_24px_rgba(0,0,0,0.14)]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: WIDTH[width] }}
      >
        <div className="flex items-center justify-between px-6 py-4 shrink-0 border-b border-border">
          <h2 className="font-display font-semibold text-base truncate mr-4 text-text1">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="text-text2 hover:text-text1 shrink-0 inline-flex items-center p-0.5"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </>
  )
}
