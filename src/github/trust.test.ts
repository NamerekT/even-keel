import { describe, expect, it } from 'vitest'
import { Skipped, trustedAuthor } from './trust.js'

describe('trustedAuthor', () => {
  it('trusts the owner, the members of its organization and the collaborators', () => {
    for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) expect(trustedAuthor(association, 'jdoe', 'octocat')).toBe(true)
  })

  it('trusts no one else, however they took part before', () => {
    for (const association of ['CONTRIBUTOR', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'MANNEQUIN', 'NONE', undefined]) {
      expect(trustedAuthor(association, 'jdoe', 'octocat')).toBe(false)
    }
  })

  it('trusts the token itself, whatever it is to the repository', () => {
    expect(trustedAuthor('NONE', 'octocat', 'octocat')).toBe(true)
    expect(trustedAuthor('NONE', 'OctoCat', 'octocat')).toBe(true)
    expect(trustedAuthor('NONE', null, null)).toBe(false)
  })
})

describe('Skipped', () => {
  it('logs a skipped comment once, however often it is read', () => {
    const lines: string[] = []
    const skipped = new Skipped((line) => lines.push(line))
    skipped.note('IC_1', 'first')
    skipped.note('IC_1', 'first again')
    skipped.note('IC_2', 'second')
    expect(lines).toEqual(['first', 'second'])
  })
})
