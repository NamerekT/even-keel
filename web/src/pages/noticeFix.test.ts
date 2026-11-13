import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import { fieldFixOf, noticeFixOf } from './noticeFix.js'

describe('noticeFixOf', () => {
  it('turns on a turned-off profile and stops the chains that keep one on (BTN-830)', () => {
    expect(noticeFixOf(notice('profiles.disabled', { profile: 'GitLab · bench', id: 'p-1', project: 'GLP' }))).toEqual({ to: 'enableProfile', profile: 'p-1' })
    const running = notice('profiles.chainsRunning', { profile: 'GitLab · bench', chains: 'GLP, Second', projects: 'id-1,id-2' })
    expect(noticeFixOf(running)).toEqual({ to: 'stopChains', projects: ['id-1', 'id-2'] })
  })
  it('opens the merged task refused by its tracker', () => {
    expect(noticeFixOf(notice('tracker.completeRefused', { task: 'ABC-1' }))).toEqual({ to: 'tracker', task: 'ABC-1' })
  })
  it('sends a status move to the setting it was chosen at: the profile or the source', () => {
    expect(noticeFixOf(notice('tracker.completeRefused', { task: 'ABC-1', status: 'Closed', level: 'source' }))).toEqual({ to: 'moves', level: 'source', task: 'ABC-1' })
    expect(noticeFixOf(notice('statusMove.notDone', { task: 'ABC-1', status: 'Closed', level: 'profile' }))).toEqual({ to: 'moves', level: 'profile', task: 'ABC-1' })
    const refused = notice('statusMove.refused', { task: 'ABC-2', status: 'In Progress', setting: 'start', level: 'profile' })
    expect(noticeFixOf(refused)).toEqual({ to: 'moves', level: 'profile', task: 'ABC-2' })
    expect(noticeFixOf(notice('statusMove.outside', { task: 'ABC-2', status: 'Backlog', setting: 'review', level: 'source' }))).toEqual({ to: 'moves', level: 'source', task: 'ABC-2' })
  })
  it('sends a blocker against the milestone order to "Milestone order" of the tracker window (BTN-792)', () => {
    expect(noticeFixOf(notice('order.later', { task: 'ABC-1', milestone: 'v0.1', blocker: 'ABC-2', blockerMilestone: 'v0.2' }))).toEqual({ to: 'milestoneOrder' })
    expect(noticeFixOf(notice('order.against', { path: 'ABC-1 → ABC-2' }))).toEqual({ to: 'milestoneOrder' })
  })
  it('sends a wrong main branch to the repository tab of the project', () => {
    expect(noticeFixOf(notice('git.noBranch', { project: 'ABC', branch: 'dev', repo: 'D:/abc' }))).toEqual({ to: 'project', tab: 'repo' })
    expect(noticeFixOf(notice('forward.foreign', { from: 'ABC', into: 'ABD' }))).toEqual({ to: 'project', tab: 'repo' })
  })

  it('resumes a chain stopped on git gone from the machine, and sends git without a name to the setup’s Git step (BTN-731)', () => {
    expect(noticeFixOf(notice('git.missing', {}))).toEqual({ to: 'resume' })
    expect(noticeFixOf(notice('git.noIdentity', {}))).toEqual({ to: 'git' })
  })

  it('sends a model the account does not have to the sessions tab of the project', () => {
    expect(noticeFixOf(notice('chain.modelUnavailable', { model: 'openai/denied' }))).toEqual({ to: 'project', tab: 'sessions' })
    expect(noticeFixOf(notice('chain.opencodeCopilot', {}))).toEqual({ to: 'project', tab: 'sessions' })
    expect(noticeFixOf(notice('copilot.modelUnavailable', { model: 'missing-model' }))).toEqual({ to: 'project', tab: 'sessions' })
    const unknown = notice('chain.unknownModel', { task: 'ABC-1', model: 'deepseek-v4.1', agent: 'OpenCode', account: 'opencode', known: ['opencode/big-pickle'] })
    expect(noticeFixOf(unknown)).toEqual({ to: 'project', tab: 'sessions' })
  })

  it('sends an account the shared settings pick to their models tab', () => {
    expect(noticeFixOf(notice('account.sharedPool', { agent: 'codex' }))).toEqual({ to: 'shared', tab: 'models' })
  })

  it('sends a spent limit to the project pool and a lost sign-in to the accounts', () => {
    expect(noticeFixOf(notice('chain.limitSpent', { until: '12:00' }))).toEqual({ to: 'project', tab: 'sessions' })
    expect(noticeFixOf(notice('account.signedOut', {}))).toEqual({ to: 'accounts' })
    expect(noticeFixOf(notice('copilot.notSignedIn', {}))).toEqual({ to: 'accounts' })
  })

  it('sends a refused or missing token to Trackers and CI', () => {
    expect(noticeFixOf(notice('ci.noToken', { kind: 'forgejo' }))).toEqual({ to: 'shared', tab: 'trackers' })
    expect(noticeFixOf(notice('review.denied', { ci: 'Forgejo', status: 403 }))).toEqual({ to: 'shared', tab: 'trackers' })
    expect(noticeFixOf(notice('task.relabelFailed', { task: 'ABC-1' }))).toEqual({ to: 'shared', tab: 'trackers' })
  })

  it('sends the page token to Interface', () => {
    expect(noticeFixOf(notice('config.token', { host: '0.0.0.0' }))).toEqual({ to: 'shared', tab: 'page' })
    expect(noticeFixOf(notice('config.tokenShape', {}))).toEqual({ to: 'shared', tab: 'page' })
  })

  it('sends a file over the attachment limit to Interface, where the limit is', () => {
    expect(noticeFixOf(notice('builtin.fileTooLarge', { name: 'big.zip', limit: 25 * 1024 * 1024 }))).toEqual({ to: 'shared', tab: 'page' })
  })

  it('sends a failed automatic copy of the database to Backups (BTN-1083)', () => {
    expect(noticeFixOf(notice('storage.backupFailed', {}))).toEqual({ to: 'shared', tab: 'backup' })
    expect(noticeFixOf(notice('storage.backupCheckFailed', {}))).toEqual({ to: 'shared', tab: 'backup' })
  })

  it('finds the fix of a reason in the items or the cause', () => {
    const empty = notice('chain.empty', { project: 'ABC' }, { items: [notice('chain.emptyNone', {}), notice('chain.emptyLabels', { labels: ['ready'] })] })
    expect(noticeFixOf(empty)).toEqual({ to: 'project', tab: 'tracker' })
    expect(noticeFixOf(notice('claude.startFailed', { task: 'ABC-1', cwd: 'D:/abc' }, { cause: notice('prompt.empty', { before: 'x', value: 'null' }) }))).toEqual({ to: 'project', tab: 'sessions' })
  })

  it('offers a retry for both Claude trust failures, including nested notices', () => {
    const untrusted = notice('claude.untrusted', { task: 'GLS-4', folder: 'D:/gls', platform: 'win32', user: 'svc' })
    expect(noticeFixOf(untrusted)).toEqual({ to: 'resume' })
    expect(noticeFixOf(notice('chain.empty', { project: 'GLS' }, { cause: untrusted }))).toEqual({ to: 'resume' })
    expect(noticeFixOf(notice('claude.trustWriteFailed', { folder: 'D:/gls' }))).toEqual({ to: 'resume' })
  })

  it('has no fix for a notice nothing on the page fixes', () => {
    expect(noticeFixOf(notice('chain.emptyNone', {}))).toBeNull()
    expect(noticeFixOf(null)).toBeNull()
  })
})

