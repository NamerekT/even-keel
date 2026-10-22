import { useEffect } from 'react'
import { useLive } from '../live/context.js'
import { waitingSessions } from '../state.js'
import { systemChecks, systemInput, worstLevel, type Level } from './system.js'

export type Dot = 'waiting' | 'error'

export interface TabBadge {
  dot: Dot | null
  title: string
}

const NAME = 'Even Keel'
const ICON = '/favicon.svg'
const DOT_FILL: Record<Dot, string> = { waiting: '#f0bd3c', error: '#ff5a4f' }

export function tabBadge(level: Level, waiting: number): TabBadge {
  const dot = level === 'error' ? 'error' : waiting > 0 ? 'waiting' : null
  return { dot, title: waiting > 0 ? `(${waiting}) ${NAME}` : NAME }
}

export function badgedIcon(svg: string, dot: Dot): string {
  const ring = '<circle class="tile" cx="24.5" cy="7.5" r="8.5"/>'
  return svg.replace(/<\/svg>\s*$/, `${ring}<circle cx="24.5" cy="7.5" r="6.5" fill="${DOT_FILL[dot]}"/></svg>\n`)
}

export function iconUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// Fetched while the server is still up: the red dot matters most once it is gone.
let plainIcon: string | null = null

async function loadIcon(): Promise<string | null> {
  if (plainIcon !== null) return plainIcon
  try {
    const response = await fetch(ICON)
    if (response.ok) plainIcon = await response.text()
  } catch {
    // Retried on the next change of the dot.
  }
  return plainIcon
}

export function useTabBadge(now: Date): void {
  const { state, link } = useLive()
  const level = worstLevel(systemChecks(systemInput(state, link), now))
  const { dot, title } = tabBadge(level, state === null ? 0 : waitingSessions(state.sessions, state.tasks).length)

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    const loading = loadIcon()
    if (icon === null) return
    if (dot === null) {
      icon.href = ICON
      return
    }
    let current = true
    void loading.then((svg) => {
      if (current && svg !== null) icon.href = iconUrl(badgedIcon(svg, dot))
    })
    return () => {
      current = false
    }
  }, [dot])
}
