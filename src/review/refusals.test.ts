import { describe, expect, it } from 'vitest'
import type { CiTarget } from '../ci/remote.js'
import { PullRefusals } from './refusals.js'

const github: CiTarget = { kind: 'github', remote: 'origin', web: 'https://github.com', owner: 'john', repo: 'app' }
const forgejo: CiTarget = { kind: 'forgejo', remote: 'origin', web: 'https://git.example.com', owner: 'john', repo: 'site' }

describe('PullRefusals', () => {
  it('names the remotes refused with the token a profile still holds', () => {
    const refusals = new PullRefusals()
    refusals.note('ABC', github, 'token-a')
    refusals.note('XYZ', forgejo, 'token-b')
    const current = (project: string) => (project === 'ABC' ? { profile: 'p1', token: 'token-a' } : { profile: 'p2', token: 'token-b' })
    expect(refusals.of('p1', current)).toEqual([{ project: 'ABC', remote: 'origin' }])
    expect(refusals.of('p2', current)).toEqual([{ project: 'XYZ', remote: 'origin' }])
  })

  it('forgets a refusal once the profile holds another token', () => {
    const refusals = new PullRefusals()
    refusals.note('ABC', github, 'token-a')
    expect(refusals.of('p1', () => ({ profile: 'p1', token: 'token-new' }))).toEqual([])
  })

  it('forgets a refusal once the project no longer takes the profile or PR mode is off', () => {
    const refusals = new PullRefusals()
    refusals.note('ABC', github, 'token-a')
    expect(refusals.of('p1', () => ({ profile: 'p2', token: 'token-a' }))).toEqual([])
    expect(refusals.of('p1', () => null)).toEqual([])
  })

  it('clears a project once its pull request opens', () => {
    const refusals = new PullRefusals()
    refusals.note('ABC', github, 'token-a')
    refusals.clear('ABC')
    expect(refusals.of('p1', () => ({ profile: 'p1', token: 'token-a' }))).toEqual([])
  })

  it('asks the current token of the remote that refused', () => {
    const refusals = new PullRefusals()
    refusals.note('ABC', forgejo, 'token-b')
    const asked: CiTarget[] = []
    refusals.of('p1', (_project, target) => {
      asked.push(target)
      return null
    })
    expect(asked).toEqual([forgejo])
  })
})
