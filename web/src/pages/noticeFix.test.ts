import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import { fieldFixOf, noticeFixOf } from './noticeFix.js'

describe('noticeFixOf', () => {
  it('sends a wrong main branch to the repository tab of the project', () => {
    expect(noticeFixOf(notice('git.noBranch', { project: 'ABC', branch: 'dev', repo: 'D:/abc' }))).toEqual({ to: 'project', tab: 'repo' })
    expect(noticeFixOf(notice('forward.foreign', { from: 'ABC', into: 'ABD' }))).toEqual({ to: 'project', tab: 'repo' })
  })

  it('sends a spent limit and a lost sign-in to the accounts', () => {
    expect(noticeFixOf(notice('chain.limitSpent', { until: '12:00' }))).toEqual({ to: 'accounts' })
    expect(noticeFixOf(notice('account.signedOut', {}))).toEqual({ to: 'accounts' })
  })

  it('sends a refused or missing token to Access', () => {
    expect(noticeFixOf(notice('ci.noToken', { kind: 'forgejo' }))).toEqual({ to: 'shared', tab: 'secrets' })
    expect(noticeFixOf(notice('review.denied', { ci: 'Forgejo', status: 403 }))).toEqual({ to: 'shared', tab: 'secrets' })
  })

  it('finds the fix of a reason in the items or the cause', () => {
    const empty = notice('chain.empty', { project: 'ABC' }, { items: [notice('chain.emptyNone', {}), notice('chain.emptyLabels', { labels: ['ready'] })] })
    expect(noticeFixOf(empty)).toEqual({ to: 'project', tab: 'tracker' })
    expect(noticeFixOf(notice('claude.startFailed', { task: 'ABC-1', cwd: 'D:/abc' }, { cause: notice('prompt.empty', { before: 'x', value: 'null' }) }))).toEqual({ to: 'project', tab: 'sessions' })
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
  })
})
