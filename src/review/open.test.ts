import { describe, expect, it } from 'vitest'
import { describedBy, pullTarget } from './open.js'

describe('pullTarget', () => {
  it('takes origin when its address parses', () => {
    const remotes = [
      { name: 'github', url: 'git@github.com:acme/app.git' },
      { name: 'origin', url: 'https://git.example.com/acme/app.git' },
    ]
    expect(pullTarget(remotes)).toEqual({ kind: 'forgejo', remote: 'origin', web: 'https://git.example.com', owner: 'acme', repo: 'app' })
  })

  it('falls back to the first remote that parses, GitHub by its host', () => {
    const remotes = [
      { name: 'origin', url: 'D:/backup/app.git' },
      { name: 'hub', url: 'git@github.com:acme/app.git' },
    ]
    expect(pullTarget(remotes)).toEqual({ kind: 'github', remote: 'hub', web: 'https://github.com', owner: 'acme', repo: 'app' })
  })

  it('finds none without a remote on a forge', () => {
    expect(pullTarget([{ name: 'origin', url: 'D:/backup/app.git' }])).toBeNull()
    expect(pullTarget([])).toBeNull()
  })
})

describe('describedBy', () => {
  it('takes the first line for the title and the rest for the body', () => {
    expect(describedBy('# [ABC-7] Fix the parser\n\nThe parser now keeps quotes.\n- tests added\n')).toEqual({
      title: '[ABC-7] Fix the parser',
      body: 'The parser now keeps quotes.\n- tests added',
    })
  })

  it('skips blank lines before the title', () => {
    expect(describedBy('\n\nFix it')).toEqual({ title: 'Fix it', body: '' })
  })

  it('gives nothing for an empty note', () => {
    expect(describedBy(' \n\n')).toBeNull()
  })
})