describe('fieldFixOf', () => {
  it('opens the tab of a project field', () => {
    expect(fieldFixOf({ project: 'ABC', field: 'branch' })).toEqual({ to: 'project', project: 'ABC', tab: 'repo' })
    expect(fieldFixOf({ project: 'ABC', field: 'chain.terminal' })).toEqual({ to: 'project', project: 'ABC', tab: 'tracker' })
    expect(fieldFixOf({ project: 'ABC', field: 'models.claude' })).toEqual({ to: 'project', project: 'ABC', tab: 'sessions' })
    expect(fieldFixOf({ project: 'ABC', field: 'check' })).toEqual({ to: 'project', project: 'ABC', tab: 'ci' })
  })

  it('opens the tab of a shared field', () => {
    expect(fieldFixOf({ project: null, field: 'parallel' })).toEqual({ to: 'shared', tab: 'chain' })
    expect(fieldFixOf({ project: null, field: 'execution.claude' })).toEqual({ to: 'shared', tab: 'models' })
    expect(fieldFixOf({ project: null, field: 'context' })).toEqual({ to: 'shared', tab: 'sessions' })
    expect(fieldFixOf({ project: null, field: 'allowedHosts' })).toEqual({ to: 'shared', tab: 'page' })
    expect(fieldFixOf({ project: null, field: 'stats' })).toEqual({ to: 'shared', tab: 'stats' })
    expect(fieldFixOf({ project: null, field: 'backupDir' })).toEqual({ to: 'shared', tab: 'backup' })
  })
})
