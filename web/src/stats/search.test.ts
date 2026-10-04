import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW, parseView, viewSearch } from './search.js'

const parse = (text: string) => parseView(new URLSearchParams(text))

describe('parseView', () => {
  it('defaults to 30 sliding days over all projects and sessions', () => {
    expect(parse('')).toEqual(DEFAULT_VIEW)
    expect(DEFAULT_VIEW).toEqual({ period: { preset: '30d' }, projects: null, scope: 'all', account: null, step: null, kinds: null, purposes: null })
  })

  it('reads a preset, a custom range, projects, scope, account and step', () => {
    expect(parse('range=year&projects=BTN,yaml&scope=chain&account=global&step=w')).toEqual({
      period: { preset: 'year' },
      projects: ['BTN', 'yaml'],
      scope: 'chain',
      account: 'global',
      step: 'week',
      kinds: null,
      purposes: null,
    })
    expect(parse('from=2026-09-04&to=2026-10-03').period).toEqual({ from: '2026-09-04', to: '2026-10-03' })
  })

  it('tells no projects from all projects', () => {
    expect(parse('projects=').projects).toEqual([])
    expect(parse('projects=BTN').projects).toEqual(['BTN'])
  })

  it('falls back on anything it does not understand', () => {
    expect(parse('range=week&scope=x&step=y').period).toEqual({ preset: '30d' })
    expect(parse('from=2026-10-03&to=2026-09-04').period).toEqual({ preset: '30d' })
    expect(parse('from=2026-13-01&to=2026-13-02').period).toEqual({ preset: '30d' })
    expect(parse('scope=x').scope).toBe('all')
    expect(parse('step=y').step).toBeNull()
    expect(parse('kinds=skill,poem,memory').kinds).toEqual(['skill'])
    expect(parse('purposes=economy,speed').purposes).toEqual(['economy'])
  })
})

describe('viewSearch', () => {
  it('leaves defaults out', () => {
    expect(viewSearch(DEFAULT_VIEW)).toBe('')
  })

  it('writes what differs and reads back the same', () => {
    const view = { period: { from: '2026-09-04', to: '2026-10-03' }, projects: [], scope: 'chain' as const, account: 'global', step: 'month' as const, kinds: ['claude_md' as const, 'hook' as const], purposes: ['economy' as const] }
    const text = viewSearch(view)
    expect(text).toBe('from=2026-09-04&to=2026-10-03&projects=&scope=chain&account=global&step=m&kinds=claude_md%2Chook&purposes=economy')
    expect(parse(text)).toEqual(view)
    expect(viewSearch({ ...DEFAULT_VIEW, period: { preset: '7d' }, projects: ['BTN', 'GAME'] })).toBe('range=7d&projects=BTN%2CGAME')
  })
})
