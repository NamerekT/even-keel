import { remoteFailure, remoteName, remoteShaped } from '../../../src/git/clone-progress.js'
import { fail, notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, FolderPlace, JobStep, ProjectCheck, ProjectDraft, StepJob } from '../../../src/state.js'

/** Even Keel's projects folder in the fake. */
export const FAKE_PROJECTS_DIR = 'C:/Users/EvenKeelSvc/AppData/Local/even-keel/projects'

const NONE = { root: null, current: null, suggested: null, branches: null }

const BROKEN_OUT = [
  'ssh: hostname contains invalid characters',
  'fatal: Could not read from remote repository.',
  '',
  'Please make sure you have the correct access rights',
  'and the repository exists.',
].join('\n')

const SSH_TAIL = '\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n'

/** What git prints for a remote whose name has the word, as the service reads it (BTN-1091). */
const GIT_OUT: readonly (readonly [string, (remote: string) => string])[] = [
  ['private', (remote) => `remote: Repository not found.\nfatal: repository '${remote}/' not found\n`],
  ['hostkey', () => `Host key verification failed.\r${SSH_TAIL}`],
  ['nokey', (remote) => `${remote.split(':')[0]}: Permission denied (publickey).${SSH_TAIL}`],
]

/**
 * The folder of a clone, a new repository or a named folder without git (BTN-1048) by the fake's rules: a text that is
 * no address is refused as the service refuses it; a remote with `denied`, `nope`, `offline`, `broken`, `private`,
 * `hostkey` or `nokey` is refused as git would; a folder name with `full` holds files, one with `empty` is
 * there and empty; a remote with `again` has a clone of it in the projects folder already. `null` — the draft names
 * a checkout already there, which the old rules check.
 */
