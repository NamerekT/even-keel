import { describe, expect, it } from 'vitest'
import type { TaskSession } from '../../../src/chain/launches.js'
import type { ChainBlock } from '../state.js'
import { longestRun, momentsOf, pickMeme, type Scene } from './memes.js'

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

  it('takes a general line or the drive on the upper half, and always without moments', () => {
    const draws = [0.6, 0.99]
    expect(pickMeme(['calm'], 5, () => draws.shift()!)).toEqual({ drive: true })
    expect(pickMeme([], 5, () => 0)).toEqual({ line: 0 })
  })
})
