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

  it("carries a machine elsewhere's folders bound to memory, only of the hub's projects, and none without the source (BTN-1648)", () => {
    const memory = () => [{ project: 'project-2', folder: '/hand/two' }, { project: 'gone', folder: '/hand/gone' }]
    expect(hubBrief(sources({ memory })).memory).toEqual([{ project: 'project-2', folder: '/hand/two' }])
    expect(hubBrief(sources())).not.toHaveProperty('memory')
  })

  it('says "Own configuration" of a machine elsewhere only while it is on (BTN-1745)', () => {
    expect(hubBrief(sources({ ownConfig: () => true })).ownConfig).toBe(true)
    expect(hubBrief(sources({ ownConfig: () => false }))).not.toHaveProperty('ownConfig')
    expect(hubBrief(sources())).not.toHaveProperty('ownConfig')
  })

  it("runs the machine's own commands and server commands in its projects, the rest the project's (BTN-994)", () => {
    const own = { 'project-1': { check: ['make check'], servers: { files: { files: { command: '/opt/example/files-mcp' } } } }, 'project-2': { check: ['never'] } }
    const brief = hubBrief(sources({ machineSettings: () => own }))
    expect(brief.config.settings['project-1']).toMatchObject({ check: ['make check'], beforeStart: [], afterGreen: [] })
    expect(brief.config.settings['project-2']?.check).toEqual([])
    expect(brief.servers).toEqual({ 'project-1': own['project-1'].servers })
    const copy = new BriefCopy()
    copy.take(brief)
    expect(copy.serverOf('project-1', 'files', 'files')).toEqual({ command: '/opt/example/files-mcp' })
    expect(copy.configStore.current.settings['project-1']?.check).toEqual(['make check'])
    expect(hubBrief(sources()).config.settings['project-1']?.check).toEqual([])
  })

  it("carries the hub's consent to checked CLI copies, none before the hub names it (BTN-1516)", () => {
    const copy = new BriefCopy()
    expect(copy.cliConsent()).toEqual([])
    copy.take(hubBrief(sources({ cliConsent: () => ['claude'] })))
    expect(copy.cliConsent()).toEqual(['claude'])
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
