import { describe, expect, it, vi } from 'vitest'
import { emptyChainState, type ChainState } from '../chain/model.js'
import { parseConfig } from '../config.js'
import { NoticeError, type Notice } from '../notice/notice.js'
import type { ProfileSet, TrackerProfile } from '../profiles/model.js'
import type { ExportRow } from '../tracker/export.js'
import type { ExportHeader } from './export-store.js'
import { switchHolds, switchTracker, type SwitchDeps, type SwitchInput } from './switch.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'
const FEED = '33333333-3333-4333-8333-333333333333'
const profile = (id: string, kind: string): TrackerProfile => ({ id, kind, name: kind, values: {}, isDefault: true, login: null, expiresAt: null })
const PROFILES: ProfileSet = { profiles: [profile('gh', 'github'), profile('hl', 'huly')], links: {} }
const HEADER: ExportHeader = { profile: 'gh', place: 'example/repo', key: 'GH', startedAt: '2026-11-13T10:00:00Z', finishedAt: '2026-11-13T10:05:00Z' }
const row = (ref: string, number: number, key: string | null, stage: ExportRow['stage'] = 'marked'): ExportRow => ({ ref, number, key, url: null, stage, marker: null, done: 0 })

function setup(options: { raw?: Record<string, unknown>; chain?: Partial<ChainState> } = {}) {
  const raw = options.raw ?? { projects: [{ id: ABC, key: 'ABC', tracker: 'builtin', repo: 'C:/example' }] }
  const rename = vi.fn()
  const move = vi.fn()
  const deps: SwitchDeps = {
    config: () => parseConfig(raw),
    raw: () => raw,
    profiles: () => PROFILES,
    chain: () => ({ ...emptyChainState(), ...options.chain }),
    rename,
    move,
  }
  return { deps, rename, move }
}

const INPUT: SwitchInput = {
  project: ABC,
  header: HEADER,
  rows: [row('r1', 1, 'GH-7'), row('r2', 2, 'GH-8')],
  tasks: [
    { ref: 'r1', id: 'ABC-1', open: true },
    { ref: 'r2', id: 'ABC-2', open: true },
    { ref: 'r3', id: 'ABC-3', open: false },
  ],
}

const refusal = (work: () => unknown): Notice => {
  try {
    work()
  } catch (error) {
    if (error instanceof NoticeError) return error.notice
    throw error
  }
  throw new Error('no refusal')
}

describe('switchTracker', () => {
  it('moves the project to the copy target and renames the copied tasks', () => {
    const { deps, rename, move } = setup()
    const switched = switchTracker(deps, INPUT)
    const names = new Map([['ABC-1', 'GH-7'], ['ABC-2', 'GH-8']])
    expect(switched).toEqual({ move: { tracker: 'github', trackerProject: 'example/repo', key: 'GH' }, names })
    expect(rename).toHaveBeenCalledWith(ABC, names)
    expect(move).toHaveBeenCalledWith(ABC, switched.move, 'gh')
  })

  it('refuses without a finished copy', () => {
    const { deps, move } = setup()
    expect(refusal(() => switchTracker(deps, { ...INPUT, header: null })).code).toBe('switch.noCopy')
    expect(refusal(() => switchTracker(deps, { ...INPUT, header: { ...HEADER, finishedAt: null } })).code).toBe('switch.noCopy')
    expect(move).not.toHaveBeenCalled()
  })

  it('refuses while an open task is not copied to the end, naming it', () => {
    const { deps, rename } = setup()
    const late = { ...INPUT, tasks: [...INPUT.tasks, { ref: 'r4', id: 'ABC-4', open: true }] }
    expect(refusal(() => switchTracker(deps, late))).toMatchObject({ code: 'switch.notCopied', params: { tasks: ['ABC-4'] } })
    const unmarked = { ...INPUT, rows: [row('r1', 1, 'GH-7'), row('r2', 2, 'GH-8', 'journaled')] }
    expect(refusal(() => switchTracker(deps, unmarked))).toMatchObject({ code: 'switch.notCopied', params: { tasks: ['ABC-2'] } })
    expect(rename).not.toHaveBeenCalled()
  })

  it('refuses with what holds the project while the chain works on it', () => {
    const { deps, move } = setup({ chain: { queue: [ABC], reviews: { [ABC]: [{ task: 'ABC-2', remote: 'origin', number: 3, url: '', branch: 'abc-2/task', at: '' }] } } })
    const held = refusal(() => switchTracker(deps, INPUT))
    expect(held.code).toBe('switch.held')
    expect(held.items?.map((item) => item.code)).toEqual(['switch.chainRuns', 'switch.reviews'])
    expect(move).not.toHaveBeenCalled()
  })

  it("refuses a target whose tasks would carry the project's old prefix", () => {
    const { deps } = setup()
    expect(refusal(() => switchTracker(deps, { ...INPUT, header: { ...HEADER, key: 'ABC' } }))).toMatchObject({ code: 'switch.samePrefix', params: { prefix: 'ABC' } })
    // Huly names the tasks by the project in Huly, not by the key.
    expect(refusal(() => switchTracker(deps, { ...INPUT, header: { ...HEADER, profile: 'hl', place: 'ABC', key: 'NEW' } })).code).toBe('switch.samePrefix')
  })

  it("refuses a target whose tasks would carry another project's or feed's prefix", () => {
    const raw = {
      projects: [
        { id: ABC, key: 'ABC', tracker: 'builtin', repo: 'C:/example' },
        { id: XYZ, key: 'XYZ', tracker: 'builtin', repo: 'C:/other', feeds: [{ id: FEED, tracker: 'builtin', key: 'FD' }] },
      ],
    }
    const { deps, rename } = setup({ raw })
    expect(refusal(() => switchTracker(deps, { ...INPUT, header: { ...HEADER, key: 'XYZ' } }))).toMatchObject({ code: 'switch.prefixTaken', params: { prefix: 'XYZ', other: 'XYZ' } })
    expect(refusal(() => switchTracker(deps, { ...INPUT, header: { ...HEADER, key: 'FD' } }))).toMatchObject({ code: 'switch.prefixTaken', params: { other: 'XYZ · FD' } })
    expect(rename).not.toHaveBeenCalled()
  })
})

describe('switchHolds', () => {
  const current = { task: 'ABC-1', sessionId: 's1', since: '' }

  it('lets a stopped or paused chain without work switch', () => {
    expect(switchHolds(emptyChainState(), ABC)).toEqual([])
    expect(switchHolds({ ...emptyChainState(), active: [{ project: ABC, current: null, paused: true, error: null }] }, ABC)).toEqual([])
  })

  it('names a running chain, its task, the released tasks and the open pull requests', () => {
    const state: ChainState = {
      ...emptyChainState(),
      active: [{ project: ABC, current, paused: false, error: null }],
      released: { [ABC]: ['ABC-2'] },
      shelved: { [ABC]: [{ task: 'ABC-2', sessionId: 's2', at: '' }, { task: 'ABC-3', sessionId: 's3', at: '' }] },
    }
    expect(switchHolds(state, ABC)).toEqual([
      { code: 'switch.chainRuns', params: {} },
      { code: 'switch.current', params: { task: 'ABC-1' } },
      { code: 'switch.released', params: { tasks: ['ABC-2', 'ABC-3'] } },
    ])
  })

  it('holds a paused chain that still has its task', () => {
    const state = { ...emptyChainState(), active: [{ project: ABC, current, paused: true, error: null }] }
    expect(switchHolds(state, ABC).map((each) => each.code)).toEqual(['switch.current'])
  })
})
