// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLanding } from './useCommand.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('./context.js', () => ({ useLive: () => ({}) }))

const LIMIT = 1000
let root: Root
let shown: ReturnType<typeof useLanding>

function Probe({ value }: { value: string }) {
  shown = useLanding(value, LIMIT)
  return null
}

const show = (value: string) => act(async () => root.render(createElement(Probe, { value })))

beforeEach(async () => {
  vi.useFakeTimers()
  root = createRoot(document.createElement('div'))
  await show('old')
})

afterEach(async () => {
  await act(async () => root.unmount())
  vi.useRealTimers()
})

describe('useLanding', () => {
  it('holds from the press, through the answer, until the value changes', async () => {
    let answer!: (ok: boolean) => void
    let landed!: Promise<boolean>
    await act(async () => void (landed = shown.land(() => new Promise((resolve) => (answer = resolve)))))
    expect(shown.on).toBe(true)
    await act(async () => answer(true))
    await expect(landed).resolves.toBe(true)
    expect(shown).toMatchObject({ on: true, late: false })
    await show('new')
    expect(shown).toMatchObject({ on: false, late: false })
  })

  it('lets go at once when the command fails', async () => {
    await act(async () => void (await shown.land(async () => false)))
    expect(shown).toMatchObject({ on: false, late: false })
  })

  it('is late once the limit passes after the answer with the value unchanged, and lets go when it changes', async () => {
    await act(async () => void (await shown.land(async () => true)))
    await act(async () => vi.advanceTimersByTime(LIMIT - 1))
    expect(shown).toMatchObject({ on: true, late: false })
    await act(async () => vi.advanceTimersByTime(1))
    expect(shown).toMatchObject({ on: false, late: true })
    await show('new')
    expect(shown).toMatchObject({ on: false, late: false })
  })

  it('does not count the time the command itself takes', async () => {
    let answer!: (ok: boolean) => void
    await act(async () => void shown.land(() => new Promise((resolve) => (answer = resolve))))
    await act(async () => vi.advanceTimersByTime(LIMIT * 3))
    expect(shown).toMatchObject({ on: true, late: false })
    await act(async () => answer(true))
    await act(async () => vi.advanceTimersByTime(LIMIT - 1))
    expect(shown.on).toBe(true)
  })

  it('stays off when the value changed while the command was on its way and later comes back', async () => {
    let answer!: (ok: boolean) => void
    await act(async () => void shown.land(() => new Promise((resolve) => (answer = resolve))))
    await show('new')
    await act(async () => answer(true))
    expect(shown.on).toBe(false)
    await show('old')
    await act(async () => vi.advanceTimersByTime(LIMIT))
    expect(shown).toMatchObject({ on: false, late: false })
  })
})
