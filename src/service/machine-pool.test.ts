import { describe, expect, it } from 'vitest'
import type { CloneProgress } from '../git/clone-progress.js'
import { StepJobs, type JobPlan } from '../jobs/runner.js'
import type { FolderSpec, FolderStep } from '../machine/folder-check.js'
import { fail, type Notice } from '../notice/notice.js'
import type { PoolTarget } from './machine-network.js'
import { JOIN_KIND, stepOf } from '../jobs/model.js'
import { connectPlan, joinPlan, onMachine, type ConnectDeps, type PoolNetwork } from './machine-pool.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const LAPTOP = '99999999-9999-4999-8999-999999999999'
const OWN = '88888888-8888-4888-8888-888888888888'
const TARGET: PoolTarget = { id: LAPTOP, name: 'Example laptop', root: '/home/example/projects' }

/** The hub's network as the job sees it: each call recorded, the checks answered from `refusals`. */
function fakeNetwork() {
  const calls: string[] = []
  const refusals: Partial<Record<FolderStep, Notice>> = {}
  let shown: ((progress: CloneProgress) => void) | undefined
  const network: PoolNetwork = {
    target: async (machine) => {
      if (machine === OWN) throw fail('pool.ownMachine', {})
      return TARGET
    },
    folders: () => ({
      check: async (step: FolderStep, spec: FolderSpec) => {
        calls.push(`check ${step} ${spec.folder}`)
        return refusals[step] ?? null
      },
      clone: async (spec: FolderSpec, remote: string) => {
        calls.push(`clone ${remote} ${spec.folder}`)
        shown?.({ stage: 'receiving', percent: 50 })
      },
    }),
    watchClone: (_machine, _project, show) => {
      shown = show
      return () => void (shown = undefined)
    },
    place: async (_target, project, folder) => {
      calls.push(`place ${project} ${folder}`)
      return true
    },
    unplace: async (machine, project) => void calls.push(`unplace ${machine} ${project}`),
    setEnabled: async (project, machine, enabled) => void calls.push(`enable ${project} ${machine} ${enabled}`),
  }
  return { network, calls, refusals }
}

const depsOf = (network: PoolNetwork): ConnectDeps => ({
  network,
  own: () => OWN,
  factsOf: async () => ({
    repo: 'D:\\repos\\abc',
    remotes: [{ name: 'upstream', url: 'https://forge.example.com/other/abc.git' }, { name: 'origin', url: 'https://forge.example.com/team/abc.git' }],
    branch: 'trunk',
    claude: true,
  }),
})

const run = async (plan: JobPlan) => {
  const jobs = new StepJobs()
  const id = jobs.start(plan)
  await jobs.settled(id)
  return { jobs, id, view: () => jobs.view().find((job) => job.id === id)! }
}

