import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../git/run.js'
import { ends, Gate, parked, type Turn } from './agent.fixture.js'
import { Harness, PROJECT_ID, RELEASE_BRANCH, RELEASE_ID } from './service.fixture.js'

const CARRY = 'REL-CARRY'
const FORWARD_REF = `refs/even-keel/forward/${RELEASE_ID}`
/** One forward tick of the service and a step of slack. */
const TICK = 61_000

describe('a release project carried forward end to end', { timeout: 90_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
    run.forge = true
    run.release = {}
  })

  afterEach(async () => {
    await run.stop()
  })

  const view = () => run.service.forwards.view()[RELEASE_ID]
  const launches = (task: string) => run.agent.calls.filter((call) => call.kind === 'launch' && call.task === task)
  const carry = () => run.service.dispatcher.state.ci[RELEASE_ID]?.carry
  const subjects = (repo: string, branch = 'main') => run.gitIn(repo, 'log', '--format=%s', branch).split('\n')
  const commitIn = (repo: string, file: string, text: string, subject: string) => {
    writeFileSync(join(repo, file), text)
    run.gitIn(repo, 'add', file)
    run.gitIn(repo, 'commit', '-q', '-m', subject)
  }
  /** A fix of the release branch. */
  const fixed = () => commitIn(run.releaseRepo, 'fix.txt', 'fixed\n', 'Release fix')
  /** A fix of the release branch and a commit of `main` of its own: the carry is a merge commit. */
  const diverged = () => {
    fixed()
    commitIn(run.repo, 'own.txt', 'own\n', 'Main change')
  }
  /** A fix of the release branch and a change of `main` to the same line: the carry conflicts in `README.md`. */
  const conflicting = () => {
    commitIn(run.releaseRepo, 'README.md', '# Example (release)\n', 'Release fix')
    commitIn(run.repo, 'README.md', '# Example (main)\n', 'Main change')
  }
  /** The checkout is on its branch with nothing staged, changed or half-merged. */
  const clean = (repo: string) => run.gitIn(repo, 'status', '--porcelain', '--untracked-files=no') === '' && !existsSync(join(repo, '.git', 'MERGE_HEAD'))

  it('fast-forwards main to the release branch and pushes it', async () => {
    await run.start(fixed)

    await run.until(() => view()?.last !== undefined, 'the release branch carried')
    expect(view()).toMatchObject({ into: PROJECT_ID, behind: 0, hold: null, held: false, last: { commits: 1, push: null } })
    expect(run.git('rev-parse', 'main')).toBe(run.gitIn(run.releaseRepo, 'rev-parse', RELEASE_BRANCH))
    expect(subjects(run.remote)[0]).toBe('Release fix')
  })

  it('makes a merge commit when main has commits of its own and pushes it', async () => {
    await run.start(diverged)

    await run.until(() => view()?.last !== undefined, 'the release branch carried')
    expect(view()).toMatchObject({ behind: 0, held: false, last: { commits: 1, push: null } })
    const merge = `Merge branch '${RELEASE_BRANCH}' of REL into main`
    expect(subjects(run.repo)[0]).toBe(merge)
    expect(subjects(run.remote).slice(0, 3)).toEqual([merge, 'Main change', 'Release fix'])
  })

  it('holds a merge git refuses for want of an identity with its message until "Carry now"', async () => {
    await run.start(() => {
      diverged()
      // As the service's account with no git name and email: git guesses none and takes none from the environment.
      for (const name of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete process.env[name]
      run.git('config', 'user.useConfigOnly', 'true')
      run.git('config', '--unset', 'user.email')
      run.git('config', '--unset', 'user.name')
    })

    await run.until(() => view()?.held === true, 'the carry held')
    expect(view()?.hold).toMatchObject({ code: 'forward.failed', params: { from: RELEASE_ID, into: PROJECT_ID } })
    expect(view()?.hold?.detail).toMatch(/email|identity/i)
    expect(clean(run.repo)).toBe(true)
    expect(subjects(run.repo)[0]).toBe('Main change')

    // A failure with no conflicted file asks for no session, and the identity set again does not lift the hold.
    run.git('config', 'user.email', 'john@example.com')
    run.git('config', 'user.name', 'John Doe')
    await run.pass(3 * TICK)
    expect(view()).toMatchObject({ held: true, behind: 1, hold: { code: 'forward.failed' } })
    expect(launches(CARRY)).toEqual([])

    await run.post('forward/carry', { project: RELEASE_ID })
    expect(view()).toMatchObject({ behind: 0, hold: null, held: false, last: { commits: 1, push: null } })
    expect(subjects(run.remote)[0]).toBe(`Merge branch '${RELEASE_BRANCH}' of REL into main`)
  })

  it('aborts a conflict, keeps main clean and holds the carry until it is merged by hand', async () => {
    await run.start(conflicting)

    await run.until(() => view()?.held === true, 'the conflict held')
    expect(view()?.hold).toMatchObject({ code: 'forward.conflict', params: { from: RELEASE_ID, into: PROJECT_ID, files: ['README.md'] } })
    expect(clean(run.repo)).toBe(true)
    await run.pass(3 * TICK)
    expect(view()).toMatchObject({ held: true, behind: 1 })
    expect(launches(CARRY)).toEqual([])
    expect(subjects(run.repo)[0]).toBe('Main change')

    // The user resolves it in the main checkout; the next tick finds nothing behind.
    expect(() => run.git('merge', '--no-edit', FORWARD_REF)).toThrow()
    writeFileSync(join(run.repo, 'README.md'), '# Example (both)\n')
    run.git('add', 'README.md')
    run.git('commit', '-q', '--no-edit')
    await run.until(() => view()?.held === false, 'the hold lifted')
    expect(view()).toMatchObject({ behind: 0, hold: null })
    expect(view()?.last).toBeUndefined()
  })

  it('shows a refused push on the release project until every remote has the merge', async () => {
    const hook = join(run.remote, 'hooks', 'pre-receive')
    await run.start(() => {
      diverged()
      writeFileSync(hook, '#!/bin/sh\necho "push refused by the bench"\nexit 1\n', { mode: 0o755 })
    })

    await run.until(() => view()?.last !== undefined, 'the release branch carried')
    expect(view()).toMatchObject({ behind: 0, held: false, last: { commits: 1 } })
    expect(view()?.last?.push).not.toBeNull()
    expect(subjects(run.repo)[0]).toBe(`Merge branch '${RELEASE_BRANCH}' of REL into main`)
    expect(subjects(run.remote)[0]).toBe('Initial commit')
    await run.pass(2 * TICK)
    expect(view()?.last?.push).not.toBeNull()

    rmSync(hook)
    run.git('push', '-q', 'origin', 'main')
    await run.until(() => view()?.last?.push === null, 'the push warning lifted')
  })

  /** The carry session: merges the release commit in its worktree, takes `text` for the conflicted line and merges into main. */
  function resolves(text: string): Turn {
    return async ({ cwd, repo, git }) => {
      const commit = (await git('rev-parse', FORWARD_REF)).trim()
      if ((await runGit(cwd, ['merge', '--no-edit', commit])).code === 0) throw new Error('script: the carry merged with no conflict')
      await writeFile(join(cwd, 'README.md'), text)
      await git('add', 'README.md')
      await git('commit', '--no-edit')
      const branch = (await git('rev-parse', '--abbrev-ref', 'HEAD')).trim()
      const merged = await runGit(repo, ['merge', '--no-edit', branch])
      if (merged.code !== 0) throw new Error(`script: merge of ${branch}: ${merged.out}`)
      return { say: 'Carried' }
    }
  }

  const carried = async () => {
    await run.until(() => carry() === undefined && view()?.held === false && view()?.behind === 0, 'the carry landed and the hold lifted')
    await run.until(() => !existsSync(join(run.repo, '.claude', 'worktrees', 'rel-carry')) && run.git('branch', '--list', 'rel-carry/*') === '', 'the carry worktree and branch removed')
    expect(run.git('merge-base', '--is-ancestor', run.gitIn(run.releaseRepo, 'rev-parse', RELEASE_BRANCH), 'main')).toBe('')
    expect(run.git('show', 'main:README.md')).toBe('# Example (both)')
    expect(subjects(run.remote)[0]).toBe(subjects(run.repo)[0])
  }

  it('gives a conflict to one carry session on "Resolve with the agent", keeps its record through a restart and closes it on the merge', async () => {
    const gate = new Gate()
    run.agent.script(CARRY, parked(gate, resolves('# Example (both)\n')))
    await run.start(conflicting)
    await run.until(() => view()?.hold?.code === 'forward.conflict', 'the conflict held')
    await run.pass(2 * TICK)
    expect(launches(CARRY)).toEqual([])

    await run.post('forward/resolve', { project: RELEASE_ID })
    await run.until(() => launches(CARRY).length === 1, 'the carry session launched')
    const [launch] = launches(CARRY)
    expect(launch!.cwd).toContain(join(run.repo, '.claude', 'worktrees'))
    expect(launch!.prompt).toContain(run.gitIn(run.releaseRepo, 'rev-parse', RELEASE_BRANCH))
    expect(view()?.agent).toBe(CARRY)
    expect(carry()).toMatchObject({ task: CARRY, into: PROJECT_ID, commits: 1 })
    expect((await run.refused('forward/carry', { project: RELEASE_ID })).code).toBe('forward.agent')

    // The hold is in memory and goes with the restart; the record does not, and nothing is merged or launched anew.
    await run.restart()
    expect(carry()).toMatchObject({ task: CARRY, into: PROJECT_ID })
    await run.pass(2 * TICK)
    expect(launches(CARRY)).toHaveLength(1)
    expect(view()?.agent).toBe(CARRY)
    expect(clean(run.repo)).toBe(true)
    expect(subjects(run.repo)[0]).toBe('Main change')

    gate.open()
    await carried()
    await run.pass(2 * TICK)
    expect(launches(CARRY)).toHaveLength(1)
  })

  it('gives a conflict to one carry session by itself with carryAgent on', async () => {
    run.release = { carryAgent: true }
    run.agent.script(CARRY, resolves('# Example (both)\n'))
    await run.start(conflicting)

    await run.until(() => launches(CARRY).length === 1, 'the carry session launched by itself')
    await carried()
    await run.pass(3 * TICK)
    expect(launches(CARRY)).toHaveLength(1)
  })

  it('in unattended mode gives a conflict to a carry session by itself, none more on the same release commit once it is skipped, and a new one on the next', async () => {
    run.agent.script(CARRY, ends({ say: 'Cannot tell which line wins' }), resolves('# Example (both)\n'))
    await run.start(conflicting)
    await run.post('chain/unattended', { on: true })

    await run.until(() => launches(CARRY).length === 1, 'the carry session launched by itself')
    await run.until(() => run.agent.sessionsOf(CARRY)[0]?.resting === true, 'the carry session idle')
    await run.post('chain/skip', { project: PROJECT_ID, task: CARRY })
    expect(carry()).toBeUndefined()
    expect(view()).toMatchObject({ held: true, hold: { code: 'forward.conflict' } })
    await run.pass(5 * TICK, 10_000)
    expect(launches(CARRY)).toHaveLength(1)

    // A new fix on the release branch moves its head: the merge is tried again and its conflict asks for a session.
    // The skipped session still lives under the same name; a new one starts in its place, the old one untouched.
    const [skipped] = run.agent.sessionsOf(CARRY)
    commitIn(run.releaseRepo, 'more.txt', 'more\n', 'Another release fix')
    const head = run.gitIn(run.releaseRepo, 'rev-parse', RELEASE_BRANCH)
    await run.until(() => carry()?.commit === head, 'a carry asked for the new release commit')
    expect(carry()).toMatchObject({ task: CARRY, into: PROJECT_ID, commits: 2 })
    await run.until(() => launches(CARRY).length === 2, 'a new carry session launched')
    expect(launches(CARRY)[1]!.prompt).toContain(head)
    expect(run.agent.calls.filter((call) => call.kind !== 'launch' && call.sessionId === skipped!.sessionId)).toEqual([])
    expect(run.service.dispatcher.state.ci[PROJECT_ID]?.skippedSessions).toEqual({ [CARRY]: [skipped!.sessionId] })
    await carried()
    expect(run.git('show', 'main:more.txt')).toBe('more')
    // The cleanup of the carry's worktree stops every session in it, the skipped one too, and forgets it.
    expect(run.agent.isGone(skipped!.sessionId)).toBe(true)
    expect(run.service.dispatcher.state.ci[PROJECT_ID]?.skippedSessions).toBeUndefined()
  })
})
