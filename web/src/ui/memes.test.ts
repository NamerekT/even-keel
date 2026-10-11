import { describe, expect, it } from 'vitest'
import type { TaskSession } from '../../../src/chain/launches.js'
import type { ChainBlock } from '../state.js'
import { emptyCard, type Harbor, harborMemes, longestRun, momentsOf, pickMeme, playMotion, type Scene } from './memes.js'

const block = (id: string, extra: Partial<ChainBlock> = {}): ChainBlock =>
  ({ id, open: true, locked: false, question: false, skipped: false, sessions: [], ...extra }) as ChainBlock
const runs = (...how: string[]) => how.map((each) => ({ how: each })) as TaskSession[]
const scene = (extra: Partial<Scene> = {}): Scene => ({
  loaded: true,
  blocks: [block('ABC-1')],
  backlog: 2,
  status: { kind: 'idle' },
  unattended: false,
  monthCost: null,
  ...extra,
})

describe('momentsOf', () => {
  it('sees dead calm when the project has nothing open, the backlog included', () => {
    expect(momentsOf(scene({ blocks: [block('ABC-1', { open: false })], backlog: 0 }))).toEqual(['calm'])
  })

  it('finds an empty backlog suspicious only while the chain still has work', () => {
    expect(momentsOf(scene({ backlog: 0 }))).toContain('backlogEmpty')
    expect(momentsOf(scene({ backlog: 0, blocks: [] }))).not.toContain('backlogEmpty')
  })

  it('says nothing about the project before its chain is read', () => {
    expect(momentsOf(scene({ loaded: false, blocks: [], backlog: 0 }))).toEqual([])
  })

  it('offers a session slot while the chain stands with work to do', () => {
    expect(momentsOf(scene())).toContain('stopped')
    expect(momentsOf(scene({ status: { kind: 'running', limitUntil: null } }))).not.toContain('stopped')
  })

  it('tells the autopilot from the night shift and from the limit wait', () => {
    const running = { kind: 'running', limitUntil: null } as const
    expect(momentsOf(scene({ status: running }))).toContain('autopilot')
    expect(momentsOf(scene({ status: running, unattended: true }))).toEqual(['overnight'])
    expect(momentsOf(scene({ status: { kind: 'running', limitUntil: '2026-10-10T12:00:00Z' } }))).toEqual(['limit'])
  })

  it('waits for an appointment when an open task holds a question or was skipped', () => {
    expect(momentsOf(scene({ blocks: [block('ABC-1', { question: true })] }))).toContain('appointment')
    expect(momentsOf(scene({ blocks: [block('ABC-1', { skipped: true })] }))).toContain('appointment')
    expect(momentsOf(scene({ blocks: [block('ABC-1', { question: true, open: false })] }))).not.toContain('appointment')
  })

  it('counts reruns and checkpoints on open tasks only', () => {
    expect(momentsOf(scene({ blocks: [block('ABC-1', { sessions: runs('launch', 'relay', 'launch') })] }))).toContain('rerun')
    expect(momentsOf(scene({ blocks: [block('ABC-1', { sessions: runs('launch', 'checkpoint') })] }))).toContain('checkpoint')
    expect(momentsOf(scene({ blocks: [block('ABC-1', { open: false, sessions: runs('launch', 'checkpoint', 'launch') })] }))).not.toContain('rerun')
  })

  it('notices a month over a thousand dollars', () => {
    expect(momentsOf(scene({ monthCost: 1000 }))).toContain('spend')
    expect(momentsOf(scene({ monthCost: 999.99 }))).not.toContain('spend')
  })
})

describe('longestRun', () => {
  it('takes the open task with the most sessions', () => {
    expect(longestRun([block('ABC-1', { sessions: runs('launch', 'launch') }), block('ABC-2', { sessions: runs('launch', 'launch', 'launch', 'launch') })])).toBe(4)
  })
})

describe('pickMeme', () => {
  it('takes a moment on the lower half of the draw', () => {
    const draws = [0.2, 0.7]
    expect(pickMeme(['calm', 'spend'], 5, () => draws.shift()!)).toEqual({ moment: 'spend' })
  })

  it('takes a general line, the drive or a play from its first act on the upper half, and always without moments', () => {
    const draws = [0.6, 0.7]
    expect(pickMeme(['calm'], 5, () => draws.shift()!)).toEqual({ drive: true })
    expect(pickMeme([], 5, () => 0.8)).toEqual({ play: 'picture', act: 0 })
    expect(pickMeme([], 5, () => 0.99)).toEqual({ play: 'spoons', act: 0 })
    expect(pickMeme([], 5, () => 0)).toEqual({ line: 0 })
  })

  it('never draws the previous line again', () => {
    expect(pickMeme([], 5, () => 0, { line: 0 })).toEqual({ line: 1 })
    expect(pickMeme([], 5, () => 0.7, { drive: true })).toEqual({ line: 4 })
    expect(pickMeme([], 5, () => 0.8, { drive: true })).toEqual({ play: 'picture', act: 0 })
    expect(pickMeme([], 5, () => 0.8, { play: 'picture', act: 3 })).toEqual({ drive: true })
    expect(pickMeme([], 5, () => 0.99, { play: 'picture', act: 3 })).toEqual({ play: 'spoons', act: 0 })
    expect(pickMeme([], 1, () => 0.2, { line: 0 })).toEqual({ drive: true })
  })

  it('leaves the previous moment out of the moments', () => {
    const draws = [0.2, 0]
    expect(pickMeme(['calm', 'spend'], 5, () => draws.shift()!, { moment: 'calm' })).toEqual({ moment: 'spend' })
    expect(pickMeme(['calm'], 5, () => 0, { moment: 'calm' })).toEqual({ line: 0 })
  })
})

