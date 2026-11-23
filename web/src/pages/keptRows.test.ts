// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keepRows, useKeptRows } from './keptRows.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const query = vi.fn<(route: string, params: { project: string }) => Promise<string[]>>()
vi.mock('../live/context.js', () => ({ useLive: () => ({ query }) }))

let root: Root
const seen: (string[] | null)[] = []

function Probe({ project }: { project: string }) {
  seen.push(useKeptRows<string>('builtin/components', project).rows)
  return null
}

const mount = (project: string) => act(async () => root.render(createElement(Probe, { project })))

beforeEach(() => {
  seen.length = 0
  query.mockReset()
  root = createRoot(document.createElement('div'))
})

afterEach(async () => {
  await act(async () => root.unmount())
})

describe('useKeptRows', () => {
  it('shows the rows last loaded for the project at once and refreshes them behind', async () => {
    query.mockResolvedValueOnce(['Server'])
    await mount('p-first')
    expect(seen.at(0)).toBeNull()
    expect(seen.at(-1)).toEqual(['Server'])
    await act(async () => root.unmount())

    seen.length = 0
    root = createRoot(document.createElement('div'))
    query.mockResolvedValueOnce(['Server', 'UI'])
    await mount('p-first')
    expect(seen.at(0)).toEqual(['Server'])
    expect(seen.at(-1)).toEqual(['Server', 'UI'])
  })

  it('takes the answer of the window early load instead of asking again', async () => {
    let answer!: (rows: string[]) => void
    query.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const early = keepRows<string>(query as never, 'builtin/components', 'p-early')
    await mount('p-early')
    await act(async () => answer(['UI']))
    await early
    expect(query).toHaveBeenCalledTimes(1)
    expect(seen.at(-1)).toEqual(['UI'])
  })

  it('asks anew after an edit and lets no earlier answer overwrite it', async () => {
    let early!: (rows: string[]) => void
    query.mockReturnValueOnce(new Promise((resolve) => (early = resolve)))
    let shown!: ReturnType<typeof useKeptRows<string>>
    function Editor() {
      shown = useKeptRows<string>('builtin/components', 'p-edit')
      return null
    }
    await act(async () => root.render(createElement(Editor)))
    query.mockResolvedValueOnce(['Server', 'Renamed'])
    await act(async () => shown.load())
    await act(async () => early(['Server', 'Old name']))
    expect(query).toHaveBeenCalledTimes(2)
    expect(shown.rows).toEqual(['Server', 'Renamed'])
  })

  it('keeps another project rows apart', async () => {
    query.mockResolvedValueOnce(['Server'])
    await mount('p-second')
    query.mockReturnValueOnce(new Promise(() => {}))
    await mount('p-third')
    expect(seen.at(-1)).toBeNull()
  })
})
