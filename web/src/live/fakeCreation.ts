import { remoteFailure, remoteName, remoteShaped } from '../../../src/git/clone-progress.js'
import { fail, notice, type Notice } from '../../../src/notice/notice.js'
import { remoteOffer } from '../../../src/projects/remote-branches.js'
import { targetKind } from '../../../src/projects/target.js'
import type { EvenKeelState, FolderPlace, JobStep, ProjectCheck, ProjectDraft, SourceRead, StepJob } from '../../../src/state.js'

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
// What git keeps of a clone whose network went down at 10% (BTN-1100).
const CUT_OFF_OUT = [
  'error: RPC failed; curl 56 Recv failure: Connection was reset',
  'error: 43086 bytes of body are still expected',
  'fetch-pack: unexpected disconnect while reading sideband packet',
  'fatal: early EOF',
  'fatal: fetch-pack: invalid index-pack output',
].join('\n')

/** A fake remote's branches: one with `many` in its address has a thousand and more, as a big project's (BTN-1096). */
function fakeRemoteHeads(remote: string): { head: string; branches: string[] } {
  const few = ['develop', 'feature/login', 'main', 'release/v1', 'abc-7/task']
  if (!remote.includes('many')) return { head: 'main', branches: few }
  const areas = ['api', 'docs', 'editor', 'search', 'terminal']
  const many = Array.from({ length: 1200 }, (_, index) => `${index % 3 === 0 ? 'fix' : 'feature'}/${areas[index % areas.length]}-${index}`)
  return { head: 'main', branches: [...few, ...many] }
}

const SSH_TAIL ='\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n'

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
 * there and empty; a remote with `again` has a clone of it in the projects folder already, one with `many` has over a
 * thousand branches. `null` — the draft names
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
  if (typed === '' && /[\\/<>:"|?*]/.test(given)) return { ...NONE, ...(clone ? { remoteBranches: remoteOffer(fakeRemoteHeads(remote), draft.branch) } : {}), notice: notice('wizard.folderName', { value: given }) }
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
  const offer = clone ? { remoteBranches: remoteOffer(fakeRemoteHeads(remote), draft.branch) } : {}
  const found = { root, current: clone ? 'main' : null, suggested: null, branches: null, ...offer, place }
  if (taken !== undefined) return { ...found, notice: notice(plain ? 'wizard.folderTaken' : 'wizard.repoTaken', { project: taken[0] }) }
  if (clone && filled) return { ...found, notice: notice('wizard.folderFilled', { path: root }) }
  return { ...found, notice: null }
}

type FakeRead = { draft: ProjectDraft; read: SourceRead; notice: null } | { draft: null; read: SourceRead | null; notice: Notice | null }

/**
 * The wizard's one field read by the fake's rules (BTN-1093), as the service's `readTarget` does: an address is a
 * clone; a bare name a new folder in the projects folder; a relative path, a disk and the home folder are refused; for a
 * full path a segment with `inside` is a subfolder of the repository above it, `missing` is not there, `empty` or `full`
 * is a folder without git, anything else a repository's top (`noremote` — without a remote, `fresh` — with no commit).
 * Git with no name or e-mail refuses the clone and the new repository. `null` — the draft has no field to read.
 */
export function fakeTarget(state: EvenKeelState, draft: ProjectDraft): FakeRead | null {
  if (draft.git === false || draft.target === undefined) return null
  const { target, folder, repo, ...bare } = draft
  const example = state.platform === 'win32' ? 'C:\\Projects\\my-app' : '/home/me/projects/my-app'
  const kind = targetKind(target, state.platform)
  const refused = (code: Notice, read: SourceRead | null = null): FakeRead => ({ draft: null, read, notice: code })
  const anonymous = state.git !== undefined && (state.git.name === null || state.git.email === null)
  const made = (next: ProjectDraft, read: SourceRead): FakeRead => (anonymous ? refused(notice('git.noIdentity', {}), read) : { draft: next, read, notice: null })
  const typed = target.trim()
  if (kind.kind === 'blank') return { draft: null, read: null, notice: null }
  if (kind.kind === 'none') return refused(notice('wizard.notTarget', { example }))
  if (kind.kind === 'address') return made({ ...bare, repo, ...(folder === undefined ? {} : { folder }), source: 'clone', remote: typed }, { as: 'clone', host: kind.host })
  if (kind.kind === 'name') return made({ ...bare, repo: '', source: 'new', folder: typed }, { as: 'name' })
  if (kind.kind === 'relative') return refused(notice('wizard.fullPath', { path: typed, example }))
  const path = typed.replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^(?:[A-Za-z]:)?$|^~$/.test(path)) return refused(notice('wizard.rootFolder', { path: typed }))
  const segments = path.split('/')
  const inside = segments.findIndex((segment) => segment.includes('inside'))
  if (inside > 1) return refused(notice('wizard.insideRepo', { path, root: segments.slice(0, inside).join('/') }))
  const last = segments[segments.length - 1]!
  if (last.includes('missing')) return made({ ...bare, repo: path, source: 'new' }, { as: 'make' })
  if (last.includes('empty') || last.includes('full')) return made({ ...bare, repo: path, source: 'new' }, { as: 'here' })
  const remote = last.includes('noremote') ? null : { name: 'origin', url: `https://git.example.com/acme/${last}.git` }
  return { draft: { ...bare, repo: path, source: 'existing' }, read: { as: 'existing', remote }, notice: null }
}

