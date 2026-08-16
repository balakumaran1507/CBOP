'use client'
import { useState, useEffect } from 'react'
import type React from 'react'

interface ClockState {
  timeStr: string
  dateStr: string
  dayOfWeek: string
}

export function useLockscreen() {
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [startY, setStartY] = useState(0)
  const [dragOffset, setDragOffset] = useState(0)
  const [time, setTime] = useState<ClockState>({
    timeStr: '00:00:00',
    dateStr: '01.01',
    dayOfWeek: 'MONDAY',
  })

  useEffect(() => {
    const updateClock = () => {
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      const ss = String(now.getSeconds()).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
      setTime({
        timeStr: `${hh}:${mm}:${ss}`,
        dateStr: `${day}.${month}`,
        dayOfWeek: days[now.getDay()],
      })
    }
    updateClock()
    const interval = setInterval(updateClock, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (isUnlocked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        setIsUnlocked(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isUnlocked])

  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input') || target.closest('a')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    setStartY(e.clientY)
    setDragOffset(0)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    const deltaY = e.clientY - startY
    setDragOffset(isUnlocked ? Math.max(0, deltaY) : Math.min(0, deltaY))
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setIsDragging(false)
    const deltaY = e.clientY - startY
    if (!isUnlocked && -deltaY > 100) setIsUnlocked(true)
    if (isUnlocked && deltaY > 100) setIsUnlocked(false)
    setDragOffset(0)
  }

  const getLockscreenStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = { cursor: isDragging ? 'grabbing' : 'grab' }
    if (!isUnlocked) {
      return {
        ...base,
        transform: `translateY(${dragOffset}px)`,
        transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      }
    }
    return {
      ...base,
      transform: isDragging ? `translateY(calc(-100% + ${dragOffset}px))` : 'translateY(-100%)',
      transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
    }
  }

  return { time, isUnlocked, setIsUnlocked, isDragging, dragOffset, handlePointerDown, handlePointerMove, handlePointerUp, getLockscreenStyle }
}
