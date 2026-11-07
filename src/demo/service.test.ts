import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EvenKeelConfig } from '../config.js'
import { samePath } from '../paths.js'
import { DemoService, type DemoDeps } from './service.js'

vi.mock('../paths.js', async (original) => {
  const paths = await original<typeof import('../paths.js')>()
  return { ...paths, samePath: vi.fn(paths.samePath) }
})

const stateDir = join('/', 'srv', 'even-keel', 'state')

describe('the demo project lookup', () => {
  let config: EvenKeelConfig
  let demo: DemoService

  beforeEach(() => {
    vi.mocked(samePath).mockClear()
    demo = new DemoService({ stateDir, config: () => config, homes: { setDemo: () => {} } } as unknown as DemoDeps)
    config = { projects: { other: join('/', 'srv', 'repos', 'other'), demo: demo.repo } } as unknown as EvenKeelConfig
  })

  it('compares the paths once per config, not on every call', () => {
    for (let call = 0; call < 5; call++) expect(demo.project()).toBe('demo')
    expect(demo.owns('demo')).toBe(true)
    expect(demo.owns('other')).toBe(false)
    expect(vi.mocked(samePath).mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('finds the project anew once the config changes', () => {
    expect(demo.project()).toBe('demo')
    config = { projects: { other: config.projects.other! } } as unknown as EvenKeelConfig
    expect(demo.project()).toBeUndefined()
    config = { projects: { again: demo.repo } } as unknown as EvenKeelConfig
    expect(demo.project()).toBe('again')
  })
})