const CLONE_STEPS = ['folder', 'clone', 'project', 'trust', 'packages']
const NEW_STEPS = ['folder', 'init', 'project', 'trust', 'packages']

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

// The steps before the running one took 4 s each; the running one began 92 s ago and its time ticks on.
const upTo = (ids: string[], running: number): JobStep[] => {
  const start = Date.now() - 92_000 - running * 4_000
  const at = (ms: number) => new Date(start + ms).toISOString()
  return ids.map((id, index) => {
    if (index < running) return { id, state: 'done', startedAt: at(index * 4_000), endedAt: at((index + 1) * 4_000) }
    if (index === running) return { id, state: 'running', startedAt: at(index * 4_000) }
    return { id, state: 'waiting' }
  })
}

/**
 * `?job=connecting|enumerating|clone|lfs|failed|refused|identity|packages|done` — the wizard's creation window in that
 * state: a clone before the server answers, while the server lists the objects, receiving objects, the LFS files after
 * it, a clone whose network broke off at 10%, one git refused for a reason it does not name, a new repository's first
 * commit refused for git's missing name and e-mail, the packages failing after the entry is written, a project made.
 */
export function fakeJob(mode: string | null): StepJob | null {
  if (mode === 'connecting' || mode === 'enumerating') {
    const steps = upTo(CLONE_STEPS, 1)
    steps[1] = { ...steps[1]!, progress: mode === 'connecting' ? { stage: 'connecting' } : { stage: 'enumerating', objects: 1_234_567 } }
    return job(steps)
  }
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
  if (mode === 'failed' || mode === 'refused') {
    const steps = upTo(CLONE_STEPS, 1)
    steps[1] = { id: 'clone', state: 'failed' }
    const remote = 'https://git.example.com/acme/example-app.git'
    const failure = mode === 'failed' ? notice('git.cloneBroken', { percent: 10 }, { detail: CUT_OFF_OUT }) : notice('git.remoteFailed', { remote }, { detail: BROKEN_OUT })
    return job(steps, { failure })
  }
  if (mode === 'identity') {
    const steps = upTo(NEW_STEPS, 1)
    steps[1] = { id: 'init', state: 'failed' }
    return job(steps, { failure: notice('git.noIdentity', {}) })
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

/** `git/identity` as the service writes git's global name and e-mail: both trimmed, a blank one refused. */
export function fakeGitIdentity(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (name !== 'git/identity' || state.git === undefined) return null
  const who = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim()
  if (who === '' || email === '') throw fail('git.identityBlank', {})
  return { ...state, git: { ...state.git, name: who, email } }
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
