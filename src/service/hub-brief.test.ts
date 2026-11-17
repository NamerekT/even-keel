import { describe, expect, it, vi } from 'vitest'
import { CheckReports } from '../chain/checkreports.js'
import { emptyChainState, type ChainState } from '../chain/model.js'
import { parseConfig } from '../config.js'
import { BriefCopy } from '../machine/brief.js'
import { BriefSender, hubBrief, type BriefSources } from './hub-brief.js'

const TREE = 'a'.repeat(40)

function sources(over: Partial<BriefSources> = {}): BriefSources {
  const config = parseConfig({ projects: [{ id: 'project-1', key: 'ABC', repo: '/hub/one', tracker: 'huly' }, { id: 'project-2', key: 'DEF', repo: '/hub/two', tracker: 'huly' }] })
  const reports = new CheckReports()
  reports.report('project-1', 'ABC-1', { tree: TREE, commands: ['npm test'] })
  const state: ChainState = emptyChainState()
  return {
    config: () => config,
    folders: () => ({ 'project-1': '/machine/one' }),
    runsOf: (project) => (project === 'project-1' ? { 'ABC-2': { provider: 'claude', model: 'opus', effort: null } } : {}),
    tasksOf: (project) => (project === 'project-1' ? ['ABC-1', 'ABC-2'] : ['DEF-1']),
    state: () => state,
    demoOwns: () => false,
    reports,
    ...over,
  }
}

describe('the hub brief', () => {
  it('holds only the machine projects, each in its folder there, with their runs, lists and reports', () => {
    const brief = hubBrief(sources())
    expect(brief.config.projects).toEqual({ 'project-1': '/machine/one' })
    expect(brief.runs).toEqual({ 'project-1': { 'ABC-2': { provider: 'claude', model: 'opus', effort: null } } })
    expect(brief.tasks).toEqual({ 'project-1': ['ABC-1', 'ABC-2'] })
    expect(brief.reports['project-1']?.['ABC-1']?.tree).toBe(TREE)
    expect(brief.reports['project-2']).toBeUndefined()
  })

  it('gives the machine copy the project of a listed task and of a chain current one', () => {
    const state = emptyChainState()
    state.active.push({ project: 'project-1', current: { task: 'ABC-9' } } as unknown as ChainState['active'][number])
    const copy = new BriefCopy()
    expect(copy.received).toBe(false)
    copy.take(hubBrief(sources({ state: () => state })))
    expect(copy.received).toBe(true)
    expect(copy.projectOf('ABC-1')).toBe('project-1')
    expect(copy.projectOf('ABC-9')).toBe('project-1')
    expect(copy.projectOf('DEF-1')).toBeUndefined()
    expect(copy.configStore.current.projects['project-1']).toBe('/machine/one')
  })

  it('reads a brief kept from before without counting it as the hub own, and gives way to the hub own (BTN-1226)', () => {
    const state = emptyChainState()
    state.active.push({ project: 'project-1', current: { task: 'ABC-9' }, paused: false } as unknown as ChainState['active'][number])
    const copy = new BriefCopy()
    expect(copy.held).toBe(false)
    copy.keep(hubBrief(sources({ state: () => state })))
    expect(copy).toMatchObject({ received: false, held: true })
    expect(copy.currentOf('ABC-9')).toBe('project-1')
    expect(copy.configStore.current.projects['project-1']).toBe('/machine/one')
    copy.take(hubBrief(sources()))
    copy.keep(hubBrief(sources({ state: () => state })))
    expect(copy.received).toBe(true)
    expect(copy.currentOf('ABC-9')).toBeUndefined()
  })

  it('sends the brief only when it changed, and again after a failed send or a new connection', async () => {
    let unattended = false
    const tell = vi.fn(async () => {})
    const sender = new BriefSender(() => ({ ...hubBrief(sources()), unattended }), tell)
    await sender.send()
    await sender.send()
    expect(tell).toHaveBeenCalledTimes(1)
    unattended = true
    await sender.send()
    expect(tell).toHaveBeenCalledTimes(2)
    sender.forget()
    await sender.send()
    expect(tell).toHaveBeenCalledTimes(3)
    tell.mockRejectedValueOnce(new Error('offline'))
    unattended = false
    await expect(sender.send()).rejects.toThrow('offline')
    await sender.send()
    expect(tell).toHaveBeenCalledTimes(5)
  })
})
