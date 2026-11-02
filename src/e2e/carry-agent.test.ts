import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../git/run.js'
import { ends, Gate, parked, type Turn } from './agent.fixture.js'
import { CARRY, carryOf, FORWARD_REF, TICK } from './carry.fixture.js'
import { Harness, PROJECT_ID, RELEASE_BRANCH, RELEASE_ID } from './service.fixture.js'

describe('a carry conflict given to a session end to end', { timeout: 90_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
    run.forge = true
    run.release = {}
  })

  afterEach(async () => {
    await run.stop()
  })

  const { view, launches, carry, subjects, commitIn, conflicting, clean } = carryOf(() => run)

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

  it('in unattended mode gives a conflict to a carry session by itself, lets it go after ten quiet minutes, asks none more on the same release commit, and a new one on the next', async () => {
    run.agent.script(CARRY, ends({ say: 'Cannot tell which line wins' }), resolves('# Example (both)\n'))
    await run.start(conflicting)
    await run.post('chain/unattended', { on: true })

    await run.until(() => launches(CARRY).length === 1, 'the carry session launched by itself')
    await run.until(() => run.agent.sessionsOf(CARRY)[0]?.resting === true, 'the carry session idle')
    await run.pass(9 * 60_000, 10_000)
    expect(carry()).toMatchObject({ task: CARRY })
    // Ten quiet minutes let the session go as "Skip" would: the record dropped, the hold kept, the session untouched.
    await run.until(() => carry() === undefined, 'the idle carry session let go', { step: 10_000 })
    expect(run.service.dispatcher.state.active.find((chain) => chain.project === PROJECT_ID)?.current?.task).not.toBe(CARRY)
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
