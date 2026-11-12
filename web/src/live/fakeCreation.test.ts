import { describe, expect, it } from 'vitest'
import type { EvenKeelState, ProjectDraft } from '../../../src/state.js'
import { FAKE_PROJECTS_DIR, fakeJob, fakeJobCommand, fakePlace, withAddedJob } from './fakeCreation.js'

const state = { projects: ['OPS'], config: { projects: { OPS: { repo: 'D:/Projects/ops' } } } } as unknown as EvenKeelState
const draft = (change: Partial<ProjectDraft>): ProjectDraft =>
  ({ repo: '', branch: '', key: 'SHOP', name: '', tracker: 'huly', trackerProject: '', profile: null, slot: 0, milestones: [], provider: null, ...change }) as ProjectDraft

describe("the fake's project creation (BTN-1048)", () => {
  it("names a clone's folder after its remote and refuses a remote as git would", () => {
    const remote = 'https://git.example.com/acme/storefront.git'
    expect(fakePlace(state, draft({ source: 'clone', remote, folder: '' }))).toMatchObject({ root: `${FAKE_PROJECTS_DIR}/storefront`, current: 'main', place: { dir: FAKE_PROJECTS_DIR, name: 'storefront', state: 'free' }, notice: null })
    expect(fakePlace(state, draft({ source: 'clone', remote: 'https://git.example.com/denied.git' }))?.notice?.code).toBe('git.remoteDenied')
    expect(fakePlace(state, draft({ source: 'clone', remote: '' }))).toMatchObject({ root: null, notice: null })
  })

  it('leaves a checkout already there and a typed folder without git to the old rules', () => {
    expect(fakePlace(state, draft({ source: 'existing', repo: 'D:/Projects/shop' }))).toBeNull()
    expect(fakePlace(state, draft({ git: false, repo: 'D:/notes' }))).toBeNull()
  })

  it("answers project/add with a finished job naming the new project, one job at a time", () => {
    const after = { ...state, projects: ['OPS', 'SHOP'], config: { projects: { ...state.config.projects, SHOP: { repo: `${FAKE_PROJECTS_DIR}/storefront` } } } } as unknown as EvenKeelState
    const added = withAddedJob(state, after, draft({ source: 'clone', remote: 'x', folder: '' }))
    expect(added.jobs).toEqual([expect.objectContaining({ kind: 'project', done: true, result: 'SHOP', subject: `${FAKE_PROJECTS_DIR}/storefront` })])
    expect(added.jobs![0]!.steps.map((step) => step.id)).toEqual(['folder', 'clone', 'project', 'packages'])
    expect(() => withAddedJob(added, added, draft({}))).toThrow()
  })

  it('finishes a failed job on Retry and drops it on Cancel and Close', () => {
    const failed = { ...state, jobs: [fakeJob('failed')!] }
    const retried = fakeJobCommand(failed, 'job/retry', { id: 'job-fake' })!
    expect(retried.jobs![0]).toMatchObject({ done: true, failure: null })
    expect(fakeJobCommand(failed, 'job/cancel', { id: 'job-fake' })!.jobs).toEqual([])
    expect(fakeJobCommand(retried, 'job/close', { id: 'job-fake' })!.jobs).toEqual([])
    expect(fakeJobCommand(failed, 'project/add', {})).toBeNull()
  })
})
