// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLLOW_MS, useHeightGlide } from './useHeightGlide.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let resized: () => void = () => {}
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(callback: () => void) {
      resized = callback
    }
    observe() {}
    disconnect() {}
  },
)

let root: Root
let frame: HTMLDivElement
/** The content's own height: what the frame measures with no height of its own. */
let natural = 0

function Probe({ tab }: { tab: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useHeightGlide(ref, tab)
  return createElement('div', { ref })
}

const show = (tab: string) => act(async () => root.render(createElement(Probe, { tab })))

const ended = () => {
  const event = new Event('transitionend')
  Object.defineProperty(event, 'propertyName', { value: 'height' })
  frame.dispatchEvent(event)
}

/** New content inside the frame, as rows that arrive from the server: a mutation the glide hears. */
const grow = async (height: number) => {
  natural = height
  await act(async () => void frame.appendChild(document.createElement('p')))
}

beforeEach(async () => {
  vi.useFakeTimers()
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await show('rules')
  frame = host.firstElementChild as HTMLDivElement
  // The frame's height on screen: the one the glide holds, or the content's own.
  Object.defineProperty(frame, 'offsetHeight', { get: () => (frame.style.height === '' ? natural : Number.parseFloat(frame.style.height)) })
  natural = 300
  resized()
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('useHeightGlide', () => {
  it('glides from the old tab height to the new one and lets go at the end', async () => {
    natural = 120
    await show('components')
    expect(frame.style.height).toBe('120px')
    ended()
    expect(frame.style.height).toBe('')
  })

  it('turns the glide toward the content that grew mid-glide instead of cutting it off', async () => {
    natural = 40
    await show('components')
    expect(frame.style.height).toBe('40px')
    await grow(420)
    expect(frame.style.height).toBe('420px')
    ended()
    expect(frame.style.height).toBe('')
  })

  it('lets go when the content grows back to the height the frame is at', async () => {
    natural = 40
    await show('components')
    await grow(40)
    expect(frame.style.height).toBe('')
  })

  it('glides to content that comes soon after the glide ended, from the height it ended at', async () => {
    natural = 40
    await show('components')
    ended()
    const before: string[] = []
    const styles = new MutationObserver((records) => before.push(...records.map((record) => record.oldValue ?? '')))
    styles.observe(frame, { attributes: true, attributeFilter: ['style'], attributeOldValue: true })
    await grow(420)
    expect(frame.style.height).toBe('420px')
    expect(before.some((style) => style.includes('40px'))).toBe(true)
  })

  it('leaves the frame alone when the content changes long after the switch', async () => {
    natural = 120
    await show('components')
    ended()
    await act(async () => void vi.advanceTimersByTime(FOLLOW_MS))
    await grow(500)
    expect(frame.style.height).toBe('')
  })

  it('lets go after the guard when no transitionend comes', async () => {
    natural = 40
    await show('components')
    await grow(420)
    await act(async () => void vi.advanceTimersByTime(1000))
    expect(frame.style.height).toBe('')
  })
})
