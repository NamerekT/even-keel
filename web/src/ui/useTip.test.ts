import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLayoutEffect, useRef, useState } from 'react'
import { OPEN_DELAY_MS, openDelay, useTip, WARM_MS } from './useTip.js'

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useRef: vi.fn(),
  useState: vi.fn(),
}))

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('useTip dismissal', () => {
  function mount() {
    class TestNode extends EventTarget {}
    const document = new TestNode()
    const window = new TestNode()
    const child = new TestNode()
    const tip = Object.assign(new TestNode(), {
      showPopover: vi.fn(), hidePopover: vi.fn(), matches: () => true,
      contains: (node: unknown) => node === tip || node === child,
      offsetWidth: 100, offsetHeight: 50, style: {},
    })
    const anchor = { getBoundingClientRect: () => ({ left: 100, right: 200, top: 100, bottom: 120 }) }
    const setOpen = vi.fn()
    vi.stubGlobal('Node', TestNode)
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', Object.assign(window, { innerWidth: 1280, innerHeight: 800 }))
    vi.mocked(useState).mockReturnValue([true, setOpen])
    vi.mocked(useRef).mockReturnValueOnce({ current: anchor }).mockReturnValueOnce({ current: tip })
      .mockReturnValue({ current: undefined })
    useTip()
    const cleanup = vi.mocked(useLayoutEffect).mock.calls[0]![0]()!
    const scroll = (target: EventTarget) => {
      const event = new Event('scroll')
      Object.defineProperty(event, 'target', { value: target })
      document.dispatchEvent(event)
    }
    return { document, window, tip, child, setOpen, cleanup, scroll }
  }

  it('closes on document or outside element scroll', () => {
    const view = mount()
    try {
      view.scroll(view.document)
      expect(view.setOpen).toHaveBeenLastCalledWith(false)
      view.setOpen.mockClear()
      view.scroll(new EventTarget())
      expect(view.setOpen).toHaveBeenLastCalledWith(false)
    } finally { view.cleanup() }
  })

  it('keeps the tip open when it or its content scrolls', () => {
    const view = mount()
    try {
      view.scroll(view.tip)
      view.scroll(view.child)
      expect(view.setOpen).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })

  it('closes on resize and removes dismissal listeners on cleanup', () => {
    const view = mount()
    view.window.dispatchEvent(new Event('resize'))
    expect(view.setOpen).toHaveBeenLastCalledWith(false)
    view.cleanup()
    view.setOpen.mockClear()
    view.scroll(view.document)
    view.window.dispatchEvent(new Event('resize'))
    expect(view.setOpen).not.toHaveBeenCalled()
  })
})

describe('openDelay', () => {
  it('waits when no tip was open', () => {
    expect(openDelay(10_000, 0, -Infinity)).toBe(OPEN_DELAY_MS)
  })

  it('opens at once while another tip is still open', () => {
    expect(openDelay(10_000, 1, -Infinity)).toBe(0)
  })

  it('opens at once when a tip closed within the warm window', () => {
    expect(openDelay(10_000, 0, 10_000 - WARM_MS)).toBe(0)
  })

  it('waits again once the warm window has passed', () => {
    expect(openDelay(10_000, 0, 10_000 - WARM_MS - 1)).toBe(OPEN_DELAY_MS)
  })
})
