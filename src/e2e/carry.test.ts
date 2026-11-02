import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CARRY, carryOf, FORWARD_REF, TICK } from './carry.fixture.js'
import { Harness, PROJECT_ID, RELEASE_BRANCH, RELEASE_ID } from './service.fixture.js'

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

  const { view, launches, subjects, fixed, diverged, conflicting, clean } = carryOf(() => run)

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
})
