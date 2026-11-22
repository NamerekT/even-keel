import { describe, expect, it } from 'vitest'
import type { TaskSource } from '../../src/chain/launches.js'
import type { BuiltinTask } from './builtin-tasks.js'
import { taskHomes } from './task-homes.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const work = { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'work', HULY_TOKEN: 'token-work' }
const home = { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'home', HULY_TOKEN: 'token-home' }

const builtin = (task: string): BuiltinTask => ({
  task, project: PROJECT, title: 'A task', status: 'Done', labels: [], related: [], priority: 'none', estimateH: null, component: null, milestone: null, done: true,
  createdAt: '2026-11-02T10:00:00.000Z',
})
const source = (task: string, profile: string | null, url: string | null): TaskSource => ({ task, profile, url, title: 'From the log' })

describe('taskHomes: a task the built-in tracker holds is its own, the rest are where their launch read them (BTN-1497)', () => {
  it('drops the launch\'s Huly profile and link of an imported task, links its card and reaches no Huly', () => {
    const homes = taskHomes(
      [source('ABC-1', 'huly-work', 'https://huly.example.com/workbench/work/tracker/ABC-1')],
      [builtin('ABC-1')],
      [],
      { projects: {}, fallback: work, elsewhere: ['ABC'], byId: { 'huly-work': work } },
    )
    expect(homes.sources).toEqual([source('ABC-1', null, null)])
    expect([...homes.owned]).toEqual([['ABC-1', `/p/${PROJECT}?task=ABC-1`]])
    expect(homes.hulyOf('ABC-1')).toBeUndefined()
  })

  it('leaves the tasks of a built-in project\'s feeds as their launches read them', () => {
    const homes = taskHomes(
      [source('ABCH-3', 'huly-home', 'https://huly.example.com/workbench/home/tracker/ABCH-3'), source('ABCGH-4', null, 'https://github.com/example/repo/issues/4')],
      [builtin('ABC-1')],
      [],
      { projects: { ABCH: home }, fallback: work, elsewhere: ['ABC', 'ABCGH'], byId: { 'huly-work': work, 'huly-home': home } },
    )
    expect(homes.sources).toEqual([
      source('ABCH-3', 'huly-home', 'https://huly.example.com/workbench/home/tracker/ABCH-3'),
      source('ABCGH-4', null, 'https://github.com/example/repo/issues/4'),
    ])
    expect(homes.owned.has('ABCH-3')).toBe(false)
    expect(homes.hulyOf('ABCH-3')?.workspace).toBe('home')
    expect(homes.hulyOf('ABCGH-4')).toBeUndefined()
  })

  it('keeps a built-in task off a Huly project of the same key, whose own tasks still go to Huly', () => {
    const homes = taskHomes([], [builtin('ABC-1')], [], { projects: { ABC: work }, fallback: null, elsewhere: ['ABC'] })
    expect(homes.hulyOf('ABC-1')).toBeUndefined()
    expect(homes.hulyOf('ABC-50')?.workspace).toBe('work')
  })

  it('holds the old ids a switch left behind, without a link, unless a project or feed gives their prefix now', () => {
    const homes = taskHomes(
      [source('OLD-1', 'huly-work', 'https://huly.example.com/workbench/work/tracker/OLD-1'), source('TAKEN-2', 'huly-work', 'https://huly.example.com/workbench/work/tracker/TAKEN-2')],
      [],
      ['OLD-1', 'TAKEN-2'],
      { projects: { TAKEN: work }, fallback: work, elsewhere: ['GHN'], prefixes: ['GHN', 'TAKEN'], byId: { 'huly-work': work } },
    )
    expect([...homes.owned]).toEqual([['OLD-1', null]])
    expect(homes.sources).toEqual([source('OLD-1', null, null), source('TAKEN-2', 'huly-work', 'https://huly.example.com/workbench/work/tracker/TAKEN-2')])
    expect(homes.hulyOf('OLD-1')).toBeUndefined()
    expect(homes.hulyOf('TAKEN-2')?.workspace).toBe('work')
  })

  it('takes the prefixes of a service without the list from its Huly projects and the others', () => {
    const homes = taskHomes([], [], ['HUN-1', 'GHN-2', 'OLD-3'], { projects: { HUN: work }, fallback: work, elsewhere: ['GHN'] })
    expect([...homes.owned.keys()]).toEqual(['OLD-3'])
  })
})
