// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POLL_MAX_MS, POLL_MS, pauseOf, usePolledState, type Polled } from './polledState.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

interface Work {
  running: boolean
  done: number
}

let root: Root
let shown: Polled<Work>
let answers: Array<Work | Error>
let asks: number

const ask = async (): Promise<Work> => {
  asks += 1
  const next = answers.shift()
  if (next === undefined) throw new Error('no answer scripted')
  if (next instanceof Error) throw next
  return next
}

function Probe() {
  shown = usePolledState(ask, (state) => state?.running === true, 'p')
  return null
}

const mount = () => act(async () => root.render(createElement(Probe)))
const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))

beforeEach(() => {
  vi.useFakeTimers()
  asks = 0
  root = createRoot(document.createElement('div'))
})

afterEach(async () => {
  await act(async () => root.unmount())
  vi.useRealTimers()
})

describe('usePolledState', () => {
  it('goes on reading after a 502 and drops the failure with the next answer', async () => {
    answers = [{ running: true, done: 95 }, new Error('/api/builtin/import/state answered 502'), { running: true, done: 120 }]
    await mount()
    expect(shown.state).toEqual({ running: true, done: 95 })
    await wait(POLL_MS)
    expect(shown.state).toEqual({ running: true, done: 95 })
    expect(shown.failure).toEqual({ notice: expect.objectContaining({}), retrying: true })
    await wait(pauseOf(1))
    expect(shown.state).toEqual({ running: true, done: 120 })
    expect(shown.failure).toBeNull()
    expect(asks).toBe(3)
  })

  it('waits longer after each failure in a row, up to its ceiling', async () => {
    answers = [{ running: true, done: 1 }, new Error('502'), new Error('502')]
    await mount()
    await wait(POLL_MS)
    expect(asks).toBe(2)
    await wait(pauseOf(1) - 1)
    expect(asks).toBe(2)
    await wait(1)
    expect(asks).toBe(3)
    expect(pauseOf(1)).toBe(POLL_MS * 2)
    expect(pauseOf(20)).toBe(POLL_MAX_MS)
  })

  it('stops once the work is through', async () => {
    answers = [{ running: true, done: 1 }, { running: false, done: 2 }]
    await mount()
    await wait(POLL_MS)
    await wait(POLL_MAX_MS)
    expect(asks).toBe(2)
    expect(shown.state).toEqual({ running: false, done: 2 })
  })

  it('leaves a failed first read as a refusal, asked no more', async () => {
    answers = [new Error('unknown project')]
    await mount()
    await wait(POLL_MAX_MS)
    expect(asks).toBe(1)
    expect(shown.failure).toEqual({ notice: expect.objectContaining({}), retrying: false })
  })

  it('starts reading when an action sets a running state', async () => {
    answers = [{ running: false, done: 0 }, { running: true, done: 3 }]
    await mount()
    await act(async () => shown.set({ running: true, done: 0 }))
    await wait(POLL_MS)
    expect(shown.state).toEqual({ running: true, done: 3 })
  })
})
