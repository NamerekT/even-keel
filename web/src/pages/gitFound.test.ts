import { describe, expect, it } from 'vitest'
import type { EvenKeelState } from '../../../src/state.js'
import { gitFoundMark, gitFoundNotice, offeredBranch } from './gitFound.js'
import { noticeFixOf } from './noticeFix.js'

type Shape = Parameters<typeof gitFoundNotice>[0]

function stateOf(change: { branch?: string | null; main?: string; found?: boolean; dismissed?: Record<string, string> } = {}): Shape {
  return {
    gitFound: change.found === false ? {} : { p1: { branch: change.branch === undefined ? 'master' : change.branch, since: 1700 } },
    config: { projects: { p1: { branch: change.main ?? 'main' } } } as unknown as EvenKeelState['config'],
    noticesDismissed: change.dismissed ?? {},
    projectLabels: { p1: 'ABC' },
  }
}

describe('gitFoundNotice', () => {
  it('tells of a repository found in the folder, by the project’s label, with "Turn on git" as its fix', () => {
    const found = gitFoundNotice(stateOf(), 'p1')
    expect(found).toEqual({ notice: { code: 'git.found', params: { project: 'ABC', branch: 'master' } }, stamp: '1700' })
    expect(noticeFixOf(found!.notice)).toEqual({ to: 'gitOn' })
  })

  it('says nothing of a project whose folder is no repository', () => {
    expect(gitFoundNotice(stateOf({ found: false }), 'p1')).toBeNull()
  })

  it('stays closed after "Not now" for the same repository, and asks again for one made anew', () => {
    expect(gitFoundNotice(stateOf({ dismissed: { [gitFoundMark('p1')]: '1700' } }), 'p1')).toBeNull()
    expect(gitFoundNotice(stateOf({ dismissed: { [gitFoundMark('p1')]: '1200' } }), 'p1')).not.toBeNull()
  })
})

describe('offeredBranch', () => {
  it('offers the repository’s branch when it is not the project’s main branch', () => {
    expect(offeredBranch(stateOf(), 'p1')).toEqual({ current: 'master', main: 'main' })
  })

  it('offers nothing when the branches agree or the repository’s is unknown', () => {
    expect(offeredBranch(stateOf({ branch: 'main' }), 'p1')).toBeNull()
    expect(offeredBranch(stateOf({ branch: null }), 'p1')).toBeNull()
    expect(offeredBranch(stateOf({ found: false }), 'p1')).toBeNull()
  })

  it('takes a blank main branch for main', () => {
    expect(offeredBranch(stateOf({ branch: 'main', main: ' ' }), 'p1')).toBeNull()
  })
})
