// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, useNavigate, type NavigateFunction } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MachineCard } from '../../../src/state.js'
import { MachineFilterProvider, useMachineFilter, type MachineFilter } from './MachineFilter.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const cards = [{ id: 'hub' }, { id: 'laptop' }] as MachineCard[]
const live = {
  state: { liveMachines: ['hub', 'laptop'] },
  read: () => Promise.resolve(cards),
  onMachines: () => () => {},
  onDevices: () => () => {},
}
vi.mock('../live/context.js', () => ({ useLive: () => live }))

let root: Root
let go: NavigateFunction
let filter: MachineFilter
const seen: (string | null)[] = []

function Probe() {
  go = useNavigate()
  filter = useMachineFilter()
  seen.push(filter.selected?.id ?? null)
  return null
}

const page = () => createElement(MachineFilterProvider, null, createElement(Probe))

beforeEach(async () => {
  seen.length = 0
  root = createRoot(document.createElement('div'))
  const router = createMemoryRouter([{ path: '/p/:id', element: page() }], { initialEntries: ['/p/abc?machine=laptop'] })
  await act(async () => root.render(createElement(RouterProvider, { router })))
})
afterEach(async () => {
  await act(async () => root.unmount())
})

describe('MachineFilterProvider', () => {
  it('keeps the chosen machine through a link that drops the parameter: no render shows every machine', async () => {
    expect(seen.at(-1)).toBe('laptop')
    seen.length = 0
    await act(async () => void go({ hash: 'ABC-2' }))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((id) => id === 'laptop')).toBe(true)
  })

  it('shows every machine after "All machines" and does not bring the choice back', async () => {
    await act(async () => filter.select(null))
    expect(seen.at(-1)).toBeNull()
    await act(async () => void go({ hash: 'ABC-2' }))
    expect(seen.at(-1)).toBeNull()
  })
})
