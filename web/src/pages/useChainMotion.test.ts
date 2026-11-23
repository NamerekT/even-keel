// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChainBlock } from '../state.js'
import type { Stage } from '../ui/motion.js'
import { useChainMotion, useSwitched } from './useChainMotion.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const block = (id: string): ChainBlock => ({ id, lamp: 'ahead', open: true, locked: false, blockedBy: [], after: [], current: false }) as unknown as ChainBlock

let root: Root
let stage: Stage<ChainBlock>

function Probe({ view, ids }: { view: string; ids: string[] }) {
  stage = useChainMotion(view, ids.map(block), new Set(ids), null)
  return null
}

const show = (view: string, ids: string) => act(async () => root.render(createElement(Probe, { view, ids: ids.split(' ') })))
const marked = () => [...stage.marks.keys()]
const leaving = () => stage.leaving.map((each) => each.item.id)

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  await act(async () => root.unmount())
})

describe('useChainMotion', () => {
  it('replaces the rows at once when the machine view switches, with nothing leaving or coming', async () => {
    await show('p1', 'A-1 A-2 A-3')
    await show('p1@m1', 'A-2')
    expect(leaving()).toEqual([])
    expect(marked()).toEqual([])
    await show('p1@m2', 'A-1 A-3')
    await show('p1', 'A-1 A-2 A-3')
    expect(leaving()).toEqual([])
    expect(marked()).toEqual([])
  })

  it('plays a change of the chain in the chosen view', async () => {
    await show('p2', 'A-1 A-2 A-3')
    await show('p2@m1', 'A-2')
    await show('p2@m1', 'A-2 A-4')
    expect(marked()).toEqual(['A-4'])
  })

  it('plays only what changed in the chain while another view was shown, back on the view', async () => {
    await show('p3', 'A-1 A-2 A-3')
    await show('p3@m1', 'A-2')
    await show('p3@m1', 'A-2 A-4')
    await show('p3', 'A-1 A-2 A-3 A-4')
    expect(leaving()).toEqual([])
    expect(marked()).toEqual(['A-4'])
  })

  it('tells the first render of a new view from the others', async () => {
    const seen: boolean[] = []
    function Switch({ view }: { view: string }) {
      seen.push(useSwitched(view))
      return null
    }
    for (const view of ['p5', 'p5', 'p5@m1', 'p5@m1', 'p5']) await act(async () => root.render(createElement(Switch, { view })))
    expect(seen).toEqual([false, false, true, false, true])
  })

  it('drops a motion still playing in the view left', async () => {
    await show('p4', 'A-1 A-2 A-3')
    await show('p4', 'A-1 A-3')
    expect(leaving()).toEqual(['A-2'])
    await show('p4@m1', 'A-3')
    expect(leaving()).toEqual([])
    expect(marked()).toEqual([])
  })
})