export function fakePlace(state: EvenKeelState, draft: ProjectDraft): ProjectCheck['repo'] | null {
  const plain = draft.git === false
  const source = draft.source ?? 'existing'
  if (!plain && source === 'existing') return null
  if (plain && (draft.folder === undefined || draft.repo.trim() !== '')) return null
  const clone = !plain && source === 'clone'
  const remote = (draft.remote ?? '').trim()
  if (clone && remote === '') return { ...NONE, notice: null }
  if (clone && !remoteShaped(remote)) return { ...NONE, notice: notice('git.remoteShape', {}) }
  if (clone && remote.includes('broken')) return { ...NONE, notice: notice('git.remoteFailed', { remote }, { detail: BROKEN_OUT }) }
  const out = clone ? GIT_OUT.find(([word]) => remote.includes(word)) : undefined
  if (out !== undefined) return { ...NONE, notice: remoteFailure(out[1](remote), remote) }
  if (clone && remote.includes('denied')) return { ...NONE, notice: notice('git.remoteDenied', { remote }) }
  if (clone && remote.includes('nope')) return { ...NONE, notice: notice('git.remoteNotFound', { remote }) }
  if (clone && remote.includes('offline')) return { ...NONE, notice: notice('git.remoteNetwork', { remote }, { detail: 'Could not resolve host' }) }
  const typed = draft.repo.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const given = (draft.folder ?? '').trim()
  if (typed === '' && /[\\/<>:"|?*]/.test(given)) return { ...NONE, notice: notice('wizard.folderName', { value: given }) }
  const base = given || (clone ? remoteName(remote) : draft.name.trim() || draft.key.trim().toLowerCase() || 'project')
  const dir = typed === '' ? FAKE_PROJECTS_DIR : null
  const name = typed === '' ? base : typed.slice(typed.lastIndexOf('/') + 1)
  const root = typed === '' ? `${FAKE_PROJECTS_DIR}/${base}` : typed
  const filled = name.includes('full')
  const placeState: FolderPlace['state'] = filled ? 'filled' : name.includes('empty') ? 'empty' : 'free'
  const place: FolderPlace = {
    dir,
    name,
    state: placeState,
    ...(filled && !clone && !plain ? { holds: { files: 1240, bytes: 48_300_000, capped: false } } : {}),
    ...(clone && dir !== null && remote.includes('again') ? { existing: `${FAKE_PROJECTS_DIR}/${base}-2` } : {}),
  }
  const taken = Object.entries(state.config.projects).find(([, form]) => form.repo.toLowerCase() === root.toLowerCase())
  const found = { root, current: clone ? 'main' : null, suggested: null, branches: null, place }
  if (taken !== undefined) return { ...found, notice: notice(plain ? 'wizard.folderTaken' : 'wizard.repoTaken', { project: taken[0] }) }
  if (clone && filled) return { ...found, notice: notice('wizard.folderFilled', { path: root }) }
  return { ...found, notice: null }
}

const CLONE_STEPS = ['folder', 'clone', 'project', 'trust', 'packages']

const job = (steps: StepJob['steps'], change: Partial<StepJob> = {}): StepJob => ({
  id: 'job-fake',
  kind: 'project',
  subject: `${FAKE_PROJECTS_DIR}/example-app`,
  steps,
  failure: null,
  done: false,
  undoable: true,
  ...change,
})

const upTo = (ids: string[], running: number): JobStep[] => ids.map((id, index) => ({ id, state: index < running ? 'done' : index === running ? 'running' : 'waiting' }))

/**
 * `?job=clone|lfs|failed|packages|done` — the wizard's creation window in that state: a clone receiving objects, the
 * LFS files after it, a clone refused halfway, the packages failing after the entry is written, a project made.
 */
export function fakeJob(mode: string | null): StepJob | null {
  if (mode === 'clone') {
    const steps = upTo(CLONE_STEPS, 1)
    steps[1] = { ...steps[1]!, progress: { stage: 'receiving', percent: 42, bytes: 87_400_000, speed: 6_300_000 } }
    return job(steps)
  }
  if (mode === 'lfs') {
    const steps = upTo(['folder', 'clone', 'lfs', 'project', 'trust', 'packages'], 2)
    steps[2] = { ...steps[2]!, progress: { stage: 'lfs', percent: 63 } }
    return job(steps)
  }
  if (mode === 'failed') {
    const steps = upTo(CLONE_STEPS, 1)
    steps[1] = { id: 'clone', state: 'failed' }
    return job(steps, { failure: notice('git.remoteNetwork', { remote: 'https://git.example.com/acme/example-app.git' }, { detail: 'RPC failed; curl 56 Recv failure' }) })
  }
  if (mode === 'packages') {
    const steps = upTo(CLONE_STEPS, 4)
    steps[4] = { id: 'packages', state: 'failed' }
    return job(steps, { failure: notice('job.packagesUnready', { packages: ['tasks@even-keel'] }), undoable: false, result: 'OPS' })
  }
  if (mode === 'done') return job(upTo(CLONE_STEPS, CLONE_STEPS.length), { done: true, undoable: false, result: 'OPS' })
  return null
}

/**
 * The job's commands: `job/retry` finishes the failed step and the rest, `job/cancel` and `job/close` drop the job.
 * `project/add` of a draft Even Keel makes a folder for wraps the project put in a finished job, so the window shows.
 */
export function fakeJobCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (!name.startsWith('job/')) return null
  const jobs = state.jobs ?? []
  const found = jobs.find((each) => each.id === body.id)
  if (found === undefined) throw fail('job.unknown', {})
  if (name === 'job/retry') {
    if (found.failure === null) throw fail('job.notFailed', {})
    const finished = { ...found, steps: found.steps.map((step) => ({ id: step.id, state: 'done' as const })), failure: null, done: true, undoable: false, result: found.result ?? 'OPS' }
    return { ...state, jobs: jobs.map((each) => (each === found ? finished : each)) }
  }
  return { ...state, jobs: jobs.filter((each) => each !== found) }
}

/** The fake's `project/add` answer as the service's job: a finished job naming the project that came in. */
export function withAddedJob(before: EvenKeelState, after: EvenKeelState, draft: ProjectDraft): EvenKeelState {
  if ((before.jobs ?? []).some((each) => each.kind === 'project')) throw fail('job.busy', {})
  const made = after.projects.find((each) => !before.projects.includes(each))
  const source = draft.git === false ? 'plain' : (draft.source ?? 'existing')
  const ids = [...(draft.repo.trim() === '' && source !== 'existing' ? ['folder'] : []), ...(source === 'clone' ? ['clone'] : source === 'new' ? ['init'] : []), 'project', 'packages']
  const subject = after.config.projects[made ?? '']?.repo ?? draft.repo
  return { ...after, jobs: [job(upTo(ids, ids.length), { id: `job-${Date.now()}`, subject, done: true, undoable: false, ...(made === undefined ? {} : { result: made }) })] }
}
