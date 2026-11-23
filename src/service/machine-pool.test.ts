import { describe, expect, it } from 'vitest'
import type { CloneProgress } from '../git/clone-progress.js'
import { StepJobs, type JobPlan } from '../jobs/runner.js'
import type { FolderProbe, FolderSpec, FolderStep } from '../machine/folder-check.js'
import { fail, notice, type Notice } from '../notice/notice.js'
import type { PoolTarget } from './machine-network.js'
import { JOIN_KIND, stepOf } from '../jobs/model.js'
import { connectPlan, joinPlan, onMachines, probeOn, probeProject, type ConnectDeps, type PoolNetwork } from './machine-pool.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const LAPTOP = '99999999-9999-4999-8999-999999999999'
const OWN = '88888888-8888-4888-8888-888888888888'
const TARGET: PoolTarget = { id: LAPTOP, name: 'Example laptop', root: '/home/example/projects' }
const MINI = '77777777-7777-4777-8777-777777777777'
const MINI_TARGET: PoolTarget = { id: MINI, name: 'Example mini', root: '/Users/example/projects' }

/** The hub's network as the job sees it: each call recorded, the checks answered from `refusals`. */
function fakeNetwork() {
  const calls: string[] = []
  const refusals: Partial<Record<FolderStep, Notice>> = {}
  const probes: Record<string, FolderProbe> = {}
  let shown: ((progress: CloneProgress) => void) | undefined
  const network: PoolNetwork = {
    target: async (machine) => {
      if (machine === OWN) throw fail('pool.ownMachine', {})
      return machine === MINI ? MINI_TARGET : TARGET
    },
    folders: () => ({
      probe: async (spec) => {
        calls.push(`probe ${spec.project} ${spec.folder} ${spec.remotes?.join(' ') ?? 'unknown'}`)
        return probes[spec.folder] ?? { state: 'free' }
      },
      check: async (step: FolderStep, spec: FolderSpec) => {
        calls.push(`check ${step} ${spec.folder}${spec.remotes === null ? ' unknown' : ''}`)
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
  return { network, calls, refusals, probes }
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

})

describe("the wizard's machines (BTN-1297)", () => {
  const creationOf = (calls: string[]): JobPlan => {
    let made: string | undefined
    return {
      kind: 'project',
      subject: 'D:\\repos\\abc',
      steps: [{ id: 'project', run: async () => void (made = PROJECT) }],
      keptAfter: 'project',
      result: () => made,
      undo: async () => void calls.push('undo the project'),
    }
  }

  it('connects each machine once the project is made, a clone into a free folder, a clone already there taken as it is', async () => {
    const { network, calls, probes } = fakeNetwork()
    probes['/Users/example/projects/abc'] = { state: 'clone' }
    const plan = await onMachines(depsOf(network), creationOf(calls), [{ machine: LAPTOP, folder: '/home/example/projects/apps/abc' }, { machine: MINI }], true)
    const { view } = await run(plan)
    expect(view()).toMatchObject({ kind: 'project', done: true, result: PROJECT })
    expect(view().steps.map((step) => step.id).slice(0, 3)).toEqual(['project', `machine-clone@${LAPTOP}`, `machine-place@${LAPTOP}`])
    expect(calls).toContain(`probe ${PROJECT} /home/example/projects/apps/abc https://forge.example.com/other/abc.git https://forge.example.com/team/abc.git`)
    expect(calls).toContain('clone https://forge.example.com/team/abc.git /home/example/projects/apps/abc')
    expect(calls.filter((call) => call.startsWith('clone'))).toHaveLength(1)
    expect(calls).toContain(`place ${PROJECT} /Users/example/projects/abc`)
    // The hub stays in the pool: only an unticked hub is turned off.
    expect(calls.filter((call) => call.startsWith('enable'))).toEqual([`enable ${PROJECT} ${LAPTOP} true`, `enable ${PROJECT} ${MINI} true`])
  })

  it('turns the hub off once a machine is on when the hub is not ticked', async () => {
    const { network, calls } = fakeNetwork()
    await run(await onMachines(depsOf(network), creationOf(calls), [{ machine: LAPTOP }], false))
    expect(calls.slice(-2)).toEqual([`enable ${PROJECT} ${LAPTOP} true`, `enable ${PROJECT} ${OWN} false`])
  })

  it("a machine whose folder is taken fails alone: the next one is connected, the failure stays on that machine's step", async () => {
    const { network, calls, probes } = fakeNetwork()
    const taken = notice('pool.foreignRepo', { folder: '/home/example/projects/abc', remote: 'https://forge.example.com/other/abc.git' })
    probes['/home/example/projects/abc'] = { state: 'taken', notice: taken }
    const { view } = await run(await onMachines(depsOf(network), creationOf(calls), [{ machine: LAPTOP }, { machine: MINI }], true))
    expect(view()).toMatchObject({ done: false, failure: taken, result: PROJECT })
    expect(view().steps.find((step) => step.id === `machine-clone@${LAPTOP}`)).toMatchObject({ state: 'failed', failure: taken })
    expect(view().steps.find((step) => step.id === `machine-enable@${MINI}`)).toMatchObject({ state: 'done' })
    expect(calls).not.toContain(`place ${PROJECT} /home/example/projects/abc`)
  })

  it('probes a folder inside the machine folder of projects only, for a project not made yet', async () => {
    const { network, calls } = fakeNetwork()
    expect(await probeOn(network, LAPTOP, '/home/example/projects/abc', 'https://forge.example.com/team/abc.git')).toEqual({ state: 'free' })
    expect(calls).toEqual(['probe draft /home/example/projects/abc https://forge.example.com/team/abc.git'])
    expect(await probeOn(network, LAPTOP, '/srv/abc', 'https://forge.example.com/team/abc.git')).toEqual({
      state: 'taken',
      notice: { code: 'pool.outside', params: { folder: '/srv/abc', root: '/home/example/projects' } },
    })
  })

  it('probes a folder for a project already made against its remotes', async () => {
    const { network, calls } = fakeNetwork()
    expect(await probeProject(depsOf(network), PROJECT, LAPTOP, '/home/example/projects/abc')).toEqual({ state: 'free' })
    expect(calls).toEqual([`probe ${PROJECT} /home/example/projects/abc https://forge.example.com/other/abc.git https://forge.example.com/team/abc.git`])
  })
})

describe('a project with no repository of its own on the hub (BTN-1554)', () => {
  const MOVED = 'D:\\repos\\moved'
  const unknownOf = (network: PoolNetwork): ConnectDeps => ({ ...depsOf(network), factsOf: async () => ({ repo: MOVED, remotes: null, branch: 'trunk', claude: true }) })
  const HAS_REPO = '/home/example/projects/abc'
  const taken = { state: 'clone', notice: notice('pool.hubNoRepositoryTaken', { folder: HAS_REPO }) } as const

  it('takes a clone already on the machine as it is, its own remotes checked', async () => {
    const { network, calls, probes } = fakeNetwork()
    probes[HAS_REPO] = taken
    expect(await probeProject(unknownOf(network), PROJECT, LAPTOP, HAS_REPO)).toEqual(taken)
    expect(calls).toEqual([`probe ${PROJECT} ${HAS_REPO} unknown`])

    calls.length = 0
    const { view } = await run(await connectPlan(unknownOf(network), PROJECT, { machine: LAPTOP, folder: HAS_REPO, clone: 'auto' }))
    expect(view()).toMatchObject({ done: true, failure: null })
    expect(calls).toContain(`check remote ${HAS_REPO} unknown`)
    expect(calls.at(-1)).toBe(`enable ${PROJECT} ${LAPTOP} true`)
  })

  it('refuses a clone, with no remote to clone from, by its own code rather than another repository', async () => {
    const { network, calls } = fakeNetwork()
    const refusal = { state: 'taken', notice: notice('pool.hubNoRepository', { repo: MOVED }) }
    expect(await probeProject(unknownOf(network), PROJECT, LAPTOP, '/home/example/projects/empty')).toEqual(refusal)
    for (const clone of [true, 'auto'] as const) {
      const { view } = await run(await connectPlan(unknownOf(network), PROJECT, { machine: LAPTOP, folder: '/home/example/projects/empty', clone }))
      expect(view().failure).toMatchObject({ code: 'pool.hubNoRepository', params: { repo: MOVED } })
    }
    expect(calls.some((call) => call.startsWith('clone'))).toBe(false)
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
