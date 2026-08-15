'use client'

import React, { useState, useEffect, useRef } from 'react'

interface ImageEditorModalProps {
  isOpen: boolean
  onClose: () => void
  imageSrc: string
  onSave: (blob: Blob) => void
  cropShape?: 'circle' | 'square'
  title?: string
}

export function ImageEditorModal({
  isOpen,
  onClose,
  imageSrc,
  onSave,
  cropShape = 'circle',
  title = 'Edit Image',
}: ImageEditorModalProps) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [initialPos, setInitialPos] = useState({ x: 0, y: 0 })
  const [imageSize, setImageSize] = useState({ width: 288, height: 288 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Reset controls when modal opens/closes or image changes
  useEffect(() => {
    if (isOpen) {
      setScale(1)
      setPosition({ x: 0, y: 0 })
    }
  }, [isOpen, imageSrc])

  if (!isOpen || !imageSrc) return null

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    setDragStart({ x: e.clientX, y: e.clientY })
    setInitialPos({ x: position.x, y: position.y })
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y
    setPosition({
      x: initialPos.x + dx,
      y: initialPos.y + dy,
    })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setIsDragging(false)
  }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const zoomSpeed = 0.05
    const newScale = Math.min(Math.max(scale - e.deltaY * zoomSpeed * 0.01, 1), 4)
    setScale(newScale)
  }

  const handleApply = () => {
    const image = new Image()
    image.src = imageSrc
    image.onload = () => {
      const canvas = document.createElement('canvas')
      const size = 400 // Output image dimension
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Clear with transparent bg
      ctx.fillStyle = 'rgba(0, 0, 0, 0)'
      ctx.fillRect(0, 0, size, size)

      const containerSize = 288 // Container size matched with UI
      const imageAspect = image.naturalWidth / image.naturalHeight
      
      let renderWidth = containerSize
      let renderHeight = containerSize

      if (imageAspect > 1) {
        renderWidth = containerSize * imageAspect
      } else {
        renderHeight = containerSize / imageAspect
      }

      // Center and translate
      ctx.translate(size / 2, size / 2)
      
      const outputScale = size / containerSize
      ctx.scale(scale * outputScale, scale * outputScale)

      ctx.drawImage(
        image,
        -renderWidth / 2 + position.x / scale,
        -renderHeight / 2 + position.y / scale,
        renderWidth,
        renderHeight
      )

      canvas.toBlob((blob) => {
        if (blob) {
          onSave(blob)
          onClose()
        }
      }, 'image/png')
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
      <div 
        className="w-full max-w-md bg-zinc-950 border border-white/10 p-6 shadow-2xl relative flex flex-col items-center select-none"
        onPointerDown={(e) => e.stopPropagation()} // Stop drag modal gestures from leaking to background lock screen
      >
        {/* Decorative Top Bar */}
        <div className="absolute top-0 inset-x-0 h-[2px] bg-blue-500" />

        {/* Header */}
        <div className="w-full flex justify-between items-center mb-6 pb-2 border-b border-white/10">
          <span className="font-mono text-xs text-white/80 tracking-[0.25em] uppercase">
            // {title}
          </span>
          <button 
            onClick={onClose}
            className="text-white/40 hover:text-white font-mono text-xs uppercase tracking-wider transition-colors"
          >
            Close
          </button>
        </div>

        {/* Viewport container */}
        <div 
          ref={containerRef}
          className="w-[288px] h-[288px] relative overflow-hidden bg-zinc-900 border border-white/10 select-none cursor-grab active:cursor-grabbing mb-6"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
        >
          {/* Image behind overlay */}
          <img 
            src={imageSrc} 
            alt="Preview" 
            draggable={false}
            onLoad={(e) => {
              const { naturalWidth, naturalHeight } = e.currentTarget
              const aspect = naturalWidth / naturalHeight
              if (aspect > 1) {
                setImageSize({ width: 288 * aspect, height: 288 })
              } else {
                setImageSize({ width: 288, height: 288 / aspect })
              }
            }}
            className="pointer-events-none absolute max-w-none origin-center"
            style={{
              width: imageSize.width,
              height: imageSize.height,
              left: (288 - imageSize.width) / 2,
              top: (288 - imageSize.height) / 2,
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            }}
          />

          {/* SVG Cutout Overlay */}
          <svg className="absolute inset-0 pointer-events-none w-full h-full z-10" viewBox="0 0 288 288">
            <defs>
              <mask id="cropMask">
                <rect width="288" height="288" fill="white" />
                {cropShape === 'circle' ? (
                  <circle cx="144" cy="144" r="144" fill="black" />
                ) : (
                  <rect x="0" y="0" width="288" height="288" fill="black" />
                )}
              </mask>
            </defs>
            <rect width="288" height="288" fill="rgba(0, 0, 0, 0.75)" mask="url(#cropMask)" />
            {cropShape === 'circle' ? (
              <circle cx="144" cy="144" r="143" fill="none" stroke="rgba(255, 255, 255, 0.4)" strokeWidth="1" strokeDasharray="4 4" />
            ) : (
              <rect x="1" y="1" width="286" height="286" fill="none" stroke="rgba(255, 255, 255, 0.4)" strokeWidth="1" strokeDasharray="4 4" />
            )}
          </svg>
        </div>

        {/* Zoom Slider Control */}
        <div className="w-full flex items-center space-x-3 mb-6">
          <span className="text-white/40 font-mono text-[9px] uppercase tracking-wider">zoom:</span>
          <button 
            onClick={() => setScale(Math.max(1, scale - 0.15))}
            className="text-white/50 hover:text-white px-1.5 font-bold font-mono text-sm"
          >
            -
          </button>
          <input 
            type="range" 
            min="1" 
            max="4" 
            step="0.01" 
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            className="flex-1 h-[2px] bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <button 
            onClick={() => setScale(Math.min(4, scale + 0.15))}
            className="text-white/50 hover:text-white px-1.5 font-bold font-mono text-sm"
          >
            +
          </button>
          <span className="text-white/60 font-mono text-[10px] min-w-[32px] text-right">
            {scale.toFixed(1)}x
          </span>
        </div>

        {/* Buttons Panel */}
        <div className="w-full flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-white/10 text-white/60 hover:text-white hover:bg-white/5 font-mono text-xs uppercase tracking-widest transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-mono text-xs uppercase tracking-widest transition-all font-bold"
          >
            Apply Crop
          </button>
        </div>
      </div>
    </div>
  )
}
