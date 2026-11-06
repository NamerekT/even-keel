import { describe, expect, it } from 'vitest'
import { choicesOf } from './branches.js'

const lines = (...each: string[]) => each.join('\n')

describe('choicesOf', () => {
  it('hides a branch another worktree holds, and a task branch with no worktree', () => {
    const refs = lines(
      'refs/heads/dev D:/repo',
      'refs/heads/btn-350/task D:/repo/.claude/worktrees/btn-350',
      'refs/heads/spike D:/repo/.claude/worktrees/even-keel',
      'refs/heads/btn-12/task ',
      'refs/heads/feature/task',
      'refs/heads/main',
    )
    expect(choicesOf(refs, [], 'dev')).toEqual([
      { name: 'dev', remote: null },
      { name: 'btn-350/task', remote: null, hidden: true },
      { name: 'spike', remote: null, hidden: true },
      { name: 'btn-12/task', remote: null, hidden: true },
      { name: 'feature/task', remote: null, hidden: true },
      { name: 'main', remote: null },
    ])
  })

  it('keeps the checkout\'s own branch offered, first, even when it is named as a task\'s', () => {
    const refs = lines('refs/heads/main', 'refs/heads/abc-1/task D:/repo')
    expect(choicesOf(refs, [], 'abc-1/task')).toEqual([
      { name: 'abc-1/task', remote: null },
      { name: 'main', remote: null },
    ])
  })

  it('hides a task branch only on a remote, and keeps other remote branches offered', () => {
    const refs = lines('refs/heads/main D:/repo', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/btn-7/task', 'refs/remotes/origin/release/v1')
    expect(choicesOf(refs, ['origin'], 'main')).toEqual([
      { name: 'main', remote: null },
      { name: 'btn-7/task', remote: 'origin', hidden: true },
      { name: 'release/v1', remote: 'origin' },
    ])
  })

  it('on a detached HEAD hides every branch a worktree holds', () => {
    const refs = lines('refs/heads/main', 'refs/heads/spike D:/elsewhere')
    expect(choicesOf(refs, [], null)).toEqual([
      { name: 'main', remote: null },
      { name: 'spike', remote: null, hidden: true },
    ])
  })
})