describe('playMotion', () => {
  const pace = { charMs: 10, pauseMs: 100 }
  const parts = ['Full picture.', ' Full.', ' Picture.']
  // Typed by: 'Full picture.' at 130, ' Full.' starts at 230 and ends at 290, ' Picture.' starts at 390 and ends at 480.

  it('stops the sea when the second part of the picture starts and the cloud once the line is typed', () => {
    expect(playMotion('picture', 0, 4, 229, parts, pace)).toEqual({ sea: 1, cloud: 1 })
    expect(playMotion('picture', 0, 4, 230, parts, pace)).toEqual({ sea: 0, cloud: 1 })
    expect(playMotion('picture', 0, 4, 479, parts, pace)).toEqual({ sea: 0, cloud: 1 })
    expect(playMotion('picture', 0, 4, 480, parts, pace)).toEqual({ sea: 0, cloud: 0 })
  })

  it("keeps everything still in the picture's middle acts and runs it backwards in the last", () => {
    expect(playMotion('picture', 1, 4, 0, parts, pace)).toEqual({ sea: 0, cloud: 0 })
    expect(playMotion('picture', 2, 4, 5000, parts, pace)).toEqual({ sea: 0, cloud: 0 })
    expect(playMotion('picture', 3, 4, 0, parts, pace)).toEqual({ sea: -1, cloud: -1 })
  })

  it('leaves the voyage alone in the other plays', () => {
    for (const act of [0, 3]) expect(playMotion('spoons', act, 4, 300, parts, pace)).toEqual({ sea: 1, cloud: 1 })
  })
})

describe('emptyCard', () => {
  it('keeps the plain line while open tasks are only held back', () => {
    expect(emptyCard({ done: 3, total: 5, backlog: 2 })).toBe('held')
  })

  it('points at the backlog when the chain is through and the backlog is not', () => {
    expect(emptyCard({ done: 5, total: 5, backlog: 2 })).toBe('shelved')
    expect(emptyCard({ done: 0, total: 0, backlog: 1 })).toBe('shelved')
  })

  it('tells a project with no tasks at all from one with everything done', () => {
    expect(emptyCard({ done: 0, total: 0, backlog: 0 })).toBe('ghost')
    expect(emptyCard({ done: 19, total: 19, backlog: 0 })).toBe('finished')
  })
})

describe('harborMemes', () => {
  const day = (date: string, counts: Record<string, number>) => ({ day: date, counts })
  const harbor = (extra: Partial<Harbor> = {}): Harbor => ({ projects: ['ABC', 'XYZ'], launches: [], questions: 0, fiveHour: null, ...extra })

  it('always has the line about itself', () => {
    expect(harborMemes(harbor())).toEqual([{ kind: 'self' }])
  })

  it('names the busiest day once it reaches fifty launches', () => {
    const launches = [day('2026-10-07', { ABC: 20, XYZ: 10 }), day('2026-10-08', { ABC: 40, XYZ: 12 })]
    expect(harborMemes(harbor({ launches }))).toContainEqual({ kind: 'peak', day: '2026-10-08', count: 52 })
    expect(harborMemes(harbor({ launches: [day('2026-10-08', { ABC: 49 })] })).map((meme) => meme.kind)).not.toContain('peak')
  })

  it('finds a favourite holding three quarters of at least fifty launches, among several projects', () => {
    const launches = [day('2026-10-08', { ABC: 45, XYZ: 15 })]
    expect(harborMemes(harbor({ launches }))).toContainEqual({ kind: 'favorite', project: 'ABC', count: 45, total: 60 })
    expect(harborMemes(harbor({ launches: [day('2026-10-08', { ABC: 44, XYZ: 16 })] })).map((meme) => meme.kind)).not.toContain('favorite')
    expect(harborMemes(harbor({ projects: ['ABC'], launches: [day('2026-10-08', { ABC: 60 })] })).map((meme) => meme.kind)).not.toContain('favorite')
  })

  it('counts waiting questions from three and the five-hour limit from half', () => {
    expect(harborMemes(harbor({ questions: 3, fiveHour: 50 }))).toEqual([{ kind: 'self' }, { kind: 'questions', count: 3 }, { kind: 'limit', percent: 50 }])
    expect(harborMemes(harbor({ questions: 2, fiveHour: 49.9 }))).toEqual([{ kind: 'self' }])
  })
})
