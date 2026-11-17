import { describe, expect, it } from 'vitest'
import type { GitResult } from './types.js'
import { pushTaskBranch, remoteHas, restoreBranch, taskRemote } from './push.js'

const folder = '/home/john/repo/.claude/worktrees/abc-1'

function fakeGit(answers: Record<string, Partial<GitResult>> = {}) {
  const calls: string[] = []
  const git = async (cwd: string, args: string[]): Promise<GitResult> => {
    expect(cwd).toBe(folder)
    const command = args.join(' ')
    calls.push(command)
    return { code: 0, out: '', ...answers[command] }
  }
  return { git, calls }
}

const onBranch = { 'symbolic-ref --quiet --short HEAD': { out: 'abc-1/task\n' } }

describe('taskRemote', () => {
  it('takes origin when the repository has it, else its first remote', () => {
    expect(taskRemote(['github', 'origin'])).toBe('origin')
    expect(taskRemote(['github', 'mirror'])).toBe('github')
    expect(taskRemote([])).toBeNull()
  })
})

describe('pushTaskBranch', () => {
  it('pushes the task branch of the folder to origin, never forced', async () => {
    const { git, calls } = fakeGit({ ...onBranch, remote: { out: 'github\norigin\n' } })
    expect(await pushTaskBranch(git, folder, 'ABC-1')).toEqual({ remote: 'origin', branch: 'abc-1/task' })
    expect(calls).toEqual(['symbolic-ref --quiet --short HEAD', 'remote', 'push origin abc-1/task:refs/heads/abc-1/task'])
  })

  it('pushes nothing from a folder on another branch or a detached head', async () => {
    const other = fakeGit({ 'symbolic-ref --quiet --short HEAD': { out: 'abc-2/task\n' } })
    expect(await pushTaskBranch(other.git, folder, 'ABC-1')).toEqual({ skipped: 'noBranch' })
    const detached = fakeGit({ 'symbolic-ref --quiet --short HEAD': { code: 1 } })
    expect(await pushTaskBranch(detached.git, folder, 'ABC-1')).toEqual({ skipped: 'noBranch' })
    expect([...other.calls, ...detached.calls].some((call) => call.startsWith('push'))).toBe(false)
  })

  it('pushes nothing from a repository without remotes', async () => {
    const { git, calls } = fakeGit(onBranch)
    expect(await pushTaskBranch(git, folder, 'ABC-1')).toEqual({ skipped: 'noRemote' })
    expect(calls).not.toContain('push origin abc-1/task:refs/heads/abc-1/task')
  })

  it('gives git’s output of a refused push', async () => {
    const out = ' ! [rejected]        abc-1/task -> abc-1/task (fetch first)'
    const { git } = fakeGit({ ...onBranch, remote: { out: 'origin\n' }, 'push origin abc-1/task:refs/heads/abc-1/task': { code: 1, out } })
    expect(await pushTaskBranch(git, folder, 'ABC-1')).toEqual({ remote: 'origin', branch: 'abc-1/task', failed: out })
  })
})

describe('remoteHas', () => {
  it('tells a branch the remote has from one it lacks and from a remote that does not answer', async () => {
    const ask = 'ls-remote --exit-code --heads origin refs/heads/abc-1/task'
    expect(await remoteHas(fakeGit().git, folder, 'origin', 'abc-1/task')).toBe(true)
    expect(await remoteHas(fakeGit({ [ask]: { code: 2 } }).git, folder, 'origin', 'abc-1/task')).toBe(false)
    expect(await remoteHas(fakeGit({ [ask]: { code: 128, out: 'Could not resolve host\n' } }).git, folder, 'origin', 'abc-1/task')).toEqual({ error: 'Could not resolve host' })
  })
})

describe('restoreBranch', () => {
  const fetch = 'fetch origin +refs/heads/abc-1/task:refs/heads/abc-1/task'

  it('brings the branch from the remote over the local one', async () => {
    const { git, calls } = fakeGit({ remote: { out: 'origin\n' } })
    expect(await restoreBranch(git, folder, 'abc-1/task')).toBeNull()
    expect(calls).toEqual(['remote', fetch])
  })

  it('gives git’s refusal and a repository without remotes', async () => {
    const refused = fakeGit({ remote: { out: 'origin\n' }, [fetch]: { code: 1, out: "fatal: refusing to fetch into branch 'refs/heads/abc-1/task' checked out\n" } })
    expect(await restoreBranch(refused.git, folder, 'abc-1/task')).toContain('refusing to fetch')
    expect(await restoreBranch(fakeGit().git, folder, 'abc-1/task')).toBe('the repository has no remote')
  })
})
