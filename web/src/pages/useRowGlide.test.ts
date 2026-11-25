// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChainBlock } from '../state.js'
import type { Motion } from '../ui/motion.js'
import { useRowGlide } from './useRowGlide.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const ROW = 40
let root: Root
let glided: string[]

function motionOf(joined: string[]): Motion<ChainBlock> {
  return { entered: [], finished: [], taken: null, joined, merged: [], parted: [], alone: [], leaving: [], quiet: null, delays: {} }
}

/** Calls the hook as `ChainList` does: the motion plays in a layout effect before the hook's own. */
function Probe({ view, order, motion }: { view: string; order: string[]; motion: Motion<ChainBlock> | null }) {
  const listRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const play = useRef<(motion: Motion<ChainBlock>) => void>(() => {})
  useLayoutEffect(() => {
    if (motion !== null) play.current(motion)
  })
  useRowGlide(listRef, frameRef, [], play, view, () => false)
  return createElement(
    'div',
    { ref: listRef },
    createElement('div', { ref: frameRef }),
    createElement('ul', null, ...order.map((id) => createElement('li', { key: id, 'data-block': id }))),
  )
}

const show = (view: string, order: string, motion: Motion<ChainBlock> | null = null) =>
  act(async () => root.render(createElement(Probe, { view, order: order.split(' '), motion })))

beforeEach(() => {
  glided = []
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  // A row's place is its index in the list; a glide is recorded by its row.
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.block === undefined ? 0 : [...this.parentElement!.children].indexOf(this) * ROW
    },
  })
  HTMLElement.prototype.getAnimations = () => []
  HTMLElement.prototype.animate = function (this: HTMLElement) {
    glided.push(this.dataset.block!)
    return { id: '', cancel() {}, playState: 'running' } as unknown as Animation
  }
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  await act(async () => root.unmount())
})

describe('useRowGlide', () => {
  it('glides a row into the running group in the same view', async () => {
    await show('p1', 'A-1 A-2')
    await show('p1', 'A-2 A-1', motionOf(['A-1']))
    expect(glided).toContain('A-1')
  })

  it('does not glide a row from its place in the view left when the machine view switches', async () => {
    await show('p2@m1', 'A-1 A-2')
    await show('p2', 'A-2 A-1', motionOf(['A-1']))
    expect(glided).toEqual([])
  })
})