describe('connecting a machine to a project', () => {
  it('checks a folder named on the machine, then turns the machine on', async () => {
    const { network, calls } = fakeNetwork()
    const plan = await connectPlan(depsOf(network), PROJECT, { machine: LAPTOP, folder: '/home/example/projects/abc-work', clone: false })
    expect(plan).toMatchObject({ kind: 'machine', subject: 'Example laptop', project: PROJECT })
    const { view } = await run(plan)
    expect(view()).toMatchObject({ done: true, failure: null })
    expect(view().steps.map((step) => step.id)).toEqual(['machine-place', 'machine-repo', 'machine-remote', 'machine-branch', 'machine-trust', 'machine-packages', 'machine-push', 'machine-enable'])
    expect(calls).toEqual([
      `place ${PROJECT} /home/example/projects/abc-work`,
      ...['repo', 'remote', 'branch', 'trust', 'packages', 'push'].map((step) => `check ${step} /home/example/projects/abc-work`),
      `enable ${PROJECT} ${LAPTOP} true`,
    ])
  })

  it('clones from origin into the hub folder name by default, with the progress on the clone step', async () => {
    const { network, calls } = fakeNetwork()
    const plan = await connectPlan(depsOf(network), PROJECT, { machine: LAPTOP, clone: true })
    const jobs = new StepJobs()
    const progress: unknown[] = []
    jobs.changed = () => {
      const step = jobs.view()[0]?.steps.find((each) => each.id === 'machine-clone')
      if (step?.progress !== undefined) progress.push(step.progress)
    }
    const id = jobs.start(plan)
    await jobs.settled(id)
    expect(calls.slice(0, 2)).toEqual(['clone https://forge.example.com/team/abc.git /home/example/projects/abc', `place ${PROJECT} /home/example/projects/abc`])
    expect(progress).toContainEqual({ stage: 'receiving', percent: 50 })
  })

  it('stops at a refused check with what to do, goes on from it on Retry, and Cancel takes the machine out of the pool', async () => {
    const { network, calls, refusals } = fakeNetwork()
    refusals.push = { code: 'pool.noPush', params: { remote: 'https://forge.example.com/team/abc.git' } }
    const { jobs, id, view } = await run(await connectPlan(depsOf(network), PROJECT, { machine: LAPTOP, clone: false }))
    expect(view().failure).toMatchObject({ code: 'pool.noPush' })
    expect(view().steps.find((step) => step.id === 'machine-push')?.state).toBe('failed')
    expect(calls.some((call) => call.startsWith('enable'))).toBe(false)

    delete refusals.push
    jobs.retry(id)
    await jobs.settled(id)
    expect(view().done).toBe(true)
    expect(calls.filter((call) => call.startsWith('check repo'))).toHaveLength(1)

    refusals.trust = { code: 'pool.untrusted', params: { folder: '/home/example/projects/abc' } }
    const second = await run(await connectPlan(depsOf(network), PROJECT, { machine: LAPTOP, clone: false }))
    await second.jobs.cancel(second.id)
    expect(calls.at(-1)).toBe(`unplace ${LAPTOP} ${PROJECT}`)
  })

  it('refuses a folder outside the machine folder of projects and the own machine', async () => {
    const { network, calls } = fakeNetwork()
    const { view } = await run(await connectPlan(depsOf(network), PROJECT, { machine: LAPTOP, folder: '/srv/abc', clone: false }))
    expect(view().failure).toMatchObject({ code: 'pool.outside', params: { folder: '/srv/abc', root: '/home/example/projects' } })
    expect(calls).toEqual([])
    await expect(connectPlan(depsOf(network), PROJECT, { machine: OWN, clone: false })).rejects.toThrow(/hub's own machine/)
  })

  it("runs the wizard's project on the machine alone once the project is made", async () => {
    const { network, calls } = fakeNetwork()
    let made: string | undefined
    const creation: JobPlan = {
      kind: 'project',
      subject: 'D:\\repos\\abc',
      steps: [{ id: 'project', run: async () => void (made = PROJECT) }],
      keptAfter: 'project',
      result: () => made,
      undo: async () => void calls.push('undo the project'),
    }
    const { view } = await run(await onMachine(depsOf(network), creation, LAPTOP))
    expect(view()).toMatchObject({ kind: 'project', done: true, result: PROJECT })
    expect(view().steps[0]?.id).toBe('project')
    expect(calls.slice(0, 2)).toEqual(['clone https://forge.example.com/team/abc.git /home/example/projects/abc', `place ${PROJECT} /home/example/projects/abc`])
    expect(calls.slice(-2)).toEqual([`enable ${PROJECT} ${LAPTOP} true`, `enable ${PROJECT} ${OWN} false`])
  })
})

describe('connecting a machine that joined to several projects', () => {
  const OTHER = '22222222-2222-4222-8222-222222222222'

  it('runs each project in turn in one job, its steps named by the project', async () => {
    const { network, calls } = fakeNetwork()
    const plan = await joinPlan(depsOf(network), LAPTOP, [
      { project: PROJECT, clone: true },
      { project: OTHER, clone: false, folder: '/home/example/projects/other' },
    ])
    expect(plan).toMatchObject({ kind: JOIN_KIND, subject: 'Example laptop' })
    expect(plan.project).toBeUndefined()
    const { view } = await run(plan)
    expect(view()).toMatchObject({ done: true, failure: null })
    const ids = view().steps.map((step) => step.id)
    expect(ids.slice(0, 2)).toEqual([`machine-clone@${PROJECT}`, `machine-place@${PROJECT}`])
    expect(ids).toContain(`machine-place@${OTHER}`)
    expect(ids.at(-1)).toBe(`machine-enable@${OTHER}`)
    expect(stepOf(`machine-push@${OTHER}`)).toEqual({ step: 'machine-push', project: OTHER })
    expect(stepOf('machine-push')).toEqual({ step: 'machine-push' })
    expect(calls.filter((call) => call.startsWith('enable'))).toEqual([`enable ${PROJECT} ${LAPTOP} true`, `enable ${OTHER} ${LAPTOP} true`])
    expect(calls).toContain(`place ${OTHER} /home/example/projects/other`)
  })

  it('Cancel takes back only the project not yet connected', async () => {
    const { network, calls } = fakeNetwork()
    const plan = await joinPlan(depsOf(network), LAPTOP, [
      { project: PROJECT, clone: false },
      { project: OTHER, clone: false, folder: '/srv/other' },
    ])
    const { jobs, id, view } = await run(plan)
    expect(view().failure).toMatchObject({ code: 'pool.outside' })
    await jobs.cancel(id)
    expect(calls.filter((call) => call.startsWith('unplace'))).toEqual([])

    const { network: second, calls: made, refusals } = fakeNetwork()
    refusals.push = { code: 'pool.noPush', params: { remote: 'https://forge.example.com/team/abc.git' } }
    const failed = await run(await joinPlan(depsOf(second), LAPTOP, [{ project: PROJECT, clone: false }]))
    await failed.jobs.cancel(failed.id)
    expect(made.at(-1)).toBe(`unplace ${LAPTOP} ${PROJECT}`)
  })

  it('refuses no project at all', async () => {
    const { network } = fakeNetwork()
    await expect(joinPlan(depsOf(network), LAPTOP, [])).rejects.toThrow()
  })
})
