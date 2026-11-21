// @vitest-environment happy-dom
import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FoldBody } from './Fold.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let root: Root
let host: HTMLDivElement
const scrolled = vi.fn()

function show(open: boolean) {
  return act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement('button', { type: 'button', 'aria-controls': 'fold' }, 'more'),
        createElement(FoldBody, { open, id: 'fold', preview: true, children: 'a long message' }),
      ),
    ),
  )
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  scrolled.mockClear()
  // The toggle sits above the visible part, as a folded message up a feed pinned to its end.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: -400, bottom: -380, left: 0, right: 0, width: 0, height: 20, x: 0, y: -400, toJSON: () => ({}) })
  HTMLElement.prototype.scrollIntoView = scrolled
  if (!('getAnimations' in HTMLElement.prototype)) Object.assign(HTMLElement.prototype, { getAnimations: () => [] })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('FoldBody', () => {
  it('does not scroll to the toggle of a preview fold that was never opened (BTN-1372)', async () => {
    await show(false)
    expect(scrolled).not.toHaveBeenCalled()
  })

  it('brings the toggle back into view when an opened fold closes above it', async () => {
    await show(false)
    await show(true)
    await show(false)
    expect(scrolled).toHaveBeenCalledTimes(1)
  })
})
